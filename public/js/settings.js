// The knobs the laboratory turns, declared once, in one place.
//
// Two rules hold this file together:
//
//   1. A setting is a *bias*, not a value. Most of them are ranges -- the
//      composer still rolls inside them, so a memory dialled to your taste is
//      still a memory and not a poster. Anything that reads as a single number
//      here is a probability or a ceiling, never a final answer.
//   2. The schema is data. The lab UI renders itself by walking it, so adding a
//      knob means adding one line here and nothing else anywhere.
//
// A `macro` is one slider that drives several others. Its subs carry a `from`
// mapping so the macro alone is usually enough; touch a sub and that sub goes
// manual and stops listening. Only numbers are ever stored -- the mappings live
// in code, so settings stay JSON.
//
// A group or a control may carry `only: 'collage' | 'sequence'`. Both replay
// modes are real and both are kept, but a knob about where a plate sits on the
// glass means nothing to a memory that shows one thing at a time -- so the lab
// hides what the current mode cannot use rather than leaving dead sliders lying
// around. Nothing is deleted from the stored recipe: switch back and it is all
// still there.

export const SHADERS = [
  { v: 'none', label: 'none' },
  { v: 'blurry', label: 'blurry — out of focus, like it was never sharp' },
  { v: 'dreamy', label: 'dreamy — bloomed and bleeding at the edges' },
  { v: 'distant', label: 'distant — hazed and drained, seen from far off' },
];

const BLENDS = ['normal', 'screen', 'lighten', 'soft-light', 'overlay', 'hard-light'];

const lerp = (a, b, t) => a + (b - a) * t;

