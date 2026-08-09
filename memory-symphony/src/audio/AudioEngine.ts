import * as Tone from "tone";
import {
  midiToNote,
  nextMelodyNote,
  transposeChord,
  transposeKey,
  voiceChord,
} from "./EmotionMapper";
import { SEED_STATE, type AudioState, type MusicAnalysis } from "./types";
import { getTuning, modulationInterval } from "./tuning";

/**
 * Pitched instruments are PolySynths, but drums are MembraneSynth/NoiseSynth
 * with incompatible trigger signatures (NoiseSynth takes no note at all).
 * Wrapping each in a common handle keeps playLayer from having to care.
 */
interface VoiceHandle {
  node: Tone.ToneAudioNode;
  play(notes: string[], duration: number, time: number, velocity: number): void;
  dispose(): void;
}

type Role =
  | "bed"
  | "swell"
  | "counter"
  | "figure"
  | "arpeggio"
  | "melody"
  | "bass"
  | "drone"
  | "percussive";

interface LayerSpec {
  role: Role;
  /** Tone.Loop interval — follows the transport, so tempo changes carry through. */
  interval: string;
  /** MIDI range this layer voices chords into. */
  range: [number, number];
  maxNotes: number;
  /** Base cutoff for this layer's own filter, which a slow LFO drifts around. */
  cutoff: number;
  /** Noise-based percussion wants a highpass; everything else a lowpass. */
  filterType?: BiquadFilterType;
  /**
   * Percussive layers only: per-step velocities, cycled. One entry per
   * `interval`, so a length-8 pattern at "4n" spans two bars. 0 is a rest.
   */
  pattern?: number[];
}

/**
 * Each instrument gets a distinct role, register and rhythm. This is what stops
 * the texture being block harmony in lockstep — layers move independently and
 * occupy different octaves.
 */
const ARRANGEMENT: Record<string, LayerSpec> = {
  // --- sustained beds and textures ---
  "ambient pad": { role: "bed", interval: "2m", range: [36, 64], maxNotes: 5, cutoff: 1800 },
  strings: { role: "swell", interval: "2m", range: [48, 72], maxNotes: 4, cutoff: 2200 },
  "soft strings": { role: "counter", interval: "1m", range: [52, 76], maxNotes: 3, cutoff: 2600 },
  cello: { role: "swell", interval: "2m", range: [33, 57], maxNotes: 2, cutoff: 1200 },
  choir: { role: "bed", interval: "2m", range: [50, 74], maxNotes: 4, cutoff: 2000 },
  glass: { role: "counter", interval: "1m", range: [72, 96], maxNotes: 3, cutoff: 6000 },

  // --- melodic figures ---
  piano: { role: "figure", interval: "4n", range: [48, 74], maxNotes: 4, cutoff: 3200 },
  celesta: { role: "figure", interval: "4n", range: [72, 96], maxNotes: 4, cutoff: 6500 },
  marimba: { role: "figure", interval: "8n", range: [55, 79], maxNotes: 4, cutoff: 3800 },
  vibraphone: { role: "figure", interval: "4n", range: [60, 84], maxNotes: 4, cutoff: 5000 },
  harp: { role: "arpeggio", interval: "8n", range: [48, 88], maxNotes: 5, cutoff: 4800 },
  "plucked strings": { role: "arpeggio", interval: "8n", range: [60, 86], maxNotes: 4, cutoff: 4200 },
  "synth lead": { role: "melody", interval: "4n", range: [62, 86], maxNotes: 1, cutoff: 3600 },

  // --- low end ---
  bass: { role: "bass", interval: "1m", range: [28, 45], maxNotes: 2, cutoff: 900 },
  "sub drone": { role: "drone", interval: "2m", range: [24, 36], maxNotes: 1, cutoff: 500 },

  // --- percussion ---
  kick: {
    role: "percussive",
    interval: "4n",
    range: [24, 24],
    maxNotes: 1,
    cutoff: 2000,
    pattern: [1, 0, 0.55, 0],
  },
  tom: {
    role: "percussive",
    interval: "4n",
    range: [45, 45],
    maxNotes: 1,
    cutoff: 2500,
    pattern: [0, 0, 0, 0, 0, 0.5, 0, 0.7],
  },
  shaker: {
    role: "percussive",
    interval: "8n",
    range: [72, 72],
    maxNotes: 1,
    cutoff: 6000,
    filterType: "highpass",
    pattern: [0.6, 0.25, 0.4, 0.25, 0.6, 0.25, 0.4, 0.3],
  },
  rim: {
    role: "percussive",
    interval: "4n",
    range: [60, 60],
    maxNotes: 1,
    cutoff: 1500,
    filterType: "highpass",
    pattern: [0, 0.7, 0, 0.6],
  },
  cymbal: {
    role: "percussive",
    interval: "1m",
    range: [84, 84],
    maxNotes: 1,
    cutoff: 5000,
    filterType: "highpass",
    pattern: [0.5, 0, 0, 0.3],
  },
};

