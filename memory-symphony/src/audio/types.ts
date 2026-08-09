// Shared contract between the backend (Claude) and the AudioEngine.
// Kept in src/ so the frontend can import it directly; the server imports the
// same file so both sides stay in sync.

/** Instrument vocabulary the AudioEngine can actually build a voice for. */
export const INSTRUMENTS = [
  // Sustained beds and textures
  "ambient pad",
  "strings",
  "soft strings",
  "cello",
  "choir",
  "glass",
  // Melodic figures
  "piano",
  "celesta",
  "marimba",
  "vibraphone",
  "harp",
  "plucked strings",
  "synth lead",
  // Low end
  "bass",
  "sub drone",
  // Percussion
  "kick",
  "tom",
  "shaker",
  "rim",
  "cymbal",
] as const;

export type Instrument = (typeof INSTRUMENTS)[number];

/** Grouping for the instrument toggles, and for describing the palette to Claude. */
export const INSTRUMENT_GROUPS: { label: string; instruments: Instrument[] }[] = [
  {
    label: "Sustained",
    instruments: ["ambient pad", "strings", "soft strings", "cello", "choir", "glass"],
  },
  {
    label: "Melodic",
    instruments: ["piano", "celesta", "marimba", "vibraphone", "harp", "plucked strings", "synth lead"],
  },
  { label: "Low", instruments: ["bass", "sub drone"] },
  { label: "Percussion", instruments: ["kick", "tom", "shaker", "rim", "cymbal"] },
];

/**
 * Ambience biases the palette Claude composes in — key colour, tempo band,
 * instrument choice, harmonic language. It does not override the memory: a sad
 * memory in "upbeat" should come back bittersweet and moving, not falsely
 * cheerful. The memory supplies the emotion; the ambience supplies the accent.
 */
export const AMBIENCES = [
  { id: "natural", label: "Natural", description: "Read the memory on its own terms." },
  { id: "upbeat", label: "Upbeat", description: "Brighter, faster, more movement." },
  { id: "melancholy", label: "Melancholy", description: "Minor, slower, darker colour." },
  { id: "dreamlike", label: "Dreamlike", description: "Weightless, suspended, unresolved." },
  { id: "cinematic", label: "Cinematic", description: "Big, swelling, wide ensemble." },
  { id: "intimate", label: "Intimate", description: "Small and close. Piano-led." },
] as const;

export type AmbienceId = (typeof AMBIENCES)[number]["id"];

export const AMBIENCE_IDS: readonly string[] = AMBIENCES.map((a) => a.id);

/**
 * The current emotional identity of the soundtrack. Owned by the AudioEngine,
 * sent up with every request so Claude knows where it is starting from.
 */
export interface AudioState {
  tempo: number;
  /** -1 (dark) .. 1 (bright) — drives the master low-pass cutoff. */
  brightness: number;
  /** -1 (thin) .. 1 (warm) — drives a low-shelf boost. */
  warmth: number;
  /** -1 (still) .. 1 (driving) — drives note density and velocity. */
  energy: number;
  /** -1 (settled) .. 1 (unresolved) — drives chorus depth / delay feedback. */
  tension: number;

  activeLayers: {
    instrument: string;
    volume: number;
  }[];

  /** e.g. "C major" / "A minor". */
  key: string;
  /** Chord symbols, e.g. ["Cmaj9", "Am7", "Fmaj7", "Gsus2"]. */
  chordProgression: string[];
}

export interface HarmonyDirection {
  key: string;
  chordProgression: string[];
  /** Chord shared by the old and new key, held during the crossover. */
  pivotChord: string;
  /** How many bars to hold the pivot before adopting the new progression. */
  transitionBars: number;
  /** Bars per chord. Larger = slower, more ambient. */
  harmonicRhythm: number;
}

export interface LayerChange {
  instrument: string;
  action: "add" | "increase" | "decrease";
  targetVolume: number;
  transitionSeconds: number;
}

/** What Claude returns: a target emotional state plus how to move toward it. */
export interface MusicAnalysis {
  emotion: string;

  targetState: {
    tempo: number;
    brightness: number;
    warmth: number;
    energy: number;
    tension: number;
  };

  layerChanges: LayerChange[];

  effects: {
    reverb: number;
    filterFrequency: number;
  };

  harmony: HarmonyDirection;
}

/**
 * Deliberately neutral-warm rather than all-zeros, so the first memory has
 * somewhere to move *from* instead of feeling like a cold start.
 */
export const SEED_STATE: AudioState = {
  tempo: 80,
  brightness: 0,
  warmth: 0.3,
  energy: 0.2,
  tension: 0,
  activeLayers: [],
  key: "C major",
  chordProgression: ["Cmaj9", "Em9", "Am7", "Fmaj7", "Dm9", "Gsus2"],
};
