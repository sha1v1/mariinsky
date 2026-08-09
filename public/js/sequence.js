// The sequence: a memory given back one thing at a time.
//
// Where compose.js answers "what does this memory look like, all at once", this
// answers "what is in front of you *now*, and what replaces it in four seconds".
// A stream is endless -- it runs until you leave -- so nothing here is a stored
// list of beats. A stream stores a seed, and every beat is derived from it:
//
//     beat i  <-  mulberry32(seed ^ hash(i))
//
// which is what lets an endless thing still be replayed exactly from the
// timeline. Ask for beat 0 again and you get the same picture, the same window,
// the same layers falling out of it in the same order.
//
// Two clocks run past each other on purpose. Beats are one. Drifting words are
// the other, indexed separately and timed in seconds from the start of the
// stream, so a phrase can arrive over one picture and still be there over the
// next. Sound is a third, and mostly ignores both -- see `audioCut`.
import { mulberry32, seed32, range, chance, clamp, r3, shuffle, pickWeighted } from './rng.js';
import { get, sub, pick } from './settings.js';
import { settingsOf, dormancyMap, decayFor, byKind, videoWindow } from './compose.js';

// Distinct odd constants, so beat 3's dice have nothing to do with drift 3's.
const BEAT_SALT = 0x9e3779b1;
const DECK_SALT = 0x85ebca6b;
const DRIFT_SALT = 0xc2b2ae35;

const streamRng = (seed, salt, i) => mulberry32((seed ^ Math.imul(i + 1, salt)) >>> 0);

/**
 * Everything a stream needs to answer questions about itself. Cheap to build
 * and holds no DOM -- the lab rebuilds one on every keystroke.
 *
 * @param {object} orb
 * @param {object} [settings]  normalised; defaults to the orb's own recipe
 * @param {object} [opts]      {seed, decay, hidden:Set}
 */
export function makeStream(orb, settings, opts = {}) {
  const s = settings || settingsOf(orb);
  const hidden = opts.hidden instanceof Set ? opts.hidden : new Set();
  const seed = opts.seed ?? seed32();
  const groups = byKind(orb, s, hidden);
  const dorm = dormancyMap(orb);

  // One entry per *thing you could be looking at*: a whole photo (with its
  // layer pool behind it) or one portion of a clip. Never a lone layer -- a
  // layer is not a memory, it is a piece of one.
  const byImage = new Map();
  for (const id of groups.imageLayer) {
    const src = orb.components[id].src;
    if (!byImage.has(src)) byImage.set(src, []);
    byImage.get(src).push(id);
  }
  const visuals = [
    ...[...byImage].map(([src, layers]) => ({ kind: 'image', key: `i:${src}`, src, layers })),
    ...groups.videoPortion.map((c) => ({ kind: 'video', key: `v:${c}`, c })),
  ];

  // How overdue a thing is, for the weighted deal. Never-seen sits highest.
  const weight = (item) => {
    const ids = item.kind === 'image' ? item.layers : [item.c];
    const best = Math.max(...ids.map((id) => dorm.get(id) ?? 0));
    return 1 + best;
  };

  const n = (orb.versions?.length || 0) + 1;
  const base = opts.decay != null
    ? clamp(opts.decay, 0, 0.94)
    : clamp(decayFor(n) + (orb.strain || 0), 0, 0.94);

  return {
    orb, s, seed, base,
    visuals, weight,
    texts: groups.textFragment,
    audioPool: groups.audioWindow,
    dorm,
    decks: new Map(),
    n,
  };
}

// --------------------------------------------------------------- the rot ----

/**
 * Strain: holding a memory open costs it something. It climbs toward a ceiling
 * rather than forever, so a long sitting is worse than a short one but not
 * unboundedly so. Most of it relaxes when you leave -- see `retainedStrain`.
 */
export function strainAt(stream, i) {
  const ceiling = sub(stream.s, 'sequence.strain', 'ceiling');
  const pace = Math.max(1, sub(stream.s, 'sequence.strain', 'pace'));
  return ceiling * (1 - Math.pow(0.5, Math.max(0, i) / pace));
}

/** What actually sticks to the orb once you put it down. */
export function retainedStrain(stream, i) {
  return r3(strainAt(stream, i) * sub(stream.s, 'sequence.strain', 'retained'));
}

export const decayAt = (stream, i) => clamp(stream.base + strainAt(stream, i), 0, 0.94);

// -------------------------------------------------------------- the deal ----

/**
 * A cycle's worth of what to show, weighted-shuffled so the overdue come up
 * first. The deck has a fixed length, which is what keeps beat -> deck indexing
 * arithmetic instead of recursive; unfairness comes from slots being randomly
 * overwritten rather than from the deck changing size.
 */
