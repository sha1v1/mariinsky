// World hierarchy (architecture refactor) — structure rendering.
//
// Prefers real cutaway/dollhouse art (public/structures/<template_id>.png,
// see scripts/process-structure-art.ts) when it exists; falls back to the
// original crude tinted rectangle + anchor dots when it doesn't — same
// "missing sprite -> circle, don't crash" pattern as Sprite.ts, just one
// level up. Swap in real art for a template and it's picked up
// automatically on next preload, no code change needed.

import { STRUCTURE_DEFS } from "../lib/ontology.ts";
import type { ImplementedStructureTemplateId } from "../lib/ontology.ts";

export interface StructureAnchorView {
  id: string;
  type: string;
  localX: number;
  localY: number;
  occupiedByMemoryId?: string;
}

export interface StructureObject {
  id: string;
  template_id: ImplementedStructureTemplateId;
  label: string;
  x: number;
  y: number;
  anchors: StructureAnchorView[];
}

const TEMPLATE_TINT: Record<string, string> = {
  small_house: "#8a6a45",
  office: "#5a6b82",
};

// --- structure art preloading (mirrors Sprite.ts's spriteCache) -----------

const artCache = new Map<string, HTMLImageElement>();
let preloadPromise: Promise<void> | null = null;

export function preloadStructureArt(templateIds: readonly string[]): Promise<void> {
  if (preloadPromise) return preloadPromise;

  preloadPromise = Promise.all(
    templateIds.map(
      (templateId) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            artCache.set(templateId, img);
            resolve();
          };
          img.onerror = () => resolve(); // no art yet -> fall through to the crude rectangle
          img.src = `/structures/${templateId}.png`;
        })
    )
  ).then(() => undefined);

  return preloadPromise;
}

export function drawStructure(
  ctx: CanvasRenderingContext2D,
  structure: StructureObject,
  screenX: number,
  screenY: number,
  zoom: number
): void {
  const def = STRUCTURE_DEFS[structure.template_id];
  if (!def) return; // unknown template_id (shouldn't happen) — skip rather than crash

  const w = def.width * zoom;
  const h = def.height * zoom;
  const left = screenX - w / 2;
  const top = screenY - h / 2;
  const art = artCache.get(structure.template_id);

  if (art) {
    ctx.save();
    ctx.drawImage(art, left, top, w, h);
    ctx.restore();
  } else {
    const color = TEMPLATE_TINT[structure.template_id] ?? "#666666";
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(left, top, w, h);
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 2 * zoom);
    ctx.strokeRect(left, top, w, h);
    ctx.restore();
  }

  // Anchor dots stay visible either way — over real art they read as "here's
  // a spot in this room," dimmed once occupied, same as over the crude box.
  for (const anchor of structure.anchors) {
    const ax = left + anchor.localX * zoom;
    const ay = top + anchor.localY * zoom;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax, ay, Math.max(2, 4 * zoom), 0, Math.PI * 2);
    ctx.fillStyle = anchor.occupiedByMemoryId ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.55)";
    ctx.fill();
    ctx.restore();
  }

  if (zoom > 0.6) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#e8e2d8";
    ctx.font = `${Math.max(10, 13 * Math.min(zoom, 1.5))}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(structure.label, screenX, top - 6 * zoom);
    ctx.restore();
  }
}