const DEFAULT_SPEC: LayerSpec = {
  role: "bed",
  interval: "1m",
  range: [48, 72],
  maxNotes: 4,
  cutoff: 2400,
};

interface InternalLayer {
  instrument: string;
  spec: LayerSpec;
  voice: VoiceHandle;
  filter: Tone.Filter;
  /** Null for percussion — a swept filter on a drum just sounds unstable. */
  lfo: Tone.LFO | null;
  gain: Tone.Gain;
  loop: Tone.Loop;
  /** Last voicing, used to voice-lead the next chord. */
  voicing: number[];
  /** Chord symbol the current voicing was built for. */
  voicedFor: string;
  step: number;
  melodyNote: number | null;
  targetVolume: number;
  disposeTimer?: number;
}

/** Wraps a PolySynth — chords go straight through. */
function pitched(synth: Tone.PolySynth<any>): VoiceHandle {
  return {
    node: synth,
    play: (notes, duration, time, velocity) =>
      synth.triggerAttackRelease(notes, duration, time, velocity),
    dispose: () => synth.dispose(),
  };
}

/** Wraps a MembraneSynth — pitched drum, fixed note, ignores the chord. */
function membrane(synth: Tone.MembraneSynth, note: string): VoiceHandle {
  return {
    node: synth,
    play: (_notes, duration, time, velocity) =>
      synth.triggerAttackRelease(note, duration, time, velocity),
    dispose: () => synth.dispose(),
  };
}

/** Wraps a NoiseSynth — takes no note at all, hence the separate handle. */
function noise(synth: Tone.NoiseSynth): VoiceHandle {
  return {
    node: synth,
    play: (_notes, duration, time, velocity) =>
      synth.triggerAttackRelease(duration, time, velocity),
    dispose: () => synth.dispose(),
  };
}

