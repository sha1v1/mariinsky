// Composes the next version of an orb: which components survive, which have
// been lost, which one comes roaring back. Output is a small JSON recipe that
// the renderer (and the history timeline) can replay exactly.
import { mulberry32, seed32, range, chance, clamp, r3, shuffle, pickWeighted } from './rng.js';

const CAPS = { imageLayer: 7, videoPortion: 4, textFragment: 8, audioWindow: 3 };
const BLENDS = ['normal', 'screen', 'lighten', 'soft-light'];

/** Every component id referenced anywhere in a stored version. */
export function idsOf(version) {
  const ids = new Set();
  for (const p of version.plates || []) {
    if (p.k === 'image') for (const l of p.layers) ids.add(l.c);
    else if (p.k === 'video') ids.add(p.c);
    else if (p.k === 'text') for (const f of p.frags) ids.add(f.c);
  }
  for (const s of version.audio?.strands || []) ids.add(s.c);
  return ids;
}

/** Versions elapsed since each component last appeared. Never-seen ranks high. */
function dormancyMap(orb) {
  const seen = new Map();
  orb.versions.forEach((v, i) => { for (const id of idsOf(v)) seen.set(id, i + 1); });
  const total = orb.versions.length;
  const map = new Map();
  for (const id of Object.keys(orb.components)) {
    map.set(id, seen.has(id) ? total - seen.get(id) : total + 2);
  }
  return map;
}

function byKind(orb) {
  const groups = { imageLayer: [], videoPortion: [], textFragment: [], audioWindow: [] };
  for (const [id, c] of Object.entries(orb.components)) {
    if (groups[c.kind]) groups[c.kind].push(id);
  }
  return groups;
}