export const SCHEMA = [
  {
    group: 'global',
    label: 'the whole memory',
    hint: 'how much survives each opening, and how it is given back to you',
    controls: [
      { k: 'mode', label: 'how it replays', type: 'select', def: 'sequence', options: [
        { v: 'sequence', label: 'sequence — one thing at a time, in time' },
        { v: 'collage', label: 'collage — everything at once, on the glass' },
      ], hint: 'a sequence runs until you leave it; a collage is a single arrangement' },
      { k: 'speed', label: 'playback speed', type: 'range', min: 1, max: 5, step: 0.1, def: 1, unit: '×',
        only: 'sequence',
        hint: 'multiplies the whole clock — beats, strobes, fades, wear. for watching the arc quickly; leave it at 1 for the real thing' },
      { k: 'decay', label: 'decay', type: 'range', min: 0, max: 0.94, step: 0.01, def: 0.2,
        hint: 'frozen while you are in the lab — nothing here advances it' },
      { k: 'survival', label: 'survival', type: 'range', min: 0.2, max: 1, step: 0.01, def: 0.83,
        hint: 'chance a piece that was here last time is here again' },
      { k: 'returnRate', label: 'clawback', type: 'range', min: 0, max: 0.8, step: 0.01, def: 0.3,
        hint: 'how hard a long-absent piece fights its way back' },
      { k: 'flashChance', label: 'vivid flash', type: 'range', min: 0, max: 1, step: 0.01, def: 0.28 },
      { k: 'scatter', label: 'scatter', type: 'range', min: 0, max: 1, step: 0.01, def: 0.5,
        only: 'collage', hint: 'how far from the centre plates are dealt' },
      { k: 'drift', label: 'drift', type: 'range', min: 0, max: 2, step: 0.05, def: 1,
        only: 'collage', hint: 'speed of the slow float' },
      { k: 'grain', label: 'grain', type: 'range', min: 0, max: 2, step: 0.05, def: 1 },
      // Stacking bias per medium. These are what "keep this arrangement" in the
      // take pane writes back into: you rearrange by hand, and the system is
      // told to lean that way from then on. A sequence has no stack -- there is
      // only ever one thing on the glass -- so these are collage's alone.
      { k: 'zImage', label: 'images sit at', type: 'range', min: 0, max: 1, step: 0.01, def: 0.5,
        only: 'collage', hint: '0 is the back of the stack, 1 the front' },
      { k: 'zVideo', label: 'video sits at', type: 'range', min: 0, max: 1, step: 0.01, def: 0.5, only: 'collage' },
      { k: 'zText', label: 'text sits at', type: 'range', min: 0, max: 1, step: 0.01, def: 0.5, only: 'collage' },
      { k: 'zJitter', label: 'stacking jitter', type: 'range', min: 0, max: 1, step: 0.01, def: 0.5,
        only: 'collage', hint: 'how far the roll may wander from those' },
      { k: 'maxImage', label: 'image layers at once', type: 'int', min: 1, max: 16, def: 7 },
      { k: 'maxVideo', label: 'video portions at once', type: 'int', min: 1, max: 8, def: 4, only: 'collage' },
      { k: 'maxText', label: 'text fragments at once', type: 'int', min: 1, max: 24, def: 8 },
      { k: 'maxAudio', label: 'audio windows at once', type: 'int', min: 1, max: 6, def: 3 },
    ],
  },

  {
    group: 'sequence',
    label: 'the sequence',
    only: 'sequence',
    hint: 'one thing at a time, held for a few seconds, then something else — and sound on its own clock underneath',
    controls: [
      { k: 'beat', label: 'beat length', type: 'range2', min: 0.3, max: 16, step: 0.1, def: [3.5, 6], unit: 's',
        hint: 'while the memory is still whole' },
      { k: 'beatSpread', label: 'rot spread', type: 'range', min: 0, max: 1, step: 0.01, def: 0.5,
        hint: 'how far rot drags those two ends apart — some beats snap past, others hang far too long' },
      { k: 'blackChance', label: 'goes dark', type: 'range', min: 0, max: 0.5, step: 0.01, def: 0.1,
        hint: 'chance a beat has no picture at all. sound carries on through it — it is never truly silent' },
      { k: 'blackMax', label: 'longest dark', type: 'number', min: 0.5, max: 6, step: 0.5, def: 6, unit: 's' },
      { k: 'crossfade', label: 'crossfade', type: 'range2', min: 0, max: 5, step: 0.05, def: [0.5, 1.5], unit: 's' },
      { k: 'throughBlack', label: 'fade through black', type: 'range', min: 0, max: 1, step: 0.01, def: 0.25,
        hint: 'chance a cut dips to nothing on the way across instead of dissolving' },
      { k: 'warp', label: 'warp to fill', type: 'range', min: 0, max: 1, step: 0.01, def: 0.35,
        hint: '0 crops the frame until it covers the glass, 1 stretches it. the middle does a little of each' },
      // Strobing is the health meter made visible. Whole, a photo mostly holds
      // together and one layer blinks now and then; far gone, it can barely keep
      // two layers up at once. A vivid flash suspends all of it.
      { k: 'strobe', label: 'layer strobing', type: 'macro', min: 0, max: 1, step: 0.01, def: 0.5, subs: [
        { k: 'wholeGap', label: 'gaps when whole', min: 0, max: 1, step: 0.01, from: (m) => lerp(0, 0.16, m),
          hint: 'chance a layer is missing at 0% rot' },
        { k: 'goneGap', label: 'gaps when gone', min: 0, max: 1, step: 0.01, from: (m) => lerp(0.3, 0.85, m),
          hint: 'and the same chance at 94%' },
        { k: 'wholeRate', label: 'seconds between, whole', min: 0.1, max: 12, step: 0.1, from: (m) => lerp(7, 2.6, m), unit: 's' },
        { k: 'goneRate', label: 'seconds between, gone', min: 0.05, max: 6, step: 0.05, from: (m) => lerp(1.4, 0.2, m), unit: 's' },
      ] },
      { k: 'repeatPull', label: 'pull toward the unseen', type: 'range', min: 0, max: 1, step: 0.01, def: 0.6,
        hint: 'how hard the next beat is dragged toward whatever you have not been shown for longest' },
      { k: 'videoRate', label: 'speed swings', type: 'range2', min: 0.25, max: 2, step: 0.05, def: [0.6, 1.4], unit: '×',
        hint: 'a clip ramps between these inside a single beat' },
      { k: 'reverse', label: 'runs backwards', type: 'range', min: 0, max: 1, step: 0.01, def: 0.12,
        hint: 'chance a stretch plays in reverse — rises as the memory rots' },
      { k: 'textBlock', label: 'held text', type: 'range', min: 0, max: 1, step: 0.01, def: 0.4,
        hint: 'chance a beat carries a block of fragments that stays for its whole length' },
      // Drifting words deliberately ignore the beat clock: they arrive and leave
      // on their own timers and outlive the picture they appeared over.
      { k: 'textDrift', label: 'drifting words', type: 'macro', min: 0, max: 1, step: 0.01, def: 0.45, subs: [
        { k: 'every', label: 'seconds between arrivals', min: 0.4, max: 30, step: 0.2, from: (m) => lerp(16, 2.2, m), unit: 's' },
        { k: 'life', label: 'how long one stays', min: 0.5, max: 20, step: 0.1, from: (m) => lerp(2.5, 8, m), unit: 's' },
        { k: 'most', label: 'at once', min: 0, max: 8, step: 1, from: (m) => Math.round(lerp(1, 5, m)) },
      ] },
      { k: 'audioSync', label: 'sound cuts with the picture', type: 'range', min: 0, max: 1, step: 0.01, def: 0.15,
        hint: 'usually the two run on separate clocks. now and then a cut lands on both at once' },
      { k: 'audioRefresh', label: 'beats between sound changes', type: 'int', min: 1, max: 24, def: 6 },
      // Holding a memory in your hands costs it something, but not all of that
      // sticks: most of the strain relaxes once you put the orb down.
      { k: 'strain', label: 'wears out as you watch', type: 'macro', min: 0, max: 1, step: 0.01, def: 0.5, subs: [
        { k: 'ceiling', label: 'most it can add', min: 0, max: 0.4, step: 0.005, from: (m) => lerp(0, 0.25, m) },
        { k: 'pace', label: 'beats to halfway', min: 4, max: 120, step: 1, from: (m) => Math.round(lerp(70, 12, m)) },
        { k: 'retained', label: 'kept when you leave', min: 0, max: 1, step: 0.01, from: (m) => lerp(0, 0.5, m),
          hint: 'the rest of the strain relaxes once the orb is closed' },
      ] },
    ],
  },

  {
    group: 'text',
    label: 'text',
    hint: 'fragments are cut at upload; everything here is how they are shown',
    controls: [
      { k: 'opacity', label: 'opacity', type: 'range2', min: 0, max: 1, step: 0.01, def: [0.5, 1] },
      { k: 'blur', label: 'blur', type: 'range2', min: 0, max: 6, step: 0.1, def: [0, 1.6], unit: 'px' },
      { k: 'scale', label: 'size', type: 'range2', min: 0.4, max: 3, step: 0.05, def: [0.85, 1.25], unit: 'em' },
      { k: 'rotate', label: 'tilt', type: 'range', min: 0, max: 30, step: 0.5, def: 5, unit: '°',
        hint: 'symmetrical — the roll picks a side' },
      { k: 'tracking', label: 'letter spacing', type: 'range', min: -0.05, max: 0.4, step: 0.005, def: 0.02, unit: 'em' },
      { k: 'leading', label: 'line height', type: 'range', min: 0.9, max: 2.6, step: 0.05, def: 1.5 },
      { k: 'emphasis', label: 'emphasis', type: 'range', min: 0, max: 1, step: 0.01, def: 0.25,
        hint: 'chance a fragment comes out italic' },
      { k: 'glow', label: 'glow', type: 'range', min: 0, max: 1, step: 0.01, def: 0.15 },
      { k: 'blocks', label: 'blocks', type: 'int', min: 1, max: 6, def: 3, only: 'collage',
        hint: 'fragments are dealt round-robin into this many blocks' },
      { k: 'width', label: 'block width', type: 'range2', min: 0.1, max: 0.6, step: 0.01, def: [0.2, 0.33] },
      { k: 'maxWords', label: 'words per fragment', type: 'int', min: 2, max: 20, def: 7, applies: 'new',
        hint: 'shredding rule — only bites on orbs made from here on' },
      { k: 'maxChars', label: 'characters per fragment', type: 'int', min: 12, max: 120, def: 45, applies: 'new' },
    ],
  },

  {
    group: 'image',
    label: 'image',
    controls: [
      { k: 'layerSet', label: 'layers from', type: 'select', def: 'derived', options: [
        { v: 'derived', label: 'derived — tone, colour, outline, torn shards' },
        { v: 'semantic', label: 'semantic — Qwen subject/background layers' },
        { v: 'both', label: 'both, mixed together' },
      ], hint: 'semantic only appears on images you have decomposed' },
      { k: 'shader', label: 'shader', type: 'select', def: 'none', options: SHADERS },
      { k: 'shaderAmount', label: 'shader amount', type: 'macro', min: 0, max: 1, step: 0.01, def: 0.5, subs: [
        { k: 'radius', label: 'blur radius', min: 0, max: 24, step: 0.5, from: (m) => lerp(0, 14, m), unit: 'px' },
        { k: 'bloom', label: 'bloom', min: 0, max: 1, step: 0.01, from: (m) => lerp(0, 0.8, m) },
        { k: 'bleed', label: 'colour bleed', min: 0, max: 1, step: 0.01, from: (m) => lerp(0, 0.55, m) },
        { k: 'haze', label: 'haze', min: 0, max: 1, step: 0.01, from: (m) => lerp(0, 0.7, m) },
        { k: 'drain', label: 'drain colour', min: 0, max: 1, step: 0.01, from: (m) => lerp(0, 0.75, m) },
        { k: 'lift', label: 'lift blacks', min: 0, max: 1, step: 0.01, from: (m) => lerp(0, 0.45, m) },
      ] },
      { k: 'opacity', label: 'layer opacity', type: 'range2', min: 0, max: 1, step: 0.01, def: [0.55, 1] },
      { k: 'plateOpacity', label: 'plate opacity', type: 'range2', min: 0, max: 1, step: 0.01, def: [0.7, 1] },
      { k: 'blur', label: 'blur', type: 'range2', min: 0, max: 12, step: 0.1, def: [0, 1.1], unit: 'px' },
      { k: 'size', label: 'size', type: 'range2', min: 0.1, max: 1, step: 0.01, def: [0.3, 0.56], only: 'collage' },
      { k: 'rotate', label: 'tilt', type: 'range', min: 0, max: 40, step: 0.5, def: 9, unit: '°', only: 'collage' },
      { k: 'spread', label: 'layer spread', type: 'range', min: 0, max: 0.3, step: 0.005, def: 0.04,
        hint: 'how far layers of one photo slide off each other' },
      { k: 'saturation', label: 'saturation', type: 'range', min: 0, max: 2, step: 0.02, def: 1 },
      { k: 'blendChaos', label: 'blend chaos', type: 'range', min: 0, max: 1, step: 0.01, def: 0.28,
        hint: 'chance a layer ignores its natural blend mode' },
      { k: 'blendPool', label: 'blend modes', type: 'multi', def: BLENDS.slice(0, 4), options: BLENDS },
    ],
  },

  {
    group: 'video',
    label: 'video',
    controls: [
      { k: 'window', label: 'window', type: 'macro', min: 0, max: 1, step: 0.01, def: 0.4, subs: [
        { k: 'length', label: 'length', min: 0.3, max: 30, step: 0.1, from: (m) => lerp(0.6, 14, m * m), unit: 's' },
        { k: 'position', label: 'position in clip', min: 0, max: 1, step: 0.01, from: () => 0.5,
          hint: '0 is the head of the clip, 1 the tail' },
        { k: 'jitter', label: 'jitter', min: 0, max: 1, step: 0.01, from: (m) => lerp(0.05, 0.5, m) },
      ], hint: 'overrides the portion cut at upload — the clip is re-seeked, never re-cut' },
      { k: 'flicker', label: 'flicker', type: 'macro', min: 0, max: 1, step: 0.01, def: 0, subs: [
        { k: 'depth', label: 'depth', min: 0, max: 1, step: 0.01, from: (m) => lerp(0, 0.85, m),
          hint: 'how dark the dips go' },
        { k: 'rate', label: 'rate', min: 0.2, max: 30, step: 0.1, from: (m) => lerp(1.5, 18, m), unit: '/s' },
        { k: 'dropout', label: 'dropout', min: 0, max: 1, step: 0.01, from: (m) => lerp(0, 0.35, m),
          hint: 'chance of a whole frame going missing' },
        { k: 'jump', label: 'jump', min: 0, max: 1, step: 0.01, from: (m) => lerp(0, 0.5, m),
          hint: 'chance the picture skips somewhere else in its window' },
      ] },
      { k: 'opacity', label: 'opacity', type: 'range2', min: 0, max: 1, step: 0.01, def: [0.6, 1] },
      { k: 'blur', label: 'blur', type: 'range2', min: 0, max: 12, step: 0.1, def: [0, 1.1], unit: 'px' },
      { k: 'size', label: 'size', type: 'range2', min: 0.1, max: 1, step: 0.01, def: [0.2, 0.4], only: 'collage' },
      { k: 'rotate', label: 'tilt', type: 'range', min: 0, max: 40, step: 0.5, def: 7, unit: '°', only: 'collage' },
      { k: 'saturation', label: 'saturation', type: 'range', min: 0, max: 2, step: 0.02, def: 1 },
      // A sequence ramps the rate around inside a beat instead, off
      // `sequence.videoRate` -- one flat number would waste the tape.
      { k: 'rate', label: 'playback rate', type: 'range', min: 0.15, max: 2, step: 0.01, def: 1, unit: '×', only: 'collage' },
    ],
  },

  {
    group: 'audio',
    label: 'audio',
    hint: 'a window fades in, plays, fades out, and the room is quiet for a while',
    controls: [
      { k: 'distance', label: 'distance', type: 'macro', min: 0, max: 1, step: 0.01, def: 0.35, subs: [
        { k: 'gain', label: 'level', min: 0, max: 1, step: 0.01, from: (m) => lerp(0.9, 0.16, m) },
        { k: 'lowpass', label: 'air', min: 200, max: 18000, step: 50, from: (m) => lerp(16000, 620, m * m), unit: 'Hz',
          hint: 'the far side of a wall has no top end' },
        { k: 'reverb', label: 'room', min: 0, max: 1, step: 0.01, from: (m) => lerp(0.05, 0.75, m) },
        { k: 'width', label: 'width', min: 0, max: 1, step: 0.01, from: (m) => lerp(0.15, 0.9, m) },
        { k: 'predelay', label: 'pre-delay', min: 0, max: 0.25, step: 0.005, from: (m) => lerp(0, 0.12, m), unit: 's' },
      ] },
      { k: 'loop', label: 'loop it', type: 'toggle', def: true },
      { k: 'gap', label: 'seconds between loops', type: 'number', min: 0, max: 120, step: 0.5, def: 4, unit: 's' },
      { k: 'gapJitter', label: 'gap jitter', type: 'range', min: 0, max: 1, step: 0.01, def: 0.25,
        hint: 'so the strands drift apart instead of marching in step' },
      { k: 'fadeIn', label: 'fade in', type: 'number', min: 0, max: 20, step: 0.1, def: 1.8, unit: 's' },
      { k: 'fadeOut', label: 'fade out', type: 'number', min: 0, max: 20, step: 0.1, def: 2.4, unit: 's' },
      { k: 'windowLength', label: 'window length', type: 'range2', min: 1, max: 40, step: 0.5, def: [4, 12], unit: 's',
        hint: 'overrides the window cut at upload' },
      { k: 'strands', label: 'strands at once', type: 'int', min: 1, max: 5, def: 3 },
      { k: 'pitchDrift', label: 'pitch drift', type: 'range', min: 0, max: 0.4, step: 0.005, def: 0.07 },
      { k: 'tremolo', label: 'tremolo', type: 'range', min: 0, max: 1, step: 0.01, def: 0.2 },
      { k: 'reverseChance', label: 'reversal', type: 'range', min: 0, max: 1, step: 0.01, def: 0.12 },
      { k: 'bandDropout', label: 'band dropout', type: 'range', min: 0, max: 1, step: 0.01, def: 0.3,
        hint: 'how readily a whole frequency range goes missing' },
    ],
  },
];

