<<<<<<< HEAD
// The collection's collaborative audioscape.
=======
// The garden's collaborative audioscape.
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
//
// Ported from memory-symphony's AudioEngine.ts (Tone.js) to plain Web Audio,
// with one deliberate change to how memories join the sound. In the original,
// a memory added a permanent instrument layer that looped forever, deduplicated
// by instrument name -- so the tenth memory to map to "piano" was silent, and
// nothing ever left. Here a memory's contribution is a *swell*: it fades in,
// plays its progression a few times, fades out, and disposes itself. Every
// contribution is heard, contributions stack while they overlap, and the sound
<<<<<<< HEAD
// of the collection is whatever is being visited right now.
=======
// of the garden is whatever is being visited right now.
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
//
// Underneath the swells sits the bed: a slow sustained pad built from the
// dominant emotion of the whole wall. That is the part that is genuinely
// collective, and it is the only thing that loops.

import { wallChords } from './emotion.js';

const NOTES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** "C#4" / "A2" -> Hz. */
export function noteFreq(name) {
  const m = /^([a-g])([#b]?)(-?\d)$/i.exec(String(name).trim());
  if (!m) return 440;
  const semitone = NOTES[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Oscillator + envelope per instrument, matching createSynth() in the original.
const VOICES = {
  piano: { type: 'triangle', a: 0.02, d: 0.3, s: 0.2, r: 1.2, gain: 0.5 },
  'ambient pad': { type: 'sine', a: 2, d: 1, s: 0.8, r: 4, gain: 0.55 },
  strings: { type: 'sawtooth', a: 0.8, d: 0.5, s: 0.6, r: 2.5, gain: 0.26 },
  'soft strings': { type: 'sawtooth', a: 0.9, d: 0.5, s: 0.55, r: 2.5, gain: 0.22 },
  'synth lead': { type: 'square', a: 0.01, d: 0.15, s: 0.3, r: 0.4, gain: 0.16 },
  'plucked strings': { type: 'triangle', a: 0.005, d: 0.2, s: 0, r: 0.3, gain: 0.42 },
  percussion: { type: 'square', a: 0.001, d: 0.05, s: 0, r: 0.05, gain: 0.2 },
};

const SUSTAINED = new Set(['ambient pad', 'strings', 'soft strings']);
const RHYTHMIC = new Set(['percussion', 'plucked strings', 'synth lead']);

/** Warmer moods get a darker low-pass; brighter moods keep their top end. */
function cutoffFor(mood) {
  if (mood === 'bright') return 8000;
  if (mood === 'warm' || mood === 'somber' || mood === 'ambient') return 1800;
  return 4000;
}

function impulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export class Audioscape {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.muted = false;
    this.bed = null;
    this.bedTimer = null;
    this.bedNext = 0;
    this.bedChords = null;
    this.bedIndex = 0;
    this.live = new Set();      // contributions currently sounding
    this.buffers = new Map();   // decoded preview clips
    this.previewNode = null;
    this.onchange = null;       // notified when the set of live voices changes
  }

  // ------------------------------------------------------------- plumbing --

  async ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0;

      this.duckGain = ctx.createGain();      // pulled down inside a memory
      this.bedBus = ctx.createGain();
      this.bedBus.gain.value = 0.34;
      this.swellBus = ctx.createGain();
      this.swellBus.gain.value = 1;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.ratio.value = 4;
      comp.attack.value = 0.008;

      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = impulse(ctx, 3.2, 2.2);
      this.reverbIn = ctx.createGain();
      this.reverbIn.gain.value = 0.4;
      this.reverbIn.connect(this.reverb);
      this.reverb.connect(this.duckGain);

      this.bedBus.connect(this.duckGain);
      this.swellBus.connect(this.duckGain);
      this.duckGain.connect(this.master);
      this.master.connect(comp);
      comp.connect(this.analyser);
      this.analyser.connect(ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* still waiting on a gesture */ }
    }
    this.started = this.ctx.state === 'running';
    return this.ctx;
  }

  get running() { return this.ctx?.state === 'running'; }

<<<<<<< HEAD
  /** 0..1 loudness, for making the collection breathe. */
=======
  /** 0..1 loudness, for making the garden breathe. */
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
  level() {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i += 4) peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
    return Math.min(1, peak * 1.6);
  }

  fadeMaster(to, seconds = 1.4) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(this.muted ? 0 : to, t + seconds);
  }

  /** Pull the whole garden down without stopping it -- used inside a memory. */
  duck(amount, seconds = 0.9) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.duckGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(amount, t + seconds);
  }

  setMuted(m) {
    this.muted = m;
    this.fadeMaster(m ? 0 : 1, 0.5);
  }

  // ------------------------------------------------------------ the voices --

  /**
   * One instrument's chain for one contribution. `wet` is how much of it is
   * thrown into the room.
   */
  chain(instrument, mood, wet, destination) {
    const ctx = this.ctx;
    const spec = VOICES[instrument] || VOICES.piano;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoffFor(mood);
    filter.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    filter.connect(gain);
    gain.connect(destination);

    if (wet > 0.01) {
      const send = ctx.createGain();
      send.gain.value = wet;
      gain.connect(send);
      send.connect(this.reverbIn);
    }
    // Nothing is tracked for disposal: every node in here hangs off the
    // contribution's own gain, which is disconnected when the swell ends, and
    // the oscillators stop themselves. Cutting the root frees the branch.
    return { spec, filter, gain };
  }

  /** Schedules one note. Every oscillator is one-shot and stops on its own. */
  note(chainRef, freq, at, dur) {
    const ctx = this.ctx;
    const { spec, filter } = chainRef;
    const osc = ctx.createOscillator();
    osc.type = spec.type;
    osc.frequency.value = freq;

    const env = ctx.createGain();
    env.gain.value = 0;
    osc.connect(env);
    env.connect(filter);

    const peak = spec.gain;
    const sustain = peak * spec.s;
    const g = env.gain;
    g.setValueAtTime(0.0001, at);
    g.linearRampToValueAtTime(peak, at + spec.a);
    g.linearRampToValueAtTime(Math.max(0.0001, sustain), at + spec.a + spec.d);
    const off = at + Math.max(dur, spec.a + spec.d);
    g.setValueAtTime(Math.max(0.0001, sustain || peak * 0.0001), off);
    g.exponentialRampToValueAtTime(0.0001, off + spec.r);

    osc.start(at);
    osc.stop(off + spec.r + 0.05);
    osc.onended = () => { try { osc.disconnect(); env.disconnect(); } catch {} };
  }

  /** Lays a whole chord down for one instrument, in that instrument's style. */
  chord(chainRef, notes, at, chordDur, beat) {
    const { spec } = chainRef;
    const instrument = chainRef.instrument;
    if (RHYTHMIC.has(instrument)) {
      const noteDur = Math.min(0.2, beat / 2);
      notes.forEach((n, i) => this.note(chainRef, noteFreq(n), at + i * (beat / 2), noteDur));
    } else if (SUSTAINED.has(instrument)) {
      notes.forEach((n) => this.note(chainRef, noteFreq(n), at, chordDur * 0.95));
    } else {
      notes.forEach((n, i) => this.note(chainRef, noteFreq(n), at + i * 0.045, chordDur * 0.5));
    }
    return spec;
  }

  // ----------------------------------------------------- the collective bed --

  /**
<<<<<<< HEAD
   * The only looping part of the collection: a slow pad on the chords of whichever
=======
   * The only looping part of the garden: a slow pad on the chords of whichever
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
   * emotion the wall holds most of. Rebuilt whenever the wall changes.
   */
  async setBed(emotions) {
    await this.ensure();
    if (!this.ctx) return;
    const chords = wallChords(emotions || []);
    const key = JSON.stringify(chords);
    if (this.bedChords === key && this.bedTimer) return;
    this.bedChords = key;
    this.bedNotes = chords;
    this.bedIndex = 0;
    this.bedNext = this.ctx.currentTime + 0.15;

    if (!this.bed) {
      this.bed = this.chain('ambient pad', 'ambient', 0.5, this.bedBus);
      this.bed.instrument = 'ambient pad';
      this.bed.gain.gain.setValueAtTime(1, this.ctx.currentTime);
    }
    if (!this.bedTimer) this.bedTimer = setInterval(() => this.pumpBed(), 500);
    this.pumpBed();
  }

  /** Look-ahead scheduler: keeps the bed a couple of chords ahead of the clock. */
  pumpBed() {
    if (!this.ctx || !this.bed || !this.bedNotes) return;
    const span = 6.4;
    while (this.bedNext < this.ctx.currentTime + 2.5) {
      const notes = this.bedNotes[this.bedIndex % this.bedNotes.length];
      this.bedIndex++;
      // Dropped an octave and thinned to the outer voices: the bed should sit
      // under the swells, not compete with them.
      const low = notes.filter((_, i) => i === 0 || i === notes.length - 1);
      this.chord({ ...this.bed, instrument: 'ambient pad' }, low, this.bedNext, span, 1);
      this.bedNext += span;
    }
  }

  stopBed() {
    clearInterval(this.bedTimer);
    this.bedTimer = null;
  }

  // ------------------------------------------------------- a contribution --

  /**
   * A memory joins the audioscape. It seeps in over `fadeIn`, plays its own
   * progression `cycles` times, and seeps back out -- then removes itself.
   * Nothing here is permanent and nothing repeats after it has gone.
   */
  async contribute(analysis, { cycles = 2, fadeIn = 2.4, fadeOut = 4, gain = 0.62, label = '' } = {}) {
    await this.ensure();
    if (!this.ctx || !analysis) return 0;

    const ctx = this.ctx;
    const beat = 60 / (analysis.tempo || 90);
    const chordDur = beat * 4;
    const span = chordDur * analysis.chords.length * cycles;
    const start = ctx.currentTime + 0.08;

    const swell = ctx.createGain();
    swell.gain.value = 0.0001;
    swell.connect(this.swellBus);

    // fade in, hold, fade out -- the shape memory-symphony used for its layers,
    // except here the tail actually arrives.
    const g = swell.gain;
    g.setValueAtTime(0.0001, start);
    g.exponentialRampToValueAtTime(gain, start + fadeIn);
    g.setValueAtTime(gain, start + Math.max(fadeIn, span - fadeOut));
    g.exponentialRampToValueAtTime(0.0001, start + span);

    // The room opens up for the more reverberant emotions.
    const wet = analysis.reverb ?? 0.3;

    for (const instrument of analysis.instruments) {
      const ref = this.chain(instrument, analysis.mood, wet, swell);
      ref.instrument = instrument;
      ref.gain.gain.setValueAtTime(1, start);
      for (let c = 0; c < analysis.chords.length * cycles; c++) {
        const notes = analysis.chords[c % analysis.chords.length];
        this.chord(ref, notes, start + c * chordDur, chordDur, beat);
      }
    }

    const entry = { label, emotion: analysis.emotion, until: start + span };
    this.live.add(entry);
    this.onchange?.(this.voices);

    setTimeout(() => {
      try { swell.disconnect(); } catch {}
      this.live.delete(entry);
      this.onchange?.(this.voices);
    }, (span + 0.4) * 1000);

    if (!this.muted) this.fadeMaster(1, 0.8);
    return span;
  }

