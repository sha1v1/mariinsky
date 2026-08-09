// Composes the next version of an orb: which components survive, which have
// been lost, which one comes roaring back. Output is a small JSON recipe that
// the renderer (and the history timeline) can replay exactly.
//
// Every number that used to be a literal in here now comes from the orb's
// settings, and almost all of them are *ranges* -- the composer still rolls,
// it just rolls inside walls you built. That is the difference between dialling
// in a look and painting one.
import { mulberry32, seed32, range, chance, clamp, r3, shuffle, pickWeighted } from './rng.js';
import { defaults, normalize, get, sub, pick } from './settings.js';

/**
 * Every component id referenced anywhere in a stored version. A sequence has no
 * plates -- it records `seen`, the pieces it actually got round to showing you
 * before you left -- but dormancy asks the same question of both.
 */
export function idsOf(version) {
  const ids = new Set(version.seen || []);
  for (const p of version.plates || []) {
    if (p.k === 'image') for (const l of p.layers) ids.add(l.c);
    else if (p.k === 'video') ids.add(p.c);
    else if (p.k === 'text') for (const f of p.frags) ids.add(f.c);
  }
  for (const s of version.audio?.strands || []) ids.add(s.c);
  return ids;
}

/** The orb's own recipe, or the schema defaults if it has never been to the lab. */
export function settingsOf(orb) {
  return orb?.settings ? normalize(orb.settings) : defaults();
}

/**
 * How gone a memory is on its nth opening. Fitted to three anchors -- a sixth
 * opening is 30% gone, a twelfth 70%, a twentieth 90% -- which gives a curve
 * that is slow to start, steep through the middle, and has a long tail that
 * never quite arrives at nothing. This replaced a flat "add 3-8% each time",
 * which spent the whole memory far too early and then sat at the cap.
 */
const ROT_MID = 8.485;      // openings by which half of it is gone
const ROT_STEEP = 2.445;    // how abruptly the middle collapses
export function decayFor(n) {
  const t = Math.pow(Math.max(0, n) / ROT_MID, ROT_STEEP);
  return clamp(t / (1 + t), 0, 0.94);
}

/** Versions elapsed since each component last appeared. Never-seen ranks high. */
export function dormancyMap(orb) {
  const seen = new Map();
  orb.versions.forEach((v, i) => { for (const id of idsOf(v)) seen.set(id, i + 1); });
  const total = orb.versions.length;
  const map = new Map();
  for (const id of Object.keys(orb.components)) {
    map.set(id, seen.has(id) ? total - seen.get(id) : total + 2);
  }
  return map;
}

/**
 * Image layers come in two flavours: the ones measured off the photo's own
 * histogram, and the ones a decomposition model carved out semantically. The
 * lab switches between them so you can see the same memory told both ways.
 */
const setOf = (c) => c.set || 'derived';

export function byKind(orb, s, hidden) {
  const groups = { imageLayer: [], videoPortion: [], textFragment: [], audioWindow: [] };
  const want = get(s, 'image.layerSet');
  for (const [id, c] of Object.entries(orb.components)) {
    if (hidden.has(id)) continue;
    if (c.kind === 'imageLayer' && want !== 'both' && setOf(c) !== want) continue;
    if (groups[c.kind]) groups[c.kind].push(id);
  }
  // Asking for semantic layers on a photo that has never been decomposed would
  // otherwise silently empty the orb. Fall back rather than show nothing.
  if (!groups.imageLayer.length && want === 'semantic') {
    for (const [id, c] of Object.entries(orb.components)) {
      if (c.kind === 'imageLayer' && !hidden.has(id)) groups.imageLayer.push(id);
    }
  }
  return groups;
}

/**
 * @param {object} orb
 * @param {object} [settings]  normalised settings; defaults to the orb's own
 * @param {object} [opts]      lab overrides: {seed, decay, hidden:Set, order:Map}
 */