/** Detuned/fat oscillators and long releases do most of the work here. */
function createVoice(instrument: string): VoiceHandle {
  switch (instrument) {
    // --- sustained ---
    case "ambient pad":
      return pitched(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "fatsine", count: 3, spread: 25 },
          envelope: { attack: 3.5, decay: 2, sustain: 0.85, release: 7 },
        }),
      );
    case "strings":
      return pitched(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "fatsawtooth", count: 3, spread: 20 },
          envelope: { attack: 1.6, decay: 1, sustain: 0.7, release: 4.5 },
        }),
      );
    case "soft strings":
      return pitched(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "fatsawtooth", count: 3, spread: 30 },
          envelope: { attack: 2.2, decay: 1.2, sustain: 0.6, release: 5 },
        }),
      );
    case "cello":
      return pitched(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "fatsawtooth", count: 2, spread: 14 },
          envelope: { attack: 0.9, decay: 0.8, sustain: 0.75, release: 3.2 },
        }),
      );
    case "choir":
      return pitched(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "fattriangle", count: 4, spread: 35 },
          envelope: { attack: 2.8, decay: 1.5, sustain: 0.8, release: 5.5 },
        }),
      );
    case "glass":
      return pitched(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "sine" },
          envelope: { attack: 1.8, decay: 1.5, sustain: 0.5, release: 4 },
        }),
      );

    // --- melodic ---
    case "piano":
      return pitched(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "triangle" },
          envelope: { attack: 0.01, decay: 0.4, sustain: 0.15, release: 2.4 },
        }),
      );
    case "celesta":
      return pitched(
        new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 3,
          modulationIndex: 6,
          envelope: { attack: 0.002, decay: 1.2, sustain: 0, release: 1.5 },
          modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.2 },
        }),
      );
    case "marimba":
      return pitched(
        new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 4,
          modulationIndex: 2.5,
          envelope: { attack: 0.003, decay: 0.5, sustain: 0, release: 0.6 },
          modulationEnvelope: { attack: 0.002, decay: 0.1, sustain: 0, release: 0.1 },
        }),
      );
    case "vibraphone":
      return pitched(
        new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 3,
          modulationIndex: 1.4,
          envelope: { attack: 0.004, decay: 1.8, sustain: 0.05, release: 2.5 },
          modulationEnvelope: { attack: 0.004, decay: 0.4, sustain: 0, release: 0.4 },
        }),
      );
    case "harp":
      return pitched(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "triangle" },
          envelope: { attack: 0.003, decay: 1.1, sustain: 0, release: 1.4 },
        }),
      );
    case "plucked strings":
      return pitched(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "triangle" },
          envelope: { attack: 0.004, decay: 0.35, sustain: 0, release: 0.9 },
        }),
      );
    case "synth lead":
      return pitched(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "fattriangle", count: 2, spread: 15 },
          envelope: { attack: 0.08, decay: 0.3, sustain: 0.35, release: 1.6 },
        }),
      );

    // --- low end ---
    case "bass":
      return pitched(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "fatsine", count: 2, spread: 10 },
          envelope: { attack: 0.35, decay: 0.8, sustain: 0.7, release: 3 },
        }),
      );
    case "sub drone":
      return pitched(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "sine" },
          envelope: { attack: 5, decay: 3, sustain: 0.9, release: 9 },
        }),
      );

    // --- percussion ---
    case "kick":
      return membrane(
        new Tone.MembraneSynth({
          pitchDecay: 0.05,
          octaves: 6,
          envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 0.1 },
        }),
        "C1",
      );
    case "tom":
      return membrane(
        new Tone.MembraneSynth({
          pitchDecay: 0.1,
          octaves: 3,
          envelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.2 },
        }),
        "A2",
      );
    case "shaker":
      return noise(
        new Tone.NoiseSynth({
          noise: { type: "white" },
          envelope: { attack: 0.001, decay: 0.045, sustain: 0 },
        }),
      );
    case "rim":
      return noise(
        new Tone.NoiseSynth({
          noise: { type: "pink" },
          envelope: { attack: 0.001, decay: 0.03, sustain: 0 },
        }),
      );
    case "cymbal":
      return noise(
        new Tone.NoiseSynth({
          noise: { type: "white" },
          envelope: { attack: 0.004, decay: 1.6, sustain: 0 },
        }),
      );

    default:
      return pitched(new Tone.PolySynth(Tone.Synth));
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Moves `amount` of the way from where we are to where Claude asked us to be.
 * amount = 1 applies the analysis verbatim; lower values damp every change
 * proportionally, higher values exaggerate it.
 */
function blend(current: number, target: number, amount: number): number {
  if (!Number.isFinite(target)) return current;
  return current + (target - current) * amount;
}

/** brightness -1..1 -> ~400Hz..12kHz, exponentially so it reads as linear. */
function brightnessToCutoff(brightness: number): number {
  const normalized = (clamp(brightness, -1, 1) + 1) / 2;
  return 400 * Math.pow(30, normalized);
}

export class AudioEngine {
  private masterGain: Tone.Gain;
  private warmthShelf: Tone.Filter;
  private masterFilter: Tone.Filter;
  private chorus: Tone.Chorus;
  private delay: Tone.FeedbackDelay;
  private reverb: Tone.Reverb;
  private waveform: Tone.Analyser;
  private fft: Tone.Analyser;