<<<<<<< HEAD
  /** What is audible right now, for the collection's readout. */
=======
  /** What is audible right now, for the garden's readout. */
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
  get voices() {
    return [...this.live].map((v) => ({ label: v.label, emotion: v.emotion }));
  }

  /** A short arpeggio in a memory's own colour -- the hover preview for text. */
  async shimmer(analysis) {
    await this.ensure();
    if (!this.ctx || !analysis) return;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.32;
    out.connect(this.swellBus);
    const ref = this.chain('plucked strings', analysis.mood, 0.35, out);
    ref.instrument = 'plucked strings';
    ref.gain.gain.setValueAtTime(1, ctx.currentTime);
    const notes = analysis.chords[0];
    notes.forEach((n, i) => this.note(ref, noteFreq(n), ctx.currentTime + 0.04 + i * 0.09, 0.16));
    setTimeout(() => { try { out.disconnect(); } catch {} }, 2200);
    if (!this.muted) this.fadeMaster(1, 0.4);
  }

<<<<<<< HEAD
  // -------------------------------------------- held while you are hovering --

  /**
   * A memory joins the audioscape for exactly as long as the cursor is on it.
   * Unlike `contribute`, which is a fixed-length swell, this loops until it is
   * released -- so sweeping slowly across the collection lets you build a chord
   * out of whichever memories you are touching.
   *
   * Returns a handle; call `release()` to fade it back out. Holding a memory
   * that has real recorded sound loops that recording; one that has only words
   * loops the chords those words were mapped to.
   */
  async hold(memory) {
    await this.ensure();
    if (!this.ctx) return { release() {} };
    const ctx = this.ctx;

    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(this.swellBus);

    let stopped = false;
    let scheduler = null;
    const parts = [];

    const release = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(scheduler);
      const t = ctx.currentTime;
      try {
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), t);
        out.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      } catch {}
      setTimeout(() => {
        for (const p of parts) { try { p.stop(); } catch {} }
        try { out.disconnect(); } catch {}
      }, 1000);
      this.live.delete(entry);
      this.onchange?.(this.voices);
    };

    const entry = { label: memory.title || '', emotion: memory.emotion || 'neutral', held: true };
    this.live.add(entry);
    this.onchange?.(this.voices);

    if (memory.preview?.url) {
      let buf;
      try { buf = await this.decode(memory.preview.url); } catch { buf = null; }
      if (stopped) return { release };
      if (buf) {
        const from = Math.max(0, Math.min(memory.preview.start, buf.duration - 0.6));
        const to = Math.max(from + 0.8, Math.min(memory.preview.end, buf.duration));
        const node = ctx.createBufferSource();
        node.buffer = buf;
        node.loop = true;
        node.loopStart = from;
        node.loopEnd = to;
        node.connect(out);
        node.start(ctx.currentTime, from);
        parts.push(node);
      }
    }

    if (!parts.length) {
      // No recording: loop the chords its words were read as.
      const analysis = memory.analysis || { chords: [['C4', 'E4', 'G4']], tempo: 90, mood: 'neutral', reverb: 0.3 };
      const beat = 60 / (analysis.tempo || 90);
      const chordDur = beat * 4;
      const ref = this.chain('ambient pad', analysis.mood, analysis.reverb ?? 0.3, out);
      ref.instrument = 'ambient pad';
      ref.gain.gain.setValueAtTime(1, ctx.currentTime);
      let next = ctx.currentTime + 0.05;
      let idx = 0;
      const pump = () => {
        if (stopped) return;
        while (next < ctx.currentTime + 2) {
          this.chord(ref, analysis.chords[idx++ % analysis.chords.length], next, chordDur, beat);
          next += chordDur;
        }
      };
      pump();
      scheduler = setInterval(pump, 400);
    }

    // Sits a little above the bed so the memory you are touching is the one you
    // are listening to.
    const t = ctx.currentTime;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.8, t + 0.55);
    if (!this.muted) this.fadeMaster(1, 0.5);

    return { release };
  }