function deck(stream, c) {
  if (stream.decks.has(c)) return stream.decks.get(c);
  const rng = streamRng(stream.seed, DECK_SALT, c);
  const pool = stream.visuals;
  const pull = get(stream.s, 'sequence.repeatPull');
  const dealt = pickWeighted(rng, pool, stream.weight, pool.length);
  // A fair deal would march through everything exactly once, which no memory
  // does. Some slots get stolen by whatever the dice fancy instead.
  const out = dealt.map((item) => (chance(rng, (1 - pull) * 0.3) ? pool[Math.floor(rng() * pool.length)] : item));
  stream.decks.set(c, out);
  if (stream.decks.size > 64) stream.decks.delete(stream.decks.keys().next().value);
  return out;
}

function visualAt(stream, i) {
  const pool = stream.visuals;
  if (!pool.length) return null;
  const L = pool.length;
  const d = deck(stream, Math.floor(i / L));
  const item = d[i % L];
  if (i === 0 || L === 1) return item;
  // Two beats of the same thing back to back reads as a stall rather than as a
  // memory circling, so a collision slides one along the deck.
  const prev = deck(stream, Math.floor((i - 1) / L))[(i - 1) % L];
  return item.key === prev?.key ? d[(i % L + 1) % L] : item;
}

// -------------------------------------------------------------- one beat ----

/** The whole of beat `i`: what is on the glass, for how long, and how it goes. */
export function beatAt(stream, i) {
  const { orb, s } = stream;
  const rng = streamRng(stream.seed, BEAT_SALT, i);
  const decay = decayAt(stream, i);

  // A vivid flash suspends everything: no strobing, no blur, full colour, full
  // volume, however far gone the rest of it is.
  const flash = i > 0 && chance(rng, get(s, 'global.flashChance') * 0.09);

  const item = visualAt(stream, i);
  const dark = !item || (!flash && chance(rng, get(s, 'sequence.blackChance')));

  const beat = {
    i, decay: r3(decay), flash,
    kind: dark ? 'black' : item.kind,
    dur: r3(dark ? darkLength(rng, s) : beatLength(rng, s, decay)),
    fade: fadeSpec(rng, s, flash),
    text: textBlock(stream, rng, decay, flash, i),
    audioCut: chance(rng, get(s, 'sequence.audioSync')),
    grade: {
      // The picture itself dims and desaturates with rot; the layers falling in
      // and out of it are a separate story, told below.
      o: flash ? 1 : r3(clamp(pick(rng, s, 'image.plateOpacity') * (1 - decay * 0.3), 0.12, 1)),
      blur: flash ? 0 : r3(decay * 2.4 + pick(rng, s, 'image.blur') * 0.6),
      sat: r3(get(s, `${dark ? 'image' : item.kind}.saturation`) * (flash ? 1 : 1 - decay * 0.35)),
      warp: r3(get(s, 'sequence.warp')),
    },
  };
  if (dark) return beat;

  if (item.kind === 'image') {
    beat.src = item.src;
    beat.layers = imageLayers(stream, item, rng, decay, flash);
  } else {
    const comp = orb.components[item.c];
    beat.c = item.c;
    beat.win = videoWindow(rng, s, comp, orb.sources[comp.src]);
    beat.ramp = rateRamp(rng, s, decay, beat.dur, flash);
    beat.fl = flicker(s, decay, flash);
    beat.grade.o = flash ? 1 : r3(clamp(pick(rng, s, 'video.opacity') * (1 - decay * 0.3), 0.12, 1));
    beat.grade.blur = flash ? 0 : r3(decay * 2.4 + pick(rng, s, 'video.blur') * 0.6);
  }
  return beat;
}

/**
 * Rot pulls the two ends of the beat length apart rather than shifting both one
 * way: a failing memory holds some things far too long and loses others before
 * you have read them. It does not simply get faster.
 */
function beatLength(rng, s, decay) {
  const [lo, hi] = get(s, 'sequence.beat');
  const spread = get(s, 'sequence.beatSpread') * decay;
  return range(rng, Math.max(0.25, lo * (1 - spread * 0.75)), hi * (1 + spread * 0.6));
}

const darkLength = (rng, s) => Math.min(get(s, 'sequence.blackMax'), range(rng, 0.8, get(s, 'sequence.blackMax')));

function fadeSpec(rng, s, flash) {
  const [lo, hi] = get(s, 'sequence.crossfade');
  const len = range(rng, lo, hi);
  return {
    // A flash arrives the way a flash arrives.
    in: r3(flash ? Math.min(0.18, len) : len),
    out: r3(range(rng, lo, hi)),
    black: !flash && chance(rng, get(s, 'sequence.throughBlack')),
  };
}

/**
 * Which layers of this photo are up, and how each one behaves while the beat
 * runs. The *schedule* is what makes this feel like remembering: when the
 * memory is whole a layer sits still and one blinks now and then; as it rots
 * they cut in and out constantly and the picture can barely assemble itself.
 */