export function composeVersion(orb, settings, opts = {}) {
  const s = settings || settingsOf(orb);
  const hidden = opts.hidden instanceof Set ? opts.hidden : new Set();
  const prev = orb.versions.at(-1) || null;
  const seed = opts.seed ?? seed32();
  const rng = mulberry32(seed);
  const first = !prev;

  // Rot is a function of how many times you have opened this, plus whatever
  // strain past viewings left behind. It is no longer a random walk upward from
  // wherever the last version happened to land.
  const n = orb.versions.length + 1;
  const decay = opts.decay != null
    ? clamp(opts.decay, 0, 0.94)
    : clamp(decayFor(n) + (orb.strain || 0) + (first ? 0 : range(rng, -0.015, 0.015)), 0, 0.94);

  const caps = {
    imageLayer: get(s, 'global.maxImage'),
    videoPortion: get(s, 'global.maxVideo'),
    textFragment: get(s, 'global.maxText'),
    audioWindow: get(s, 'global.maxAudio'),
  };
  const survival = get(s, 'global.survival');
  const clawback = get(s, 'global.returnRate');

  const groups = byKind(orb, s, hidden);
  const dorm = dormancyMap(orb);
  const prevIds = prev ? idsOf(prev) : new Set();
  const visible = (id) => !hidden.has(id);

  // --- the vivid flash -------------------------------------------------
  // Something that has been gone a long time can surface at full clarity while
  // the rest of the memory stays faded. Longer absence, likelier the return.
  const flashBias = get(s, 'global.flashChance');
  const pool = Object.keys(orb.components).filter(visible);
  const longGone = pool.filter((id) => dorm.get(id) >= 5);
  const flash = !first && flashBias > 0 &&
    (chance(rng, flashBias * 0.5) || (longGone.length > 0 && chance(rng, flashBias)));
  const flashPool = longGone.length ? longGone : pool;
  const flashed = flash && flashPool.length
    ? pickWeighted(rng, flashPool, (id) => dorm.get(id) + 1, chance(rng, 0.4) ? 2 : 1)
    : [];
  const isFlashed = new Set(flashed);

  // --- selection -------------------------------------------------------
  const chosen = {};
  for (const [kind, ids] of Object.entries(groups)) {
    if (!ids.length) { chosen[kind] = []; continue; }
    let keep;
    if (first) {
      keep = shuffle(rng, ids).filter(() => chance(rng, survival * 0.7));
    } else {
      keep = ids.filter((id) => {
        if (prevIds.has(id)) return chance(rng, survival * (1 - decay * 0.45));
        // A dormant piece claws its way back with rising probability.
        return chance(rng, clawback * (0.17 + Math.min(1, dorm.get(id) * 0.13)));
      });
    }
    for (const id of ids) if (isFlashed.has(id) && !keep.includes(id)) keep.push(id);

    // Below the halfway point of decay a memory always keeps a foothold in
    // every medium it was made of. After that, whole senses can drop out.
    if (!keep.length && (decay < 0.6 || chance(rng, 0.5))) keep.push(shuffle(rng, ids)[0]);

    chosen[kind] = shuffle(rng, keep).slice(0, caps[kind]);
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
  const blockCap = get(s, 'text.blocks');
  const textPlateCount = textFrags.length
    ? clamp(Math.ceil(textFrags.length / (1 + Math.floor(rng() * 3))), 1, blockCap)
    : 0;

  const plateCount = imageBySrc.size + chosen.videoPortion.length + textPlateCount;
  const place = placer(rng, plateCount, get(s, 'global.scatter'));
  const plates = [];

  // Stacking is a bias with slop, not an order: `zText` says where text likes
  // to sit, `zJitter` says how far the roll may drag it from there.
  const jz = get(s, 'global.zJitter');
  const stack = (kind) => r3(clamp(get(s, `global.z${kind}`) + range(rng, -jz, jz), 0, 1));

  const decayBlur = (id, path) =>
    isFlashed.has(id) ? 0 : r3(decay * 3.2 + pick(rng, s, path));
  const fade = (id, path) =>
    isFlashed.has(id) ? 1 : r3(clamp(pick(rng, s, path) * (1 - decay * 0.4), 0.06, 1));
  const tilt = (path) => {
    const t = get(s, path);
    return r3(range(rng, -t, t) * (1 + decay));
  };

  // --- image plates ---
  const blendPool = get(s, 'image.blendPool');
  const chaos = get(s, 'image.blendChaos');
  const shader = get(s, 'image.shader');
  const shaderSpec = shader === 'none' ? null : {
    kind: shader,
    radius: r3(sub(s, 'image.shaderAmount', 'radius')),
    bloom: r3(sub(s, 'image.shaderAmount', 'bloom')),
    bleed: r3(sub(s, 'image.shaderAmount', 'bleed')),
    haze: r3(sub(s, 'image.shaderAmount', 'haze')),
    drain: r3(sub(s, 'image.shaderAmount', 'drain')),
    lift: r3(sub(s, 'image.shaderAmount', 'lift')),
  };
  const spread = get(s, 'image.spread');

  for (const [src, layerIds] of imageBySrc) {
    const anyFlashed = layerIds.some((id) => isFlashed.has(id));
    const size = r3(pick(rng, s, 'image.size') * (anyFlashed ? 1.12 : 1));
    const ratio = aspect(orb.sources[src], 0.7);
    const p = place(size / 2, (size * ratio) / 2);
    plates.push({
      k: 'image', src,
      x: p.x, y: p.y,
      s: size,
      r: tilt('image.rotate'),
      o: anyFlashed ? 1 : r3(clamp(pick(rng, s, 'image.plateOpacity') * (1 - decay * 0.3), 0.1, 1)),
      blur: anyFlashed ? 0 : r3(decay * 2.4 + pick(rng, s, 'image.blur') * 0.6),
      sat: r3(get(s, 'image.saturation')),
      sh: shaderSpec,
      z: stack('Image'),
      // Derived layers can stack in any order -- they are masks of one picture.
      // Semantic layers cannot: the model handed back a back-to-front order and
      // putting the background over the subject would undo the decomposition.
      // Sorting is stable, so unordered layers keep their shuffle.
      layers: shuffle(rng, layerIds).sort((a, b) => {
        const za = orb.components[a].z, zb = orb.components[b].z;
        if (za == null && zb == null) return 0;
        if (za == null) return 1;
        if (zb == null) return -1;
        return za - zb;
      }).map((id) => {
        const comp = orb.components[id];
        const hint = comp.hint || 'normal';
        return {
          c: id,
          o: fade(id, 'image.opacity'),
          b: chance(rng, 1 - chaos) ? hint : blendPool[Math.floor(rng() * blendPool.length)],
          blur: decayBlur(id, 'image.blur'),
          dx: r3(range(rng, -spread, spread) * (1 + decay * 2)),
          dy: r3(range(rng, -spread, spread) * (1 + decay * 2)),
        };
      }),
    });
  }

  // --- video plates ---
  const flickerDepth = sub(s, 'video.flicker', 'depth');
  const flickerSpec = flickerDepth <= 0.001 ? null : {
    depth: r3(flickerDepth),
    rate: r3(sub(s, 'video.flicker', 'rate')),
    dropout: r3(sub(s, 'video.flicker', 'dropout')),
    jump: r3(sub(s, 'video.flicker', 'jump')),
  };

  for (const id of chosen.videoPortion) {
    const comp = orb.components[id];
    const size = r3(pick(rng, s, 'video.size') * (isFlashed.has(id) ? 1.2 : 1));
    const ratio = aspect(orb.sources[comp.src], 0.56);
    const p = place(size / 2, (size * ratio) / 2);
    plates.push({
      k: 'video', c: id,
      x: p.x, y: p.y,
      s: size,
      r: tilt('video.rotate'),
      o: fade(id, 'video.opacity'),
      blur: decayBlur(id, 'video.blur'),
      sat: r3(get(s, 'video.saturation')),
      rate: r3(get(s, 'video.rate')),
      win: videoWindow(rng, s, comp, orb.sources[comp.src]),
      fl: flickerSpec,
      b: chance(rng, 0.75) ? 'normal' : 'screen',
      z: stack('Video'),
    });
  }

  // --- text plates ---
  if (textPlateCount) {
    const chunks = Array.from({ length: textPlateCount }, () => []);
    // Fragments are dealt round-robin, so one block can hold lines that came
    // from three different cards. That is the cross-contamination.
    textFrags.forEach((id, i) => chunks[i % textPlateCount].push(id));
    const scaleRange = get(s, 'text.scale');
    for (const chunk of chunks) {
      if (!chunk.length) continue;
      const width = r3(pick(rng, s, 'text.width'));
      // Rough height: fragments wrap to roughly two lines each at these widths.
      const p = place(width / 2, Math.min(0.3, 0.05 * chunk.length + 0.05), 0.44, 0.5);
      plates.push({
        k: 'text',
        x: p.x, y: p.y,
        w: width,
        r: tilt('text.rotate'),
        o: r3(clamp(range(rng, 0.75, 1) * (1 - decay * 0.25), 0.15, 1)),
        tr: r3(get(s, 'text.tracking')),
        lh: r3(get(s, 'text.leading')),
        gl: r3(get(s, 'text.glow')),
        z: stack('Text'),
        frags: chunk.map((id) => ({
          c: id,
          o: fade(id, 'text.opacity'),
          sc: r3(isFlashed.has(id)
            ? range(rng, scaleRange[1], scaleRange[1] * 1.25)
            : pick(rng, s, 'text.scale')),
          em: chance(rng, get(s, 'text.emphasis')),
          blur: isFlashed.has(id) ? 0 : r3(pick(rng, s, 'text.blur') * (chance(rng, 0.5) ? 1 : 0)),
        })),
      });
    }
  }

  // The lab's "this take" pane hands back an explicit stacking order. When it
  // does, it wins outright -- that pane is for arranging a result by hand, not
  // for nudging the dice.
  if (opts.order instanceof Map && opts.order.size) applyOrder(plates, opts.order);

  const audio = composeAudio(orb, prev?.audio, groups.audioWindow, rng, decay, isFlashed, s);

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

/** Plate identity for the reorder pane: stable across a re-render of one seed. */
export function plateKey(p) {
  if (p.k === 'image') return `image:${p.src}`;
  if (p.k === 'video') return `video:${p.c}`;
  return `text:${p.frags.map((f) => f.c).join(',')}`;
}

function applyOrder(plates, order) {
  const n = Math.max(1, plates.length - 1);
  for (const p of plates) {
    const want = order.get(plateKey(p));
    if (want != null) p.z = r3(clamp(want / n, 0, 1));
  }
}

/**
 * The window a clip is seen through. The portion cut at upload is the anchor;
 * the settings slide and stretch it. Nothing is ever re-cut -- this is a seek.
 */
export function videoWindow(rng, s, comp, src) {
  const dur = src?.duration || comp.end || 0;
  const want = sub(s, 'video.window', 'length');
  const posBias = sub(s, 'video.window', 'position');
  const jitter = sub(s, 'video.window', 'jitter');
  if (!dur) return { start: comp.start, end: comp.end };

  const len = Math.min(want, Math.max(0.3, dur));
  // Anchor on the component's own cut, then drag it toward the requested
  // position in the clip and shake it by the jitter.
  const anchor = (comp.start + comp.end) / 2 / dur;
  const centre = clamp(anchor + (posBias - anchor) * 0.65 + range(rng, -jitter, jitter) * 0.5, 0, 1);
  let start = clamp(centre * dur - len / 2, 0, Math.max(0, dur - len));
  return { start: r3(start), end: r3(Math.min(dur, start + len)) };
}

const aspect = (src, fallback) => (src?.w && src?.h ? src.h / src.w : fallback);

/**
 * Plates are dealt into jittered polar sectors so they spread around the orb
 * instead of clumping. Each one is pushed no further from centre than its own
 * half-diagonal allows, so nothing gets guillotined by the glass.
 */
function placer(rng, count, scatter = 0.5) {
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
    let rad = Math.sqrt(range(rng, inner, 1)) * Math.min(0.36, limit) * (scatter * 2);
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
 *
 * How a strand *sounds* -- distance, looping, fades -- is not recorded here.
 * That is settings, read live at playback, so turning a knob in the lab is
 * audible without recomposing.
 */
function composeAudio(orb, prevAudio, pool, rng, decay, isFlashed, s) {
  if (!pool.length) return { strands: [] };

  const live = new Set(pool);
  const maxStrands = get(s, 'audio.strands');
  const dropout = get(s, 'audio.bandDropout');
  let strands = (prevAudio?.strands || [])
    .filter((x) => live.has(x.c))
    .map((x) => ({ c: x.c, g: x.g, bands: [...x.bands], fx: { ...x.fx } }));

  const drift = get(s, 'audio.pitchDrift');
  const trem = get(s, 'audio.tremolo');
  const rev = get(s, 'audio.reverseChance');

  const fresh = (id) => ({
    c: id,
    g: r3(range(rng, 0.55, 0.9)),
    bands: [1, 1, 1],
    fx: { rate: 1, rev: false, verb: r3(range(rng, 0.05, 0.2)), trem: 0 },
  });

  if (!strands.length) {
    const n = Math.min(maxStrands, chance(rng, 0.45) ? 2 : 1);
    for (const id of shuffle(rng, pool).slice(0, n)) strands.push(fresh(id));
  } else {
    const roll = rng();
    if (roll < 0.7) {
      // --- windowing: what you hear moves to a different moment ---------
      const unused = pool.filter((id) => !strands.some((x) => x.c === id));
      const move = rng();
      if (move < 0.48 && unused.length) {
        strands[Math.floor(rng() * strands.length)].c = shuffle(rng, unused)[0];
      } else if (move < 0.76 && unused.length && strands.length < maxStrands) {
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
      target.bands[b] = target.bands[b] > 0.5 && chance(rng, dropout) ? r3(range(rng, 0, 0.25)) : 1;
      if (target.bands.every((v) => v < 0.3)) target.bands[Math.floor(rng() * 3)] = 1;
    } else {
      // --- tape effects -------------------------------------------------
      const target = strands[Math.floor(rng() * strands.length)];
      target.fx.rate = r3(clamp(1 + range(rng, -drift, drift), 0.6, 1.6));
      target.fx.rev = chance(rng, rev);
      target.fx.verb = r3(range(rng, 0.2, 0.65));
      target.fx.trem = chance(rng, trem) ? r3(range(rng, 1.5, 6.5)) : 0;
    }
  }

  // Decay thins the top end first and floods the room with reverb.
  for (const x of strands) {
    x.g = r3(clamp(x.g * (1 - decay * 0.3), 0.18, 1));
    x.bands[2] = r3(clamp(x.bands[2] * (1 - decay * 0.55), 0, 1));
    x.bands[1] = r3(clamp(x.bands[1] * (1 - decay * 0.2), 0, 1));
    x.fx.verb = r3(clamp(Math.max(x.fx.verb, decay * 0.5), 0, 0.8));
  }

  // A flashed window plays clean and loud, whatever state the rest is in.
  for (const id of isFlashed) {
    if (!live.has(id)) continue;
    const existing = strands.find((x) => x.c === id);
    const clean = { c: id, g: 0.95, bands: [1, 1, 1], fx: { rate: 1, rev: false, verb: 0.12, trem: 0 } };
    if (existing) Object.assign(existing, clean);
    else strands.unshift(clean);
  }

  // Each strand gets its own window length inside the bias, so two strands
  // rarely breathe in step.
  for (const x of strands) x.len = r3(pick(rng, s, 'audio.windowLength'));

  return { strands: strands.slice(0, maxStrands) };
}