  private layers: Map<string, InternalLayer> = new Map();
  private transportStarted = false;

  // --- emotional state -------------------------------------------------
  private brightness = SEED_STATE.brightness;
  private warmth = SEED_STATE.warmth;
  private energy = SEED_STATE.energy;
  private tension = SEED_STATE.tension;

  // --- harmonic state --------------------------------------------------
  private key = SEED_STATE.key;
  private progression = [...SEED_STATE.chordProgression];
  private harmonicRhythm = 4;
  private chordIndex = 0;
  private barCount = 0;
  private pivotSymbol: string | null = null;
  private pivotBarsLeft = 0;
  private pendingHarmony: MusicAnalysis["harmony"] | null = null;
  private harmonyClock: Tone.Loop;
  /** Full passes through the progression since the last key change. */
  private cyclesSinceChange = 0;
  /** Circle-of-fifths distance from the key Claude last set, to limit drift. */
  private fifthsFromHome = 0;

  constructor() {
    this.waveform = new Tone.Analyser("waveform", 1024);
    this.fft = new Tone.Analyser("fft", 64);

    this.reverb = new Tone.Reverb({ decay: 7, wet: 0.35 });
    this.delay = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.28, wet: 0.14 });
    this.chorus = new Tone.Chorus({ frequency: 0.4, delayTime: 3.5, depth: 0.4, wet: 0.25 }).start();
    this.masterFilter = new Tone.Filter({
      frequency: brightnessToCutoff(this.brightness),
      type: "lowpass",
      rolloff: -12,
    });
    this.warmthShelf = new Tone.Filter({ type: "lowshelf", frequency: 220 });
    this.warmthShelf.gain.value = this.warmth * 7;
    this.masterGain = new Tone.Gain(0.8);

    this.masterGain.connect(this.warmthShelf);
    this.warmthShelf.connect(this.masterFilter);
    this.masterFilter.connect(this.chorus);
    this.chorus.connect(this.delay);
    this.delay.connect(this.reverb);
    this.reverb.connect(this.waveform);
    this.reverb.connect(this.fft);
    this.reverb.toDestination();

    Tone.getTransport().bpm.value = SEED_STATE.tempo;

    // Single clock that owns chord changes, so layers never disagree about
    // what the current chord is.
    this.harmonyClock = new Tone.Loop(() => this.advanceHarmony(), "1m").start(0);
  }

  // ---------------------------------------------------------------- transport

  /** Resumes the browser audio context (must be called from a user gesture). */
  async ensureStarted(): Promise<void> {
    if (Tone.getContext().state !== "running") {
      await Tone.start();
    }
    if (!this.transportStarted) {
      Tone.getTransport().start();
      this.transportStarted = true;
    }
  }

  resume(): void {
    Tone.getTransport().start();
  }

  pause(): void {
    Tone.getTransport().pause();
  }

  get instruments(): string[] {
    return Array.from(this.layers.keys());
  }

  // ------------------------------------------------------------------ harmony

  /**
   * Bars per chord. The chordRate setting overrides what Claude composed, and
   * is read every bar so dragging the slider is audible immediately rather
   * than waiting for the next memory.
   */
  private effectiveHarmonicRhythm(): number {
    const { chordRate } = getTuning();
    return chordRate > 0 ? chordRate : this.harmonicRhythm;
  }

  private advanceHarmony(): void {
    this.barCount += 1;

    if (this.pivotBarsLeft > 0) {
      this.pivotBarsLeft -= 1;
      if (this.pivotBarsLeft === 0) this.adoptPendingHarmony();
      return;
    }

    if (this.barCount % this.effectiveHarmonicRhythm() !== 0) return;

    if (this.pendingHarmony) {
      // Hold the pivot chord across the crossover rather than jumping straight
      // into the new key.
      this.pivotSymbol = this.pendingHarmony.pivotChord;
      this.pivotBarsLeft = clamp(Math.round(this.pendingHarmony.transitionBars), 1, 16);
      console.log(
        `[audio] harmonic transition -> pivot on ${this.pivotSymbol} for ${this.pivotBarsLeft} bars, then ${this.pendingHarmony.key}`,
      );
      return;
    }

    this.chordIndex += 1;

    if (this.chordIndex % this.progression.length === 0) {
      this.cyclesSinceChange += 1;
      this.maybeSelfModulate();
    }
  }

  /**
   * Keeps the harmony travelling between memories. Transposes the progression
   * that is already playing by one step around the circle of fifths, pivoting
   * on the chord currently sounding — which is diatonic in both the old and the
   * new key, so the join is seamless. The material stays recognisably the same
   * piece; only its centre moves.
   */
  private maybeSelfModulate(): void {
    const interval = modulationInterval(getTuning().keyMovement);
    if (interval === 0 || this.cyclesSinceChange < interval) return;

    // Wander no further than two fifths from the key Claude chose, so the score
    // orbits its composed centre instead of drifting away from it.
    let direction: 1 | -1;
    if (this.fifthsFromHome >= 2) direction = -1;
    else if (this.fifthsFromHome <= -2) direction = 1;
    else direction = Math.random() < 0.5 ? 1 : -1;

    // +7 = up a fifth, +5 = up a fourth (i.e. down a fifth).
    const semitones = direction === 1 ? 7 : 5;
    this.fifthsFromHome += direction;

    const pivot = this.currentChordSymbol();
    this.pendingHarmony = {
      key: transposeKey(this.key, semitones),
      chordProgression: this.progression.map((chord) => transposeChord(chord, semitones)),
      pivotChord: pivot,
      transitionBars: 2,
      harmonicRhythm: this.effectiveHarmonicRhythm(),
    };

    this.pivotSymbol = pivot;
    this.pivotBarsLeft = 2;
    this.cyclesSinceChange = 0;

    console.log(
      `[audio] self-modulation: ${this.key} -> ${this.pendingHarmony.key} (pivot ${pivot})`,
    );
  }

  private adoptPendingHarmony(): void {
    const harmony = this.pendingHarmony;
    if (!harmony) return;

    this.progression =
      harmony.chordProgression.length > 0 ? [...harmony.chordProgression] : this.progression;
    this.key = harmony.key || this.key;
    this.harmonicRhythm = clamp(Math.round(harmony.harmonicRhythm), 1, 16);
    this.chordIndex = 0;
    this.barCount = 0;
    this.pivotSymbol = null;
    this.pendingHarmony = null;
    this.cyclesSinceChange = 0;

    console.log(`[audio] now in ${this.key}: ${this.progression.join(" | ")}`);
  }

  private currentChordSymbol(): string {
    if (this.pivotSymbol) return this.pivotSymbol;
    return this.progression[this.chordIndex % this.progression.length] ?? "Cmaj9";
  }

  /** Recomputes a layer's voicing only when the chord actually changes. */
  private voicingFor(layer: InternalLayer): number[] {
    const symbol = this.currentChordSymbol();
    if (layer.voicedFor !== symbol) {
      layer.voicing = voiceChord(symbol, layer.spec.range, layer.voicing, layer.spec.maxNotes);
      layer.voicedFor = symbol;
    }
    return layer.voicing;
  }

  private velocity(base: number): number {
    const scaled = base * (1 + this.energy * 0.25);
    return clamp(scaled + (Math.random() - 0.5) * 0.12, 0.05, 1);
  }

  // ------------------------------------------------------------------- layers

  private createLayer(instrument: string): InternalLayer {
    const spec = ARRANGEMENT[instrument] ?? DEFAULT_SPEC;

    const voice = createVoice(instrument);
    const filter = new Tone.Filter({
      frequency: spec.cutoff,
      type: spec.filterType ?? "lowpass",
      rolloff: -12,
    });
    const gain = new Tone.Gain(0);

    // A slow, per-layer cutoff drift keeps held notes from sounding static.
    // Percussion is left alone — a swept filter on a drum reads as a fault.
    let lfo: Tone.LFO | null = null;
    if (spec.role !== "percussive") {
      lfo = new Tone.LFO({
        frequency: 0.04 + Math.random() * 0.05,
        min: spec.cutoff * 0.65,
        max: spec.cutoff * 1.35,
      });
      lfo.connect(filter.frequency);
      lfo.start();
    }

    voice.node.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    const layer: InternalLayer = {
      instrument,
      spec,
      voice,
      filter,
      lfo,
      gain,
      loop: undefined as unknown as Tone.Loop,
      voicing: [],
      voicedFor: "",
      step: 0,
      melodyNote: null,
      targetVolume: 0,
    };

    layer.loop = new Tone.Loop((time) => this.playLayer(layer, time), spec.interval).start(0);

    this.layers.set(instrument, layer);
    return layer;
  }

  private playLayer(layer: InternalLayer, time: number): void {
    const { spec } = layer;
    const intervalSec = Tone.Time(spec.interval).toSeconds();
    const step = layer.step;
    layer.step += 1;

    // Percussion is unpitched and never needs a voicing, so it runs before the
    // chord lookup rather than being a case inside it.
    if (spec.role === "percussive") {
      const pattern = spec.pattern ?? [1];
      const hit = pattern[step % pattern.length];
      if (hit <= 0) return;
      // Thin the quieter hits out when the score is still.
      if (this.energy < 0 && hit < 0.5 && Math.random() > 0.45 + this.energy * 0.4) return;
      layer.voice.play(
        [midiToNote(spec.range[0])],
        Math.min(0.35, intervalSec * 0.6),
        time,
        this.velocity(hit * 0.34),
      );
      return;
    }

    const symbol = this.currentChordSymbol();
    const voicing = this.voicingFor(layer);
    if (voicing.length === 0) return;

    switch (spec.role) {
      case "bed":
      case "swell": {
        const notes = voicing.map(midiToNote);
        layer.voice.play(notes, intervalSec * 0.95, time, this.velocity(0.32));
        break;
      }

      case "counter": {
        // Upper part of the voicing only, so it sits above the bed.
        const notes = voicing.slice(-3).map(midiToNote);
        layer.voice.play(notes, intervalSec * 0.9, time, this.velocity(0.26));
        break;
      }

      case "figure": {
        // Broken chord: one note per fire, with occasional rests.
        if (Math.random() < 0.22 - this.energy * 0.1) break;
        const midi = voicing[step % voicing.length];
        layer.voice.play([midiToNote(midi)], intervalSec * 2.2, time, this.velocity(0.4));
        break;
      }

      case "arpeggio": {
        // Rolling up and back down through the voicing.
        const span = Math.max(1, voicing.length * 2 - 2);
        const position = step % span;
        const index = position < voicing.length ? position : span - position;
        layer.voice.play([midiToNote(voicing[index])], intervalSec * 1.6, time, this.velocity(0.3));
        break;
      }

      case "melody": {
        const midi = nextMelodyNote(symbol, this.key, layer.melodyNote, spec.range, this.energy);
        if (midi === null) break;
        layer.melodyNote = midi;
        layer.voice.play([midiToNote(midi)], intervalSec * 1.8, time, this.velocity(0.34));
        break;
      }

      case "bass": {
        layer.voice.play([midiToNote(voicing[0])], intervalSec * 0.9, time, this.velocity(0.38));
        break;
      }

      case "drone": {
        // A single sustained root under everything, held past its own loop so
        // successive notes overlap into one continuous pedal tone.
        layer.voice.play([midiToNote(voicing[0])], intervalSec * 1.4, time, this.velocity(0.3));
        break;
      }
    }
  }

  private disposeLayer(instrument: string): void {
    const layer = this.layers.get(instrument);
    if (!layer) return;
    if (layer.disposeTimer !== undefined) window.clearTimeout(layer.disposeTimer);
    layer.loop.stop(0).dispose();
    layer.lfo?.stop().dispose();
    layer.voice.dispose();
    layer.filter.dispose();
    layer.gain.dispose();
    this.layers.delete(instrument);
    console.log(`[audio] disposed layer "${instrument}" after fade-out`);
  }

  // ------------------------------------------------------------------- public

  /** Current soundtrack state — sent to the backend with every memory. */
  getState(): AudioState {
    return {
      tempo: Math.round(Tone.getTransport().bpm.value),
      brightness: this.brightness,
      warmth: this.warmth,
      energy: this.energy,
      tension: this.tension,
      activeLayers: Array.from(this.layers.values()).map((layer) => ({
        instrument: layer.instrument,
        volume: Number(layer.targetVolume.toFixed(3)),
      })),
      key: this.key,
      chordProgression: [...this.progression],
    };
  }

  /**
   * Moves the soundtrack toward the state Claude returned. Nothing here jumps:
   * continuous parameters ramp, harmony changes at the next chord boundary via
   * a pivot chord, and layers fade in or out over their own transition times.
   *
   * Returns the instruments newly added by this analysis.
   */
  applyMusicAnalysis(analysis: MusicAnalysis): string[] {
    // Nothing is playing yet on the first memory, so there is nothing to ease
    // away from — pivoting would just delay the opening by half a minute, and
    // damping it would leave the score barely established.
    const isOpening = this.layers.size === 0;

    const tuning = getTuning();
    /** How far we actually travel toward Claude's target. */
    const k = isOpening ? 1 : clamp(tuning.intensity, 0, 3);
    const timeScale = clamp(tuning.transitionScale, 0.1, 8);

    const transitions = analysis.layerChanges.map((change) => change.transitionSeconds);
    const stateRamp = clamp(Math.max(8, ...transitions) * timeScale, 2, 90);

    // --- global emotional state ---
    const target = analysis.targetState;
    this.brightness = clamp(blend(this.brightness, target.brightness, k), -1, 1);
    this.warmth = clamp(blend(this.warmth, target.warmth, k), -1, 1);
    this.energy = clamp(blend(this.energy, target.energy, k), -1, 1);
    this.tension = clamp(blend(this.tension, target.tension, k), -1, 1);

    const tempo = clamp(blend(Tone.getTransport().bpm.value, target.tempo, k), 50, 140);
    Tone.getTransport().bpm.rampTo(tempo, stateRamp);

    // brightness owns the master cutoff; effects.filterFrequency is only a
    // fallback if brightness came back unusable.
    const currentCutoff = Tone.Frequency(this.masterFilter.frequency.value).toFrequency();
    const cutoff = Number.isFinite(target.brightness)
      ? brightnessToCutoff(this.brightness)
      : clamp(blend(currentCutoff, analysis.effects.filterFrequency, k), 200, 16000);
    this.masterFilter.frequency.rampTo(cutoff, stateRamp);

    this.warmthShelf.gain.rampTo(this.warmth * 7, stateRamp);

    const reverb = clamp(blend(this.reverb.wet.value, clamp(analysis.effects.reverb, 0, 1), k), 0, 1);
    this.reverb.wet.rampTo(reverb, stateRamp);

    // Tension shows up as instability in the effects rather than in the notes —
    // Claude already expresses harmonic tension through its chord choices.
    this.chorus.depth = clamp(0.35 + this.tension * 0.35, 0, 1);
    this.delay.feedback.rampTo(clamp(0.25 + this.tension * 0.2, 0, 0.6), stateRamp);

    // --- harmony ---
    // A key change cannot be partially applied the way a continuous value can,
    // so below 0.25 it is skipped outright and the score holds its key.
    if (analysis.harmony && analysis.harmony.chordProgression?.length) {
      // Claude's key becomes the new home that self-modulation orbits.
      this.fifthsFromHome = 0;
      if (isOpening) {
        this.pendingHarmony = analysis.harmony;
        this.adoptPendingHarmony();
      } else if (k >= 0.25) {
        // Queued: takes effect at the next chord boundary, through the pivot.
        this.pendingHarmony = {
          ...analysis.harmony,
          transitionBars: clamp(Math.round(analysis.harmony.transitionBars * timeScale), 1, 16),
        };
      } else {
        console.log(`[audio] harmony change skipped (intensity ${k} < 0.25)`);
      }
    }

    // --- layers ---
    const added: string[] = [];
    for (const change of analysis.layerChanges) {
      const seconds = clamp(change.transitionSeconds * timeScale, 1, 60);
      let layer = this.layers.get(change.instrument);

      // Damping applies to layer volume too, measured from wherever this layer
      // currently sits (0 for one that does not exist yet).
      const volume = clamp(
        blend(layer ? layer.targetVolume : 0, clamp(change.targetVolume, 0, 1), k),
        0,
        1,
      );

      if (!layer) {
        // Covers both "fade out something that isn't playing" and an intensity
        // low enough that the new layer would be inaudible anyway.
        if (volume <= 0.001) continue;
        layer = this.createLayer(change.instrument);
        added.push(change.instrument);
      }

      // Any new instruction cancels a pending fade-out.
      if (layer.disposeTimer !== undefined) {
        window.clearTimeout(layer.disposeTimer);
        layer.disposeTimer = undefined;
      }

      layer.targetVolume = volume;
      layer.gain.gain.rampTo(volume, seconds);

      if (volume <= 0.001) {
        // Fade out fully, then dispose — never stop a loop mid-note.
        layer.disposeTimer = window.setTimeout(
          () => this.disposeLayer(change.instrument),
          (seconds + 0.5) * 1000,
        );
      }

      console.log(
        `[audio] ${change.action} "${change.instrument}" -> ${volume} over ${seconds}s`,
      );
    }

    this.rebalance();

    console.log("[audio] applied state", {
      tempo: Math.round(tempo),
      brightness: Number(this.brightness.toFixed(3)),
      warmth: Number(this.warmth.toFixed(3)),
      energy: Number(this.energy.toFixed(3)),
      tension: Number(this.tension.toFixed(3)),
      reverb: Number(reverb.toFixed(3)),
      cutoff: Math.round(cutoff),
      rampSeconds: Number(stateRamp.toFixed(1)),
      intensity: k,
      transitionScale: timeScale,
      // What Claude actually asked for, for comparison against the damped result.
      requested: analysis.targetState,
    });

    return added;
  }

  /** Keeps headroom sane as layers accumulate. */
  private rebalance(): void {
    const count = Math.max(this.layers.size, 1);
    const target = 0.9 / Math.sqrt(count);
    this.masterGain.gain.rampTo(target, 4);
  }

  /** Removes all layers and resets the engine to a clean slate. */
  reset(): void {
    Array.from(this.layers.keys()).forEach((instrument) => this.disposeLayer(instrument));
    this.layers.clear();

    this.brightness = SEED_STATE.brightness;
    this.warmth = SEED_STATE.warmth;
    this.energy = SEED_STATE.energy;
    this.tension = SEED_STATE.tension;

    this.key = SEED_STATE.key;
    this.progression = [...SEED_STATE.chordProgression];
    this.harmonicRhythm = 4;
    this.chordIndex = 0;
    this.barCount = 0;
    this.pivotSymbol = null;
    this.pivotBarsLeft = 0;
    this.pendingHarmony = null;
    this.cyclesSinceChange = 0;
    this.fifthsFromHome = 0;

    Tone.getTransport().bpm.rampTo(SEED_STATE.tempo, 0.5);
    this.masterFilter.frequency.rampTo(brightnessToCutoff(this.brightness), 0.5);
    this.warmthShelf.gain.rampTo(this.warmth * 7, 0.5);
    this.reverb.wet.rampTo(0.35, 0.5);
    this.masterGain.gain.rampTo(0.8, 0.5);
  }

  getWaveform(): Float32Array {
    return this.waveform.getValue() as Float32Array;
  }

  getFrequencyData(): Float32Array {
    return this.fft.getValue() as Float32Array;
  }

  dispose(): void {
    this.reset();
    this.harmonyClock.stop(0).dispose();
    this.masterGain.dispose();
    this.warmthShelf.dispose();
    this.masterFilter.dispose();
    this.chorus.dispose();
    this.delay.dispose();
    this.reverb.dispose();
    this.waveform.dispose();
    this.fft.dispose();
  }
}
