// Step 2.4 — given {fallback_archetype, visual_spec}, draw the fallback
// sprite PNG with visual_spec modifiers applied: colour multiply from
// primaryColor, scale from scale, alpha/desaturation from condition, a
// glow pass from glow, and animation driving a slow sine on
// position/rotation/alpha. Missing sprite -> draw the Step 2.2 circle,
// don't crash.
//
// This is deliberately the FALLBACK path only (pipeline §21-22) — every
// row is currently render_status='fallback' since Step 2.5 (generated
// per-memory art) isn't implemented yet. Once it is, the draw entry point
// below should prefer a generated_asset_url texture when present and only
// fall through to this fallback-sprite logic otherwise; the visual_spec
// modifiers (scale/animation/glow/condition tint) still apply on top
// either way, per the RenderableMemoryObject contract (pipeline §23).
//
// Perf note: tinting (multiply-blend + desaturate) is the expensive part,
// so it's cached per (archetype, color, condition) combo on an offscreen
// canvas the first time it's needed, not redone every frame. Only the
// per-frame animation transform (translate/rotate/alpha) and glow shadow
// are computed fresh each frame — cheap compared to recompositing.

import { resolveColor } from "../lib/color.ts";

export interface SpriteVisualSpec {
  primaryColor?: string;
  scale?: string;
  condition?: string;
  glow?: number;
  animation?: string;
  [key: string]: unknown;
}

export interface SpriteObject {
  id: string;
  fallback_archetype: string;
  visual_spec: SpriteVisualSpec;
}

const SCALE_DIAMETER: Record<string, number> = {
  tiny: 16,
  miniature: 24,
  small: 32,
  medium: 48,
  large: 64,
};
const DEFAULT_DIAMETER = 32;

const CONDITION_STYLE: Record<string, { alpha: number; saturate: number }> = {
  new: { alpha: 1, saturate: 1.1 },
  pristine: { alpha: 1, saturate: 1.15 },
  polished: { alpha: 1, saturate: 1.1 },
  worn: { alpha: 0.92, saturate: 0.85 },
  faded: { alpha: 0.75, saturate: 0.55 },
  weathered: { alpha: 0.82, saturate: 0.7 },
  cracked: { alpha: 0.85, saturate: 0.75 },
};
const DEFAULT_CONDITION_STYLE = { alpha: 1, saturate: 1 };

// --- sprite image preloading -------------------------------------------------

const spriteCache = new Map<string, HTMLImageElement>();
let preloadPromise: Promise<void> | null = null;

export function preloadSprites(fallbackArchetypes: readonly string[]): Promise<void> {
  if (preloadPromise) return preloadPromise;

  preloadPromise = Promise.all(
    fallbackArchetypes.map(
      (archetype) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            spriteCache.set(archetype, img);
            resolve();
          };
          img.onerror = () => resolve(); // missing sprite -> just not cached, falls back to circle
          img.src = `/sprites/${archetype}.png`;
        })
    )
  ).then(() => undefined);

  return preloadPromise;
}

// --- tinting cache ------------------------------------------------------------

const tintCache = new Map<string, HTMLCanvasElement>();

function getTintedSprite(archetype: string, colorHex: string, condition: string): HTMLCanvasElement | null {
  const source = spriteCache.get(archetype);
  if (!source) return null;

  const key = `${archetype}:${colorHex}:${condition}`;
  const cached = tintCache.get(key);
  if (cached) return cached;

  const style = CONDITION_STYLE[condition] ?? DEFAULT_CONDITION_STYLE;
  const canvas = document.createElement("canvas");
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  const ctx = canvas.getContext("2d")!;

  ctx.filter = `saturate(${style.saturate})`;
  ctx.drawImage(source, 0, 0);
  ctx.filter = "none";

  // multiply-tint, then mask back to the source's alpha silhouette
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = colorHex;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = "source-over";

  tintCache.set(key, canvas);
  return canvas;
}

// --- per-object animation phase (so same-animation objects don't sync) -------

function phaseFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return (hash % 1000) / 1000;
}