export function composeVersion(orb) {
  const prev = orb.versions.at(-1) || null;
  const seed = seed32();
  const rng = mulberry32(seed);
  const first = !prev;
  const decay = first ? 0 : clamp(prev.decay + 0.035 + rng() * 0.05, 0, 0.94);

  const groups = byKind(orb);
  const dorm = dormancyMap(orb);
  const prevIds = prev ? idsOf(prev) : new Set();

  // --- the vivid flash -------------------------------------------------
  // Something that has been gone a long time can surface at full clarity while
  // the rest of the memory stays faded. Longer absence, likelier the return.
  const longGone = Object.keys(orb.components).filter((id) => dorm.get(id) >= 5);
  const flash = !first && (chance(rng, 0.14) || (longGone.length > 0 && chance(rng, 0.28)));
  const flashPool = longGone.length ? longGone : Object.keys(orb.components);
  const flashed = flash
    ? pickWeighted(rng, flashPool, (id) => dorm.get(id) + 1, chance(rng, 0.4) ? 2 : 1)
    : [];
  const isFlashed = new Set(flashed);

  // --- selection -------------------------------------------------------
  const chosen = {};
  for (const [kind, ids] of Object.entries(groups)) {
    if (!ids.length) { chosen[kind] = []; continue; }
    let keep;
    if (first) {
      keep = shuffle(rng, ids).filter(() => chance(rng, 0.58));
    } else {
      keep = ids.filter((id) => {
        if (prevIds.has(id)) return chance(rng, 1 - (0.17 + decay * 0.45));
        // A dormant piece claws its way back with rising probability.
        return chance(rng, 0.05 + Math.min(0.4, dorm.get(id) * 0.04));
      });
    }
    for (const id of ids) if (isFlashed.has(id) && !keep.includes(id)) keep.push(id);

    // Below the halfway point of decay a memory always keeps a foothold in
    // every medium it was made of. After that, whole senses can drop out.
    if (!keep.length && (decay < 0.6 || chance(rng, 0.5))) keep.push(shuffle(rng, ids)[0]);

    chosen[kind] = shuffle(rng, keep).slice(0, CAPS[kind]);
  }

  const visuals = chosen.imageLayer.length + chosen.videoPortion.length;
  if (!visuals) {
    const anyVisual = [...groups.imageLayer, ...groups.videoPortion];
    if (anyVisual.length) {
      const id = shuffle(rng, anyVisual)[0];
      chosen[orb.components[id].kind].push(id);
    }
  }

  // --- plates ----------------------------------------------------------
  const imageBySrc = new Map();
  for (const id of chosen.imageLayer) {
    const src = orb.components[id].src;
    if (!imageBySrc.has(src)) imageBySrc.set(src, []);
    imageBySrc.get(src).push(id);
  }

  const textFrags = shuffle(rng, chosen.textFragment);
  const textPlateCount = textFrags.length ? clamp(Math.ceil(textFrags.length / (1 + Math.floor(rng() * 3))), 1, 3) : 0;

  const plateCount = imageBySrc.size + chosen.videoPortion.length + textPlateCount;
  const place = placer(rng, plateCount);
  const plates = [];

  const decayBlur = (id) => (isFlashed.has(id) ? 0 : r3(decay * 3.2 + range(rng, 0, 1.1)));
  const decayOpacity = (id, lo, hi) =>
    isFlashed.has(id) ? 1 : r3(clamp(range(rng, lo, hi) * (1 - decay * 0.4), 0.06, 1));

  for (const [src, layerIds] of imageBySrc) {
    const anyFlashed = layerIds.some((id) => isFlashed.has(id));
    const size = r3(range(rng, 0.3, 0.56) * (anyFlashed ? 1.12 : 1));
    const ratio = aspect(orb.sources[src], 0.7);
    const s = place(size / 2, (size * ratio) / 2);
    plates.push({
      k: 'image', src,
      x: s.x, y: s.y,
      s: size,
      r: r3(range(rng, -9, 9) * (1 + decay)),
      o: anyFlashed ? 1 : r3(clamp(range(rng, 0.7, 1) * (1 - decay * 0.3), 0.1, 1)),
      blur: anyFlashed ? 0 : r3(decay * 2.4 + range(rng, 0, 0.7)),
      z: r3(range(rng, 0, 1)),
      layers: shuffle(rng, layerIds).map((id) => {
        const comp = orb.components[id];
        const hint = comp.hint || 'normal';
        return {
          c: id,
          o: decayOpacity(id, 0.55, 1),
          b: chance(rng, 0.72) ? hint : BLENDS[Math.floor(rng() * BLENDS.length)],
          blur: decayBlur(id),
          dx: r3(range(rng, -0.04, 0.04) * (1 + decay * 2)),
          dy: r3(range(rng, -0.04, 0.04) * (1 + decay * 2)),
        };
      }),
    });
  }

  for (const id of chosen.videoPortion) {
    const size = r3(range(rng, 0.2, 0.4) * (isFlashed.has(id) ? 1.2 : 1));
    const ratio = aspect(orb.sources[orb.components[id].src], 0.56);
    const s = place(size / 2, (size * ratio) / 2);
    plates.push({
      k: 'video', c: id,
      x: s.x, y: s.y,
      s: size,
      r: r3(range(rng, -7, 7) * (1 + decay)),
      o: decayOpacity(id, 0.6, 1),
      blur: decayBlur(id),
      b: chance(rng, 0.75) ? 'normal' : 'screen',
      z: r3(range(rng, 0, 1)),
    });
  }

  if (textPlateCount) {
    const chunks = Array.from({ length: textPlateCount }, () => []);
    // Fragments are dealt round-robin, so one block can hold lines that came
    // from three different cards. That is the cross-contamination.
    textFrags.forEach((id, i) => chunks[i % textPlateCount].push(id));
    for (const chunk of chunks) {
      if (!chunk.length) continue;
      const width = r3(range(rng, 0.2, 0.33));
      // Rough height: fragments wrap to roughly two lines each at these widths.
      const s = place(width / 2, Math.min(0.3, 0.05 * chunk.length + 0.05), 0.44, 0.5);
      plates.push({
        k: 'text',
        x: s.x, y: s.y,
        w: width,
        r: r3(range(rng, -5, 5) * (1 + decay * 0.6)),
        o: r3(clamp(range(rng, 0.75, 1) * (1 - decay * 0.25), 0.15, 1)),
        z: r3(range(rng, 0, 1)),
        frags: chunk.map((id) => ({
          c: id,
          o: decayOpacity(id, 0.5, 1),
          sc: r3(isFlashed.has(id) ? range(rng, 1.15, 1.5) : range(rng, 0.85, 1.25)),
          em: chance(rng, 0.25),
          blur: isFlashed.has(id) ? 0 : r3(decay * 1.6 * (chance(rng, 0.5) ? 1 : 0)),
        })),
      });
    }
  }

  const audio = composeAudio(orb, prev?.audio, groups.audioWindow, rng, decay, isFlashed);

  return {
    n: orb.versions.length + 1,
    at: Date.now(),
    seed,
    decay: r3(decay),
    flash,
    flashed,
    plates,
    audio,
  };
}

const aspect = (src, fallback) => (src?.w && src?.h ? src.h / src.w : fallback);

/**
 * Plates are dealt into jittered polar sectors so they spread around the orb
 * instead of clumping. Each one is pushed no further from centre than its own
 * half-diagonal allows, so nothing gets guillotined by the glass.
 */
