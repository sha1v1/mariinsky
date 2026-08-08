// A marble takes its colour from the marbles already on the wall. The pick is
// deterministic -- seeded by the memory's own id -- so a marble looks the same
// on every load and for every visitor, but *which* colours are available
// depends on what the garden already holds. The wall's palette therefore
// inherits from itself and drifts, the way a real jar of marbles does.
//
// This module is imported by both the browser and the server, so it must stay
// free of DOM and node APIs.
import { mulberry32, range, clamp } from './rng.js';

// Only used before the wall has a palette of its own -- the colours of the
// objects on an i-spy page.
export const SEED_PALETTE = [
  '#d8362a', '#e8792b', '#f2c230', '#5fa845',
  '#3fa9b8', '#3d6fc4', '#8b5bc4', '#e06a9e',
];

/** Stable 32-bit hash of a memory id, so the same id always draws the same rolls. */
export function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hexToRgb(hex) {
  const s = hex.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}

export function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const HUE_BINS = 12;
const binOf = (hex) => Math.floor(rgbToHsl(...hexToRgb(hex))[0] * HUE_BINS) % HUE_BINS;

/**
 * Pick this memory's marble colour out of the colours already on the wall.
 *
 * The parent is chosen deterministically from `wallColors`, then nudged in hue,
 * saturation and lightness -- enough that a new marble reads as a relative of
 * something already in the jar rather than a duplicate of it. With an empty
 * wall it falls back to the seed palette, so the very first marbles are the
 * only ones that do not descend from anything.
 *
 * The pick is weighted *against* how much of that hue the wall already holds.
 * A plain uniform pick is the obvious implementation and it is wrong: because
 * every marble inherits, small early accidents compound, and by eighty marbles
 * the wall has reliably collapsed into one corner of the colour wheel -- all
 * reds, or all blues, with half the hues never appearing at all. Leaning on the
 * rarer parents keeps the jar mixed while every colour still comes from a
 * colour that was already here.
 */
export function marbleColor(id, wallColors = []) {
  const rng = mulberry32(hashId(id));
  const pool = wallColors.filter((c) => /^#[0-9a-f]{6}$/i.test(c));

  // Even with a full wall, one marble in eight is drawn fresh, so a hue the
  // garden has never held can still turn up.
  const fromWall = pool.length > 0 && rng() > 0.12;

  let source;
  if (fromWall) {
    const counts = new Array(HUE_BINS).fill(0);
    for (const c of pool) counts[binOf(c)]++;
    const weights = pool.map((c) => 1 / Math.pow(1 + counts[binOf(c)], 1.6));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let i = 0;
    while (i < pool.length - 1 && (r -= weights[i]) > 0) i++;
    source = pool[i];
  } else {
    source = SEED_PALETTE[Math.floor(rng() * SEED_PALETTE.length)];
  }

  const [h, s, l] = rgbToHsl(...hexToRgb(source));
  const drift = fromWall ? 0.075 : 0.02;
  return hslToHex(
    (h + range(rng, -drift, drift) + 1) % 1,
    clamp(s * range(rng, 0.82, 1.16), 0.34, 0.94),
    clamp(l * range(rng, 0.9, 1.14), 0.36, 0.68),
  );
}

/**
 * The rest of a marble's physical identity, also derived from its id: the angle
 * of the cat's-eye vane inside it, how wide the vane is, and where the light
 * catches. Two marbles the same colour are still never the same marble.
 */
export function marbleTraits(id) {
  const rng = mulberry32(hashId(id) ^ 0x9e3779b9);
  return {
    vane: Math.round(range(rng, 0, 180)),
    vaneWidth: Math.round(range(rng, 26, 52)),
    twist: Math.round(range(rng, -34, 34)),
    highlightX: Math.round(range(rng, 26, 40)),
    highlightY: Math.round(range(rng, 22, 34)),
    bobDelay: -Math.round(range(rng, 0, 9000)),
    bobDur: Math.round(range(rng, 6200, 11500)),
  };
}