function imageLayers(stream, item, rng, decay, flash) {
  const s = stream.s;
  const cap = get(s, 'global.maxImage');
  const spread = get(s, 'image.spread');
  const chaos = get(s, 'image.blendChaos');
  const blendPool = get(s, 'image.blendPool');

  const gap = lerp(sub(s, 'sequence.strobe', 'wholeGap'), sub(s, 'sequence.strobe', 'goneGap'), decay);
  const period = lerp(sub(s, 'sequence.strobe', 'wholeRate'), sub(s, 'sequence.strobe', 'goneRate'), decay);

  // Semantic layers were handed back in a back-to-front order and have to keep
  // it; derived layers are masks of one picture and may stack however.
  const ids = shuffle(rng, item.layers).sort((a, b) => {
    const za = stream.orb.components[a].z, zb = stream.orb.components[b].z;
    if (za == null && zb == null) return 0;
    if (za == null) return 1;
    if (zb == null) return -1;
    return za - zb;
  }).slice(0, cap);

  return ids.map((id) => {
    const hint = stream.orb.components[id].hint || 'normal';
    return {
      c: id,
      o: flash ? 1 : r3(clamp(pick(rng, s, 'image.opacity') * (1 - decay * 0.4), 0.06, 1)),
      b: chance(rng, 1 - chaos) ? hint : blendPool[Math.floor(rng() * blendPool.length)],
      blur: flash ? 0 : r3(decay * 3.2 + pick(rng, s, 'image.blur')),
      dx: r3(range(rng, -spread, spread) * (1 + decay * 2)),
      dy: r3(range(rng, -spread, spread) * (1 + decay * 2)),
      // The player runs this as a timer. `gap` is the chance of being away at
      // any given tick, `period` how often it is asked.
      strobe: flash ? null : { gap: r3(gap), period: r3(period * range(rng, 0.7, 1.4)), phase: r3(rng()) },
    };
  });
}

/**
 * A clip does not play at one speed for four seconds. It ramps between the ends
 * of the bias two to four times, and now and then a stretch runs backwards --
 * which the player has to drive by hand, since no browser plays video in
 * reverse.
 */
function rateRamp(rng, s, decay, dur, flash) {
  if (flash) return [{ at: 0, rate: 1, rev: false }];
  const [lo, hi] = get(s, 'sequence.videoRate');
  const revChance = get(s, 'sequence.reverse') * (0.4 + decay);
  const parts = 2 + Math.floor(rng() * 3);
  const out = [];
  for (let k = 0; k < parts; k++) {
    out.push({
      at: r3((k / parts) * dur),
      rate: r3(range(rng, lo, hi)),
      rev: chance(rng, revChance),
    });
  }
  return out;
}

function flicker(s, decay, flash) {
  const depth = sub(s, 'video.flicker', 'depth');
  // Even with the flicker macro at zero, a rotting memory cannot hold a steady
  // picture. That floor is the rot itself, not a setting someone forgot.
  const floor = flash ? 0 : decay * 0.45;
  const d = Math.max(depth, floor);
  if (d <= 0.001) return null;
  return {
    depth: r3(d),
    rate: r3(Math.max(sub(s, 'video.flicker', 'rate'), 1.5 + decay * 9)),
    dropout: r3(Math.max(sub(s, 'video.flicker', 'dropout'), flash ? 0 : decay * 0.25)),
    jump: r3(Math.max(sub(s, 'video.flicker', 'jump'), flash ? 0 : decay * 0.3)),
  };
}

/**
 * Whether beat `i` wants a held block. Kept in its own roll, off its own salt,
 * so it can be asked about a *neighbouring* beat without composing that beat --
 * which is what makes the no-two-in-a-row rule below possible at all.
 */
const wantsBlock = (stream, i) =>
  i >= 0 && chance(streamRng(stream.seed, 0x7f4a7c15, i), get(stream.s, 'sequence.textBlock'));