=======
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
  // --------------------------------------------------- previewing the input --

  async decode(url) {
    if (this.buffers.has(url)) return this.buffers.get(url);
    const p = (async () => {
      const res = await fetch(url);
      const bytes = await res.arrayBuffer();
      return await this.ctx.decodeAudioData(bytes);
    })();
    this.buffers.set(url, p);
    return p;
  }

  /**
   * Hovering a marble plays the memory's *actual* recorded sound -- a couple of
   * seconds from one of its audio windows, faded at both ends, with the rest of
<<<<<<< HEAD
   * the collection pulled down underneath it.
=======
   * the garden pulled down underneath it.
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
   */
  async previewClip(url, start = 0, end = 3) {
    await this.ensure();
    if (!this.ctx) return;
    this.stopPreview();
    let buf;
    try { buf = await this.decode(url); } catch { return; }
    if (!this.ctx) return;

    const ctx = this.ctx;
    const dur = Math.min(2.8, Math.max(1.2, end - start), buf.duration);
    const from = Math.max(0, Math.min(start, buf.duration - dur));

    const node = ctx.createBufferSource();
    node.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    node.connect(gain);
    gain.connect(this.swellBus);

    const t = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.85, t + 0.18);
    gain.gain.setValueAtTime(0.85, t + dur - 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.start(t, from, dur + 0.05);

    this.previewNode = { node, gain };
    node.onended = () => { try { node.disconnect(); gain.disconnect(); } catch {} };
    if (!this.muted) this.fadeMaster(1, 0.3);
  }

  stopPreview() {
    if (!this.previewNode) return;
    const { node, gain } = this.previewNode;
    this.previewNode = null;
    try {
      const t = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      node.stop(t + 0.14);
    } catch {}
  }
}
