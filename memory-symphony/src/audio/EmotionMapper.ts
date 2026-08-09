// Music theory utilities.
//
// This file used to hold the keyword-scoring "mock AI" that mapped memory text
// to an emotion. That interpretation job now belongs to Claude (see
// server/index.ts). What stays here is the mechanical half: turning the chord
// symbols and key Claude returns into actual notes, voiced sensibly for each
// layer's register and voice-led against the previous chord.
//
// Claude decides *what* the harmony is. This file decides *how it is played*.

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Intervals in semitones from the root, by chord quality. */
const QUALITIES: Record<string, number[]> = {
  "": [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  maj11: [0, 4, 7, 11, 14, 17],
  maj13: [0, 4, 7, 11, 14, 21],
  "maj7#11": [0, 4, 7, 11, 18],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  m11: [0, 3, 7, 10, 14, 17],
  m6: [0, 3, 7, 9],
  madd9: [0, 3, 7, 14],
  "7": [0, 4, 7, 10],
  "9": [0, 4, 7, 10, 14],
  "11": [0, 4, 7, 10, 14, 17],
  "13": [0, 4, 7, 10, 14, 21],
  "7b9": [0, 4, 7, 10, 13],
  "7#9": [0, 4, 7, 10, 15],
  "6": [0, 4, 7, 9],
  "69": [0, 4, 7, 9, 14],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "7sus4": [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
};

/** Folds the many ways a chord quality gets written into the keys above. */
function normalizeQuality(raw: string): string {
  let s = raw.trim().replace(/[\s()]/g, "");
  s = s.replace(/^Major/i, "maj").replace(/^MAJ/, "maj").replace(/^Maj/, "maj");
  s = s.replace(/^Minor/i, "m").replace(/^Min/, "m").replace(/^min/, "m");
  s = s.replace(/^-/, "m");
  // A bare capital M (M, M7, M9) means major, but "m7" must stay minor.
  s = s.replace(/^M(?![a-z])/, "maj");
  s = s.replace(/^Sus/, "sus").replace(/^Add/, "add");
  s = s.replace(/^Dim/, "dim").replace(/^Aug/, "aug").replace(/^°/, "dim").replace(/^\+$/, "aug");
  s = s.replace(/^ø/, "m7b5").replace(/^6\/9$/, "69");
  return s;
}

interface ParsedChord {
  rootPc: number;
  intervals: number[];
}

export function parseChord(symbol: string): ParsedChord {
  const match = /^([A-Ga-g])([#b]?)(.*)$/.exec(symbol.trim());
  if (!match) {
    console.warn(`[music] unparseable chord "${symbol}" — falling back to C major`);
    return { rootPc: 0, intervals: QUALITIES[""] };
  }

  const [, letter, accidental, rest] = match;
  let rootPc = LETTER_PC[letter.toUpperCase()];
  if (accidental === "#") rootPc += 1;
  if (accidental === "b") rootPc -= 1;
  rootPc = ((rootPc % 12) + 12) % 12;

  const quality = normalizeQuality(rest);
  const intervals = QUALITIES[quality];
  if (!intervals) {
    console.warn(`[music] unknown chord quality "${rest}" in "${symbol}" — using major triad`);
    return { rootPc, intervals: QUALITIES[""] };
  }

  return { rootPc, intervals };
}

/** Pitch classes (0-11) of a chord, root first, in chord order. */
export function chordPitchClasses(symbol: string): number[] {
  const { rootPc, intervals } = parseChord(symbol);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const interval of intervals) {
    const pc = (rootPc + interval) % 12;
    if (!seen.has(pc)) {
      seen.add(pc);
      out.push(pc);
    }
  }
  return out;
}

export function chordRootPitchClass(symbol: string): number {
  return parseChord(symbol).rootPc;
}

/** Flat spellings read better for key names than sharps. */
const PC_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

function shiftRoot(letter: string, accidental: string, semitones: number): string {
  let pc = LETTER_PC[letter.toUpperCase()];
  if (accidental === "#") pc += 1;
  if (accidental === "b") pc -= 1;
  return PC_NAMES[(((pc + semitones) % 12) + 12) % 12];
}

/**
 * Moves a chord symbol by n semitones, preserving its quality exactly —
 * "Fmaj9" up a fifth becomes "Cmaj9". Transposing the progression the score is
 * already playing is what keeps a modulation feeling like the same music in a
 * new key rather than a different piece.
 */
export function transposeChord(symbol: string, semitones: number): string {
  const match = /^([A-Ga-g])([#b]?)(.*)$/.exec(symbol.trim());
  if (!match) return symbol;
  const [, letter, accidental, quality] = match;
  return shiftRoot(letter, accidental, semitones) + quality;
}

/** Same, for a key name — "C major" up a fifth becomes "G major". */
export function transposeKey(key: string, semitones: number): string {
  const match = /^([A-Ga-g])([#b]?)\s*(.*)$/.exec(key.trim());
  if (!match) return key;
  const [, letter, accidental, mode] = match;
  const root = shiftRoot(letter, accidental, semitones);
  return mode ? `${root} ${mode}` : root;
}

export function midiToNote(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[pc]}${octave}`;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];

/** Parses "A minor" / "Bb dorian" / "F# major" into a root + scale shape. */
export function parseKey(key: string): { rootPc: number; scale: number[] } {
  const match = /^([A-Ga-g])([#b]?)\s*(.*)$/.exec(key.trim());
  if (!match) return { rootPc: 0, scale: MAJOR_SCALE };

  const [, letter, accidental, modeRaw] = match;
  let rootPc = LETTER_PC[letter.toUpperCase()];
  if (accidental === "#") rootPc += 1;
  if (accidental === "b") rootPc -= 1;
  rootPc = ((rootPc % 12) + 12) % 12;

  const mode = modeRaw.toLowerCase();
  let scale = MAJOR_SCALE;
  if (mode.startsWith("min") || mode === "m" || mode.startsWith("aeolian")) scale = MINOR_SCALE;
  else if (mode.startsWith("dorian")) scale = DORIAN;
  else if (mode.startsWith("lydian")) scale = LYDIAN;
  else if (mode.startsWith("mixo")) scale = MIXOLYDIAN;

  return { rootPc, scale };
}

export function scalePitchClasses(key: string): number[] {
  const { rootPc, scale } = parseKey(key);
  return scale.map((interval) => (rootPc + interval) % 12);
}

/**
 * Chooses actual MIDI notes for a chord inside a register, preferring notes
 * close to the previous voicing so the harmony moves by a step or two rather
 * than leaping. This is what makes a progression change sound intentional
 * instead of abrupt.
 */
export function voiceChord(
  symbol: string,
  range: [number, number],
  previous: number[] = [],
  maxNotes = 4,
): number[] {
  const pcs = chordPitchClasses(symbol).slice(0, Math.max(1, maxNotes));
  const [lo, hi] = range;
  const chosen: number[] = [];

  pcs.forEach((pc, i) => {
    const candidates: number[] = [];
    for (let midi = lo; midi <= hi; midi++) {
      if (((midi % 12) + 12) % 12 === pc) candidates.push(midi);
    }
    if (candidates.length === 0) return;

    let target: number;
    if (previous.length > 0) {
      // Anchor each chord tone to the voice it is replacing.
      target = previous[Math.min(i, previous.length - 1)];
    } else {
      // First voicing: spread evenly across the register.
      target = lo + ((hi - lo) * i) / Math.max(pcs.length, 1);
    }

    const best = candidates.reduce((a, b) =>
      Math.abs(b - target) < Math.abs(a - target) ? b : a,
    );
    chosen.push(best);
  });

  return Array.from(new Set(chosen)).sort((a, b) => a - b);
}

/**
 * A sparse, weighted random walk for the melody layer. Prefers chord tones,
 * prefers stepwise motion, and rests most of the time. Because it derives from
 * the harmony Claude already chose, it stays in key without Claude ever having
 * to send note sequences over the wire.
 *
 * Returns null for a rest.
 */
export function nextMelodyNote(
  chordSymbol: string,
  key: string,
  previous: number | null,
  range: [number, number],
  energy: number,
): number | null {
  // energy -1 -> rests ~97% of the time; energy 1 -> ~47%.
  const restChance = 0.72 - energy * 0.25;
  if (Math.random() < restChance) return null;

  const chordPcs = new Set(chordPitchClasses(chordSymbol));
  const scalePcs = new Set(scalePitchClasses(key));
  const [lo, hi] = range;

  const candidates: { midi: number; weight: number }[] = [];
  for (let midi = lo; midi <= hi; midi++) {
    const pc = ((midi % 12) + 12) % 12;
    const inChord = chordPcs.has(pc);
    if (!inChord && !scalePcs.has(pc)) continue;

    let weight = inChord ? 3 : 1;
    if (previous !== null) {
      const leap = Math.abs(midi - previous);
      if (leap === 0) weight *= 0.3;
      else if (leap <= 2) weight *= 3;
      else if (leap <= 4) weight *= 1.5;
      else if (leap <= 7) weight *= 0.6;
      else weight *= 0.15;
    }
    candidates.push({ midi, weight });
  }

  if (candidates.length === 0) return null;

  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  let roll = Math.random() * total;
  for (const candidate of candidates) {
    roll -= candidate.weight;
    if (roll <= 0) return candidate.midi;
  }
  return candidates[candidates.length - 1].midi;
}