/** The block of fragments that holds for a whole beat, if this beat gets one. */
function textBlock(stream, rng, decay, flash, i) {
  if (!stream.texts.length) return null;
  // Two blocks on consecutive beats overlap through the crossfade and the pair
  // is unreadable -- two different sentences stacked on each other at half
  // opacity is not dreamlike, it is just noise. A block always gets a clear
  // beat after it.
  if (!wantsBlock(stream, i) || wantsBlock(stream, i - 1)) return null;
  const s = stream.s;
  const cap = Math.min(get(s, 'global.maxText'), 6);
  const many = 1 + Math.floor(rng() * cap);
  const ids = pickWeighted(rng, stream.texts, (id) => 1 + (stream.dorm.get(id) ?? 0), many);
  if (!ids.length) return null;
  const scaleRange = get(s, 'text.scale');
  return {
    w: r3(pick(rng, s, 'text.width') * 2.2),
    tr: r3(get(s, 'text.tracking')),
    lh: r3(get(s, 'text.leading')),
    gl: r3(get(s, 'text.glow')),
    r: r3(range(rng, -1, 1) * get(s, 'text.rotate') * 0.4),
    frags: ids.map((id) => ({
      c: id,
      o: flash ? 1 : r3(clamp(pick(rng, s, 'text.opacity') * (1 - decay * 0.4), 0.08, 1)),
      sc: r3(flash ? range(rng, scaleRange[1], scaleRange[1] * 1.25) : pick(rng, s, 'text.scale')),
      em: chance(rng, get(s, 'text.emphasis')),
      blur: flash ? 0 : r3(pick(rng, s, 'text.blur') * (chance(rng, 0.5) ? 1 : 0)),
    })),
  };
}

// ------------------------------------------------------------- the drift ----

/**
 * Words that arrive on their own clock and outlive whatever they appeared over.
 * Indexed by arrival, not by beat, and timed in seconds from the start of the
 * stream -- that independence is the entire point of them.
 */
export function driftAt(stream, k) {
  if (!stream.texts.length) return null;
  const s = stream.s;
  const every = sub(s, 'sequence.textDrift', 'every');
  const rng = streamRng(stream.seed, DRIFT_SALT, k);
  // Slop inside the gap rather than a multiplier on it: arrivals have to stay
  // in order for the player to be able to schedule the next one.
  const at = every * (k + 0.35 + range(rng, -0.35, 0.35));
  const id = pickWeighted(rng, stream.texts, (x) => 1 + (stream.dorm.get(x) ?? 0), 1)[0];
  if (!id) return null;
  const [, hi] = get(s, 'text.scale');
  return {
    k, at: r3(at), c: id,
    life: r3(sub(s, 'sequence.textDrift', 'life') * range(rng, 0.7, 1.3)),
    // Kept off the rim: the sphere clips to a circle, and a phrase placed near
    // the edge of the bounding box loses its first few words to the glass.
    x: r3(range(rng, 0.22, 0.78)),
    y: r3(range(rng, 0.18, 0.82)),
    r: r3(range(rng, -1, 1) * get(s, 'text.rotate')),
    sc: r3(range(rng, 0.75, hi)),
    o: r3(range(rng, 0.35, 0.95)),
    em: chance(rng, get(s, 'text.emphasis')),
  };
}

export const driftMost = (stream) => Math.round(sub(stream.s, 'sequence.textDrift', 'most'));

// -------------------------------------------------------------- the ears ----

/**
 * Sound keeps its own clock. This is re-rolled every `audioRefresh` beats, and
 * separately whenever a beat's `audioCut` comes up -- which is the occasional
 * moment where picture and sound move together and it lands like a downbeat.
 */
export function audioAt(stream, gen) {
  const { s, audioPool } = stream;
  if (!audioPool.length) return { strands: [] };
  const rng = streamRng(stream.seed, 0x27d4eb2f, gen);
  const decay = decayAt(stream, gen * get(s, 'sequence.audioRefresh'));
  const many = Math.min(get(s, 'audio.strands'), 1 + Math.floor(rng() * 2));
  const chosen = pickWeighted(rng, audioPool, (id) => 1 + (stream.dorm.get(id) ?? 0), many);

  const drift = get(s, 'audio.pitchDrift');
  const strands = chosen.map((id) => {
    const bands = [1, 1, 1];
    if (chance(rng, get(s, 'audio.bandDropout'))) bands[Math.floor(rng() * 3)] = r3(range(rng, 0, 0.25));
    if (bands.every((v) => v < 0.3)) bands[Math.floor(rng() * 3)] = 1;
    return {
      c: id,
      g: r3(clamp(range(rng, 0.55, 0.9) * (1 - decay * 0.3), 0.18, 1)),
      bands: [
        r3(bands[0]),
        r3(clamp(bands[1] * (1 - decay * 0.2), 0, 1)),
        r3(clamp(bands[2] * (1 - decay * 0.55), 0, 1)),
      ],
      fx: {
        rate: r3(clamp(1 + range(rng, -drift, drift), 0.6, 1.6)),
        rev: chance(rng, get(s, 'audio.reverseChance')),
        verb: r3(clamp(Math.max(range(rng, 0.05, 0.2), decay * 0.5), 0, 0.8)),
        trem: chance(rng, get(s, 'audio.tremolo')) ? r3(range(rng, 1.5, 6.5)) : 0,
      },
      len: r3(pick(rng, s, 'audio.windowLength')),
    };
  });
  return { strands };
}

const lerp = (a, b, t) => a + (b - a) * t;