interface AnimTransform {
  dx: number;
  dy: number;
  rotation: number;
  scaleMul: number;
  alphaMul: number;
}

function animate(animation: string, timeMs: number, phase: number): AnimTransform {
  const t = timeMs / 1000 + phase * 10;
  switch (animation) {
    case "slow_breathing":
      return { dx: 0, dy: 0, rotation: 0, scaleMul: 1 + 0.04 * Math.sin(t * 0.9), alphaMul: 1 };
    case "gentle_sway":
      return { dx: 0, dy: 0, rotation: 0.06 * Math.sin(t * 0.7), scaleMul: 1, alphaMul: 1 };
    case "flicker":
      return { dx: 0, dy: 0, rotation: 0, scaleMul: 1, alphaMul: 0.75 + 0.25 * Math.abs(Math.sin(t * 4.5)) };
    case "drift":
      return { dx: 2.5 * Math.cos(t * 0.5), dy: 2.5 * Math.sin(t * 0.5), rotation: 0, scaleMul: 1, alphaMul: 1 };
    case "pulse":
      return { dx: 0, dy: 0, rotation: 0, scaleMul: 1 + 0.08 * Math.abs(Math.sin(t * 1.6)), alphaMul: 1 };
    case "bob":
      return { dx: 0, dy: 4 * Math.sin(t * 1.1), rotation: 0, scaleMul: 1, alphaMul: 1 };
    case "asymmetric_wobble":
      return {
        dx: 0,
        dy: 0,
        rotation: 0.05 * Math.sin(t * 1.3) + 0.03 * Math.sin(t * 2.7 + 1),
        scaleMul: 1,
        alphaMul: 1,
      };
    case "still":
    default:
      return { dx: 0, dy: 0, rotation: 0, scaleMul: 1, alphaMul: 1 };
  }
}

// --- public draw entry point --------------------------------------------------

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  obj: SpriteObject,
  screenX: number,
  screenY: number,
  zoom: number,
  timeMs: number
): void {
  const spec = obj.visual_spec ?? {};
  const diameter = (SCALE_DIAMETER[spec.scale ?? ""] ?? DEFAULT_DIAMETER) * Math.min(zoom, 1.5);
  const colorHex = resolveColor(spec.primaryColor);
  const condition = spec.condition ?? "";
  const glow = typeof spec.glow === "number" ? spec.glow : 0;
  const anim = animate(spec.animation ?? "still", timeMs, phaseFor(obj.id));

  const tinted = getTintedSprite(obj.fallback_archetype, colorHex, condition);
  const drawX = screenX + anim.dx * zoom;
  const drawY = screenY + anim.dy * zoom;
  const style = CONDITION_STYLE[condition] ?? DEFAULT_CONDITION_STYLE;
  const size = diameter * anim.scaleMul;

  ctx.save();
  ctx.globalAlpha = style.alpha * anim.alphaMul;

  if (glow > 0.02) {
    ctx.shadowColor = colorHex;
    ctx.shadowBlur = glow * 24 * Math.min(zoom, 1.5);
  }

  if (tinted) {
    // Sprites are cropped to their content's own aspect ratio (a wide
    // shelf, a tall lamp), not forced square — fit `size` to the longer
    // side and derive the other from the source's own ratio, so "medium"
    // means the same footprint for every archetype without squashing or
    // stretching non-square art. See scripts/process-sprite.ts's content
    // bbox crop, which this depends on for consistent fill %.
    const aspect = tinted.width / tinted.height;
    const drawW = aspect >= 1 ? size : size * aspect;
    const drawH = aspect >= 1 ? size / aspect : size;
    ctx.translate(drawX, drawY);
    if (anim.rotation) ctx.rotate(anim.rotation);
    ctx.drawImage(tinted, -drawW / 2, -drawH / 2, drawW, drawH);
  } else {
    // fallback: Step 2.2's plain circle, so a missing sprite never crashes
    // or leaves a hole — same visual language, just less detailed.
    ctx.beginPath();
    ctx.arc(drawX, drawY, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = colorHex;
    ctx.fill();
  }

  ctx.restore();
}