function placer(rng, count) {
  const start = rng() * Math.PI * 2;
  const order = shuffle(rng, Array.from({ length: Math.max(1, count) }, (_, i) => i));
  let i = 0;
  // `edge` is how far the plate's own bounding box may reach: pictures are
  // allowed to run under the glass and crop, text has to stay readable.
  // `inner` keeps a plate away from the middle: text is pushed outward so two
  // blocks of it never land on top of each other.
  return (halfW, halfH, edge = 0.56, inner = 0.12) => {
    const k = order[i++ % order.length];
    const angle = start + (k / Math.max(1, count)) * Math.PI * 2 + range(rng, -0.3, 0.3);
    const limit = Math.max(0.04, edge - Math.hypot(halfW, halfH));
    let rad = Math.sqrt(range(rng, inner, 1)) * Math.min(0.36, limit);
    if (count === 1) rad *= 0.4;
    return {
      x: r3(clamp(0.5 + Math.cos(angle) * rad, 0.04, 0.96)),
      y: r3(clamp(0.5 + Math.sin(angle) * rad, 0.04, 0.96)),
    };
  };
}

/**
 * Audio mutation budget, per the brief: 70% of versions change *which windows*
 * play, 20% change the frequency bands, 10% reach for the tape effects. Decay
 * pressure is applied on top of whichever axis moved.
 */
function composeAudio(orb, prevAudio, pool, rng, decay, isFlashed) {
  if (!pool.length) return { strands: [] };

  const live = new Set(pool);
  let strands = (prevAudio?.strands || [])
    .filter((s) => live.has(s.c))
    .map((s) => ({ c: s.c, g: s.g, bands: [...s.bands], fx: { ...s.fx } }));

  const fresh = (id) => ({
    c: id,
    g: r3(range(rng, 0.55, 0.9)),
    bands: [1, 1, 1],
    fx: { rate: 1, rev: false, verb: r3(range(rng, 0.05, 0.2)), trem: 0 },
  });

  if (!strands.length) {
    for (const id of shuffle(rng, pool).slice(0, chance(rng, 0.45) ? 2 : 1)) strands.push(fresh(id));
  } else {
    const roll = rng();
    if (roll < 0.7) {
      // --- windowing: what you hear moves to a different moment ---------
      const unused = pool.filter((id) => !strands.some((s) => s.c === id));
      const move = rng();
      if (move < 0.48 && unused.length) {
        const target = strands[Math.floor(rng() * strands.length)];
        target.c = shuffle(rng, unused)[0];
      } else if (move < 0.76 && unused.length && strands.length < 3) {
        strands.push(fresh(shuffle(rng, unused)[0]));
      } else if (strands.length > 1) {
        strands.splice(Math.floor(rng() * strands.length), 1);
      } else if (unused.length) {
        strands[0].c = shuffle(rng, unused)[0];
      }
    } else if (roll < 0.9) {
      // --- bands: a whole frequency range goes missing or comes back ----
      const target = strands[Math.floor(rng() * strands.length)];
      const b = Math.floor(rng() * 3);
      target.bands[b] = target.bands[b] > 0.5 ? r3(range(rng, 0, 0.25)) : 1;
      if (target.bands.every((v) => v < 0.3)) target.bands[Math.floor(rng() * 3)] = 1;
    } else {
      // --- tape effects -------------------------------------------------
      const target = strands[Math.floor(rng() * strands.length)];
      target.fx.rate = r3(clamp(1 + range(rng, -0.07, 0.07), 0.88, 1.12));
      target.fx.rev = chance(rng, 0.35);
      target.fx.verb = r3(range(rng, 0.2, 0.65));
      target.fx.trem = chance(rng, 0.35) ? r3(range(rng, 1.5, 6.5)) : 0;
    }
  }

  // Decay thins the top end first and floods the room with reverb.
  for (const s of strands) {
    s.g = r3(clamp(s.g * (1 - decay * 0.3), 0.18, 1));
    s.bands[2] = r3(clamp(s.bands[2] * (1 - decay * 0.55), 0, 1));
    s.bands[1] = r3(clamp(s.bands[1] * (1 - decay * 0.2), 0, 1));
    s.fx.verb = r3(clamp(Math.max(s.fx.verb, decay * 0.5), 0, 0.8));
  }

  // A flashed window plays clean and loud, whatever state the rest is in.
  for (const id of isFlashed) {
    if (!live.has(id)) continue;
    const existing = strands.find((s) => s.c === id);
    const clean = { c: id, g: 0.95, bands: [1, 1, 1], fx: { rate: 1, rev: false, verb: 0.12, trem: 0 } };
    if (existing) Object.assign(existing, clean);
    else strands.unshift(clean);
  }

  return { strands: strands.slice(0, 3) };
}
