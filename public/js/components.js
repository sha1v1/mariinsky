// Turns analysed uploads into the fixed pool of "components" that every future
// version of the orb is assembled from. This happens exactly once, at upload.
import { range, chance, clamp, r3, shuffle } from './rng.js';

const COLOR_NAMES = [
  [10, 10, 12, 'black'], [245, 245, 240, 'white'], [128, 128, 132, 'grey'],
  [200, 55, 50, 'red'], [225, 130, 55, 'orange'], [235, 200, 90, 'yellow'],
  [235, 225, 175, 'straw'], [110, 175, 85, 'green'], [40, 95, 70, 'deep green'],
  [70, 140, 200, 'blue'], [28, 46, 92, 'midnight blue'], [130, 195, 210, 'pale blue'],
  [140, 90, 190, 'violet'], [205, 120, 170, 'pink'], [145, 100, 70, 'brown'],
  [240, 215, 190, 'cream'], [200, 170, 120, 'sand'], [90, 80, 95, 'ash'],
];

export function nameColor(r, g, b) {
  let best = 'grey', bd = Infinity;
  for (const [cr, cg, cb, name] of COLOR_NAMES) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

/** Luminance percentile from the histogram, so tonal bands adapt to the image. */
function percentile(hist, p) {
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= p) return (i + 0.5) / hist.length;
  }
  return 1;
}

/**
 * Image -> 7-11 layers of four different flavours. Tonal and chroma layers cut
 * along the image's own distributions; the edge layer is a ghost line-drawing;
 * shards are torn geographic pieces biased toward busy areas.
 */
export function imageComponents(sid, an, rng) {
  const out = {};
  const add = (key, spec) => { out[`${sid}::${key}`] = { kind: 'imageLayer', src: sid, ...spec }; };

  const p30 = percentile(an.hist, 0.32);
  const p70 = percentile(an.hist, 0.7);

  add('tone-dark', {
    name: 'the dark of it', mode: 'tone',
    lo: 0, hi: r3(Math.max(0.12, p30)), feather: 0.14, boost: 1.9, hint: 'lighten',
  });
  add('tone-mid', {
    name: 'the middle of it', mode: 'tone',
    lo: r3(Math.max(0.04, p30 - 0.06)), hi: r3(Math.min(0.97, p70 + 0.06)), feather: 0.12, boost: 1, hint: 'normal',
  });
  add('tone-light', {
    name: 'the light of it', mode: 'tone',
    lo: r3(Math.min(0.9, p70)), hi: 1.02, feather: 0.13, boost: 1.05, hint: 'screen',
  });

  const clusters = (an.palette || []).slice(0, 4).filter((c) => c.w > 0.06);
  clusters.forEach((c, i) => {
    add(`chroma-${i}`, {
      name: `the ${nameColor(c.r, c.g, c.b)} of it`,
      mode: 'chroma',
      target: [c.r, c.g, c.b],
      radius: Math.round(clamp(c.s * 1.5 + 34, 55, 150)),
      hint: 'normal',
    });
  });

  add('edge', { name: 'the outline of it', mode: 'edge', gain: 3.4, thresh: 0.05, hint: 'screen' });

  const shardNames = ['a torn piece', 'a corner of it', 'a fragment', 'a scrap that survived'];
  const nShards = 2 + Math.floor(rng() * 2);
  const hotspots = edgeHotspots(an.edges, rng, nShards);
  for (let i = 0; i < nShards; i++) {
    add(`shard-${i}`, {
      name: shardNames[i % shardNames.length],
      mode: 'shard',
      poly: tornPolygon(rng, hotspots[i][0], hotspots[i][1]),
      hint: 'normal',
    });
  }
  return out;
}

// Pick grid cells with the most detail, so shards tend to catch the interesting
// part of a photo rather than an empty patch of sky.
function edgeHotspots(edges, rng, count) {
  const G = 16;
  const cells = edges.map((e, i) => ({ e, x: ((i % G) + 0.5) / G, y: (Math.floor(i / G) + 0.5) / G }));
  cells.sort((a, b) => b.e - a.e);
  const top = cells.slice(0, Math.max(count * 4, 12));
  const chosen = shuffle(rng, top).slice(0, count);
  while (chosen.length < count) chosen.push({ x: rng(), y: rng() });
  return chosen.map((c) => [clamp(c.x + range(rng, -0.1, 0.1), 0.12, 0.88), clamp(c.y + range(rng, -0.1, 0.1), 0.12, 0.88)]);
}

function tornPolygon(rng, cx, cy) {
  const n = 9 + Math.floor(rng() * 6);
  const base = range(rng, 0.26, 0.46);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + range(rng, -0.18, 0.18);
    const spike = chance(rng, 0.22) ? range(rng, 1.2, 1.5) : 1;
    const rr = base * range(rng, 0.62, 1.18) * spike;
    pts.push([r3(clamp(cx + Math.cos(a) * rr, -0.15, 1.15)), r3(clamp(cy + Math.sin(a) * rr * 1.15, -0.15, 1.15))]);
  }
  return pts;
}

/** Video -> non-uniform time portions, each looped on its own at replay. */
export function videoComponents(sid, duration, rng) {
  const out = {};
  const cuts = randomCuts(rng, duration, 1.2, 3, 8);
  cuts.forEach(([start, end], i) => {
    out[`${sid}::v${i}`] = {
      kind: 'videoPortion', src: sid,
      start: r3(start), end: r3(end),
      name: `${fmt(start)}–${fmt(end)}`,
    };
  });
  return out;
}

/** Audio -> overlapping listening windows. Frequency banding happens live. */
export function audioComponents(sid, duration, rng, label) {
  const out = {};
  const cuts = randomCuts(rng, duration, 2.5, 3, 7);
  cuts.forEach(([start, end], i) => {
    // Windows breathe past their boundaries a little so they overlap.
    const s = Math.max(0, start - (i ? range(rng, 0, 0.8) : 0));
    const e = Math.min(duration, end + range(rng, 0, 1.2));
    out[`${sid}::a${i}`] = {
      kind: 'audioWindow', src: sid,
      start: r3(s), end: r3(Math.max(s + 1.5, e)),
      name: `${label} at ${fmt(s)}`,
    };
  });
  return out;
}

function randomCuts(rng, duration, minLen, minParts, maxParts) {
  const dur = Math.max(duration || 0, minLen * minParts);
  const k = clamp(Math.round(dur / (minLen * 2.4)), minParts, maxParts);
  const points = [0];
  for (let i = 1; i < k; i++) points.push(range(rng, 0.06, 0.94) * dur);
  points.push(dur);
  points.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i + 1] - points[i] >= minLen) out.push([points[i], points[i + 1]]);
  }
  if (!out.length) out.push([0, dur]);
  return out;
}

/** Text -> phrase fragments. The card id rides along but never constrains it. */
export function textComponents(sid, fragments) {
  const out = {};
  fragments.forEach((text, i) => {
    out[`${sid}::t${i}`] = { kind: 'textFragment', src: sid, text, i };
  });
  return out;
}

export function fmt(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