const GROUPS = new Map(SCHEMA.map((g) => [g.group, g]));
const controlOf = (group, k) => GROUPS.get(group)?.controls.find((c) => c.k === k) || null;

/** A fresh settings object, straight from the schema's own defaults. */
export function defaults() {
  const out = {};
  for (const g of SCHEMA) {
    out[g.group] = {};
    for (const c of g.controls) out[g.group][c.k] = defaultFor(c);
  }
  return out;
}

function defaultFor(c) {
  if (c.type === 'macro') return { m: c.def, manual: {} };
  if (c.type === 'range2' || c.type === 'multi') return [...c.def];
  return c.def;
}

const num = (v, lo, hi, fb) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : fb);

/**
 * Anything read off disk or pasted in from another orb goes through here, so a
 * stale or hand-mangled settings blob can never reach the composer.
 */
export function normalize(stored) {
  const out = defaults();
  if (!stored || typeof stored !== 'object') return out;
  for (const g of SCHEMA) {
    const src = stored[g.group];
    if (!src || typeof src !== 'object') continue;
    for (const c of g.controls) {
      const v = src[c.k];
      if (v === undefined) continue;
      out[g.group][c.k] = coerce(c, v, out[g.group][c.k]);
    }
  }
  return out;
}

function coerce(c, v, fb) {
  switch (c.type) {
    case 'toggle':
      return !!v;
    case 'select':
      return c.options.some((o) => o.v === v) ? v : fb;
    case 'multi': {
      const keep = Array.isArray(v) ? v.filter((x) => c.options.includes(x)) : [];
      return keep.length ? keep : fb;
    }
    case 'int':
      return Math.round(num(v, c.min, c.max, fb));
    case 'range2': {
      if (!Array.isArray(v) || v.length !== 2) return fb;
      const lo = num(v[0], c.min, c.max, fb[0]);
      const hi = num(v[1], c.min, c.max, fb[1]);
      return lo <= hi ? [lo, hi] : [hi, lo];
    }
    case 'macro': {
      const m = num(v?.m, c.min, c.max, fb.m);
      const manual = {};
      for (const s of c.subs) {
        if (v?.manual?.[s.k] !== undefined) manual[s.k] = num(v.manual[s.k], s.min, s.max, s.from(m));
      }
      return { m, manual };
    }
    default:
      return num(v, c.min, c.max, fb);
  }
}

