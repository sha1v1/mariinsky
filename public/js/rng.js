// Seeded RNG so any stored version can be re-rendered exactly.
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const seed32 = () => (Math.random() * 4294967296) >>> 0;
export const range = (rng, a, b) => a + rng() * (b - a);
export const chance = (rng, p) => rng() < p;
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const r3 = (n) => Math.round(n * 1000) / 1000;

export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Weighted pick without replacement.
export function pickWeighted(rng, items, weightOf, count) {
  const pool = items.slice();
  const out = [];
  while (pool.length && out.length < count) {
    const weights = pool.map(weightOf);
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) break;
    let r = rng() * total;
    let idx = 0;
    while (idx < pool.length - 1 && (r -= weights[idx]) > 0) idx++;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}