/** `get(s, 'image.blur')` -> whatever that control stores. */
export function get(settings, path) {
  const [group, k] = path.split('.');
  const v = settings?.[group]?.[k];
  return v === undefined ? defaultFor(controlOf(group, k) || { def: 0 }) : v;
}

/**
 * A macro sub-value: the manual override if one was set, otherwise whatever the
 * macro's own mapping says. This is the only way the renderers should ask.
 */
export function sub(settings, path, subKey) {
  const [group, k] = path.split('.');
  const c = controlOf(group, k);
  const s = c?.subs?.find((x) => x.k === subKey);
  if (!s) return 0;
  const stored = settings?.[group]?.[k];
  const manual = stored?.manual?.[subKey];
  return manual === undefined ? s.from(stored?.m ?? c.def) : manual;
}

/** Is this sub currently ignoring its macro? The lab marks those. */
export function isManual(settings, path, subKey) {
  const [group, k] = path.split('.');
  return settings?.[group]?.[k]?.manual?.[subKey] !== undefined;
}

/**
 * Does this group or control mean anything in the given replay mode? Used by
 * the lab to hide knobs the current mode cannot act on. It never strips them
 * from the stored recipe -- switching modes brings them all back.
 */
export const applies = (entry, mode) => !entry.only || entry.only === mode;

/** Roll inside a range2 bias. Every "the composer still decides" call goes here. */
export function pick(rng, settings, path) {
  const [lo, hi] = get(settings, path);
  return lo + (hi - lo) * rng();
}

export { controlOf };
