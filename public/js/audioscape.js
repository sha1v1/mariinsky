// The collection's collaborative audioscape.
//
// Ported from memory-symphony's AudioEngine.ts (Tone.js) to plain Web Audio,
// with one deliberate change to how memories join the sound. In the original,
// a memory added a permanent instrument layer that looped forever, deduplicated
// by instrument name -- so the tenth memory to map to "piano" was silent, and
// nothing ever left. Here a memory's contribution is a *swell*: it fades in,
// plays its progression a few times, fades out, and disposes itself. Every
// contribution is heard, contributions stack while they overlap, and the sound
// of the collection is whatever is being visited right now.
//
// Underneath the swells sits the bed: a slow sustained pad built from the
// dominant emotion of the whole wall. That is the part that is genuinely
// collective, and it is the only thing that loops.

const NOTES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * The bed is fixed: plain C major, I-IV-V-I, and it does not follow the wall.
 * It used to be built from whichever emotion the wall held most of, which meant
 * the room's resting sound swung between C major, A minor and open quartal
 * voicings depending on what had been contributed -- and on a wall with a tie,
 * on nothing more principled than object key order. A room should sound like
 * itself; the memories are what vary.
 *
 * The root stays low on purpose -- an octave under the brighter contributions,
 * so the bed sits beneath the swells rather than competing with them in the
 * same register -- but everything above the root is spread open and carries an
 * added 6th (the A over C, the D over F, the E over G). A close bare triad
 * this low reads as a dirge; the same chord opened out, with a 6th instead of
 * a stacked third, is the warm "resolved" colour rather than a melancholy one.
 */
const BED_CHORDS = [
  ['C3', 'G3', 'E4', 'A4'],
  ['F2', 'C3', 'A3', 'D4'],
  ['G2', 'D3', 'B3', 'E4'],
  ['C3', 'G3', 'E4', 'A4'],
];

/** "C#4" / "A2" -> Hz. */
export function noteFreq(name) {
  const m = /^([a-g])([#b]?)(-?\d)$/i.exec(String(name).trim());
  if (!m) return 440;
  const semitone = NOTES[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Roughly F#2..C6. A profile's chords are hand-picked to sit in this window,
// but a wall dominated by a mixed tally, or a future profile, can hand a
// voice a note outside it -- and the low end of that range is exactly where
// several sustained voices already pile up (see minChordSpacing), while the
// high end is where a square/sawtooth oscillator turns thin and piercing.
// Folding the outlier by octaves keeps the note instead of just clipping it.
const MIN_FREQ = 90;
const MAX_FREQ = 1050;
function tame(freq) {
  while (freq < MIN_FREQ) freq *= 2;
  while (freq > MAX_FREQ) freq /= 2;
  return freq;
}

// Oscillator + envelope per instrument, matching createSynth() in the original.
// `unison` + `detune` give the three sustained voices a pair of slightly
// mistuned oscillators instead of one bare one -- the difference between a
// synth patch and something that sounds like more than one string. `gain` on
// those three is already trimmed down to keep the pair's combined loudness
// close to the old single-oscillator level, not doubled.
const VOICES = {
  piano: { type: 'triangle', a: 0.02, d: 0.3, s: 0.2, r: 1.2, gain: 0.5 },
  'ambient pad': { type: 'sine', a: 2, d: 1, s: 0.8, r: 4, gain: 0.42, unison: 2, detune: 7 },
  strings: { type: 'sawtooth', a: 0.8, d: 0.5, s: 0.6, r: 2.5, gain: 0.2, unison: 2, detune: 9 },
  'soft strings': { type: 'sawtooth', a: 0.9, d: 0.5, s: 0.55, r: 2.5, gain: 0.17, unison: 2, detune: 6 },
  'synth lead': { type: 'square', a: 0.01, d: 0.15, s: 0.3, r: 0.4, gain: 0.16 },
  'plucked strings': { type: 'triangle', a: 0.005, d: 0.2, s: 0, r: 0.3, gain: 0.42 },
  // A square-wave blip read as a click, not a drum. A short burst of filtered
  // noise is what an actual shaker/hat/snare is built from.
  percussion: { type: 'noise', a: 0.001, d: 0.06, s: 0, r: 0.08, gain: 0.24, hp: 2200 },
};

const SUSTAINED = new Set(['ambient pad', 'strings', 'soft strings']);
const RHYTHMIC = new Set(['percussion', 'plucked strings', 'synth lead']);

/**
 * A sustained voice's note stays audible for attack+decay+release after it is
 * struck (up to 7s for 'ambient pad'), but chords are otherwise paced at
 * beat*4 -- often under 3s. Scheduling the next chord before the last one has
 * decayed doesn't retrigger it, it stacks a fresh undecayed copy on top, and
 * with nothing to steal the old voices that stacking is unbounded: a few
 * chords in, the compressor is squashing a pile of low sines into what sounds
 * like static. Chords must be spaced at least one voice's a+d apart so each
 * new chord lands after the previous one has settled into its release tail
 * rather than in the middle of its attack.
 */
function minChordSpacing(instrument) {
  const spec = VOICES[instrument] || VOICES.piano;
  return SUSTAINED.has(instrument) ? spec.a + spec.d + 0.3 : 0;
}

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

  /** 0..1 loudness, for making the collection breathe. */
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

  /** One second of white noise, generated once and reused by any noise-type
   *  voice -- filtered per note rather than baked in, so one buffer serves
   *  any cutoff. */
  noiseBuffer() {
    if (this._noise) return this._noise;
    const len = Math.floor(this.ctx.sampleRate);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  /**
   * Schedules one note. Every source is one-shot and stops on its own. A
   * voice with `unison` gets that many oscillators, each a hair mistuned from
   * the others plus a touch of per-note random detune on top -- an ensemble
   * drifts in and out of tune with itself, which is what separates "a chord"
   * from "an oscillator playing three frequencies." A `noise`-type voice
   * (percussion) gets a filtered burst of the shared noise buffer instead of
   * a pitched oscillator.
   */
  note(chainRef, freq, at, dur) {
    const ctx = this.ctx;
    const { spec, filter } = chainRef;
    const env = ctx.createGain();
    env.gain.value = 0;

    const sources = [];
    if (spec.type === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer();
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = spec.hp || 1500;
      src.connect(hp);
      hp.connect(env);
      sources.push(src);
    } else {
      const voices = spec.unison > 1 ? spec.unison : 1;
      const f = tame(freq);
      for (let i = 0; i < voices; i++) {
        const osc = ctx.createOscillator();
        osc.type = spec.type;
        osc.frequency.value = f;
        const spread = voices > 1 ? spec.detune * (i === 0 ? -1 : 1) : 0;
        osc.detune.value = spread + (Math.random() * 4 - 2);
        osc.connect(env);
        sources.push(osc);
      }
    }
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

    const stopAt = off + spec.r + 0.05;
    let pending = sources.length;
    sources.forEach((src) => {
      src.start(at);
      src.stop(stopAt);
      src.onended = () => {
        try { src.disconnect(); } catch {}
        if (--pending === 0) { try { env.disconnect(); } catch {} }
      };
    });
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

  /**
   * A foreground line over the chords, an octave above them so it reads as a
   * melody rather than another arpeggiated layer of the harmony. Built from
   * each chord's own tones -- never a note the chord underneath doesn't
   * already support -- and walked rather than picked at random each time, so
   * it has some contour instead of hopping around.
   */
  melody(chainRef, chordSeq, start, chordDur, beat) {
    const STEPS = 4;
    const stepDur = chordDur / STEPS;
    let prev = null;
    chordSeq.forEach((notes, c) => {
      const at = start + c * chordDur;
      for (let i = 0; i < STEPS; i++) {
        // Rest occasionally -- a line that fills every slot never breathes.
        if (prev != null && Math.random() < 0.22) { prev = null; continue; }
        let idx = prev == null
          ? Math.floor(Math.random() * notes.length)
          : Math.max(0, Math.min(notes.length - 1, prev + (Math.random() < 0.6 ? (Math.random() < 0.5 ? 1 : -1) : 0)));
        prev = idx;
        const t = at + i * stepDur + Math.random() * stepDur * 0.12;
        const dur = stepDur * (0.4 + Math.random() * 0.35);
        this.note(chainRef, noteFreq(notes[idx]) * 2, t, dur);
      }
    });
  }

  // ----------------------------------------------------- the collective bed --

  /**
   * The only looping part of the collection: a slow pad on the chords of whichever
   * emotion the wall holds most of. Rebuilt whenever the wall changes.
   */
  async setBed() {
    await this.ensure();
    if (!this.ctx) return;
    const key = JSON.stringify(BED_CHORDS);
    if (this.bedChords === key && this.bedTimer) return;
    this.bedChords = key;
    this.bedNotes = BED_CHORDS;
    this.bedIndex = 0;
    this.bedNext = this.ctx.currentTime + 0.15;

    if (!this.bed) {
      this.bed = this.chain('ambient pad', 'ambient', 0.5, this.bedBus);
      this.bed.instrument = 'ambient pad';
      this.bed.gain.gain.setValueAtTime(1, this.ctx.currentTime);
      // cutoffFor('ambient') is deliberately dark for memories that are
      // actually somber -- the room itself isn't one of them, so it gets its
      // own brighter ceiling instead of inheriting that gloom.
      this.bed.filter.frequency.value = 2600;
    }
    if (!this.bedTimer) this.bedTimer = setInterval(() => this.pumpBed(), 500);
    this.pumpBed();
  }

  /** Look-ahead scheduler: keeps the bed a couple of chords ahead of the clock. */
  pumpBed() {
    if (!this.ctx || !this.bed || !this.bedNotes) return;
    const span = 5;
    while (this.bedNext < this.ctx.currentTime + 2.5) {
      const notes = this.bedNotes[this.bedIndex % this.bedNotes.length];
      this.bedIndex++;
      // The open, added-6th voicing, not a stacked triad. This used to keep
      // only the outer two voices, which left bare fifths -- and a fifth with
      // no third is neither major nor minor, so the bed read as hollow rather
      // than warm. The room is separated from the swells by register now, not
      // by gutting the chord.
      this.chord({ ...this.bed, instrument: 'ambient pad' }, notes, this.bedNext, span, 1);
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
   *
   * Returns `{ span, stop }`. Most callers let it run its own course, but
   * `enter` hands `stop` back to whoever opened the orb, so leaving early cuts
   * the swell off instead of leaving it to ring out (and get louder) on a
   * clock nobody's listening to anymore.
   */
  async contribute(analysis, { cycles = 2, fadeIn = 2.4, fadeOut = 4, gain = 0.62, label = '', melody = false } = {}) {
    await this.ensure();
    if (!this.ctx || !analysis) return { span: 0, stop() {} };

    const ctx = this.ctx;
    const beat = 60 / (analysis.tempo || 90);
    const chordDur = Math.max(beat * 4, ...analysis.instruments.map(minChordSpacing));
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

    const chordSeq = [];
    for (const instrument of analysis.instruments) {
      const ref = this.chain(instrument, analysis.mood, wet, swell);
      ref.instrument = instrument;
      ref.gain.gain.setValueAtTime(1, start);
      for (let c = 0; c < analysis.chords.length * cycles; c++) {
        const notes = analysis.chords[c % analysis.chords.length];
        if (chordSeq.length < analysis.chords.length * cycles) chordSeq.push(notes);
        this.chord(ref, notes, start + c * chordDur, chordDur, beat);
      }
    }

    if (melody) {
      // A plucked, one-shot voice reads as a foreground line; the sustained
      // pads and the arpeggios underneath already cover "harmony."
      const lead = 'plucked strings';
      const leadRef = this.chain(lead, analysis.mood, wet, swell);
      leadRef.instrument = lead;
      leadRef.gain.gain.setValueAtTime(1, start);
      this.melody(leadRef, chordSeq, start, chordDur, beat);
    }

    const entry = { label, emotion: analysis.emotion, until: start + span };
    this.live.add(entry);
    this.onchange?.(this.voices);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { swell.disconnect(); } catch {}
      this.live.delete(entry);
      this.onchange?.(this.voices);
    };
    let timer = setTimeout(finish, (span + 0.4) * 1000);

    if (!this.muted) this.fadeMaster(1, 0.8);

    const stop = (tail = 0.6) => {
      if (done) return;
      clearTimeout(timer);
      const t = ctx.currentTime;
      try {
        g.cancelScheduledValues(t);
        g.setValueAtTime(Math.max(0.0001, g.value), t);
        g.exponentialRampToValueAtTime(0.0001, t + tail);
      } catch {}
      timer = setTimeout(finish, tail * 1000 + 100);
    };

    return { span, stop };
  }

  /**
   * The doorway between the collection and one memory. Hovering only ever
   * previews a single thin voice -- the real progression is saved for
   * stepping inside -- so opening an orb should sound like arriving
   * somewhere fuller, not like the hover simply continuing underneath it.
   * This plays the memory's actual chords once, thickened with three voices
   * its own profile didn't call for plus a foreground melody, every time --
   * consistently, not as a chance embellishment -- as the audible marker that
   * you have crossed in rather than just muted the room behind you.
   */
  async enter(analysis, label) {
    if (!analysis) return { span: 0, stop() {} };
    // 'plucked strings' is left out of the pool here even when the profile
    // doesn't already use it -- it's reserved for the melody line below, so
    // it never ends up doubled as both a chordal layer and the lead.
    const extra = Object.keys(VOICES)
      .filter((v) => v !== 'plucked strings' && !analysis.instruments.includes(v))
      .slice(0, 3);
    const fuller = { ...analysis, instruments: [...analysis.instruments, ...extra] };
    // Slow on purpose: this rises on the same clock as the hover fading out
    // and the room ducking under it, so the three read as one crossfade
    // rather than a swap.
    return this.contribute(fuller, { cycles: 1, fadeIn: 2.2, fadeOut: 3.4, gain: 0.55, label, melody: true });
  }

  /** What is audible right now, for the collection's readout. */
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

    // How long the hover takes to die away. A plain mouse-leave wants a quick,
    // unremarkable fade; stepping into the orb wants this stretched out to
    // match `enter`'s rise and the room's duck, so the three read as one
    // crossfade instead of a cut followed by a swell.
    const release = (tail = 0.9) => {
      if (stopped) return;
      stopped = true;
      clearInterval(scheduler);
      const t = ctx.currentTime;
      try {
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), t);
        out.gain.exponentialRampToValueAtTime(0.0001, t + tail);
      } catch {}
      setTimeout(() => {
        for (const p of parts) { try { p.stop(); } catch {} }
        try { out.disconnect(); } catch {}
      }, tail * 1000 + 100);
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
        const span = to - from;
        // A native `loop` on a raw window clicks at the seam every repeat --
        // `from`/`to` land wherever the recording happens to be, not on a zero
        // crossing, and those clicks stack into static within a few cycles.
        // Re-arming a faded one-shot instead (as orbaudio.js's strands do)
        // keeps every loop point silent.
        const fade = Math.min(0.35, span * 0.3);
        // A raw recording's sub-bass -- handling noise, room rumble -- has
        // nowhere to go but the bed underneath it, which is already voiced an
        // octave low on purpose. The two stacking is what reads as "static":
        // it is the compressor squashing a bass buildup, not a click. Rolling
        // the clip's low end off before it joins the room keeps that headroom.
        const rumble = ctx.createBiquadFilter();
        rumble.type = 'highpass';
        rumble.frequency.value = 130;
        rumble.Q.value = 0.7;
        rumble.connect(out);
        let timer = null;
        let current = null;
        const fireLoop = () => {
          if (stopped) return;
          const node = ctx.createBufferSource();
          node.buffer = buf;
          const env = ctx.createGain();
          const t = ctx.currentTime;
          env.gain.setValueAtTime(0.0001, t);
          env.gain.exponentialRampToValueAtTime(0.85, t + fade);
          env.gain.setValueAtTime(0.85, t + span - fade);
          env.gain.exponentialRampToValueAtTime(0.0001, t + span);
          node.connect(env);
          env.connect(rumble);
          node.start(t, from, span);
          current = node;
          node.onended = () => { try { node.disconnect(); env.disconnect(); } catch {} };
          timer = setTimeout(fireLoop, span * 1000);
        };
        fireLoop();
        parts.push({ stop: () => { clearTimeout(timer); try { current?.stop(); } catch {} try { rumble.disconnect(); } catch {} } });
      }
    }

    if (!parts.length) {
      // No recording: loop the chords its words were read as.
      const analysis = memory.analysis || { chords: [['C4', 'E4', 'G4']], tempo: 90, mood: 'neutral', reverb: 0.3 };
      const beat = 60 / (analysis.tempo || 90);
      const chordDur = Math.max(beat * 4, minChordSpacing('ambient pad'));
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

    // Coloring, not a swap: the bed keeps playing underneath at full volume,
    // so a hover only needs to be present, not loud, to read as "the memory
    // under the cursor is now part of what's sounding." A slower rise than
    // `enter`'s reads as gentle rather than as an event.
    const t = ctx.currentTime;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.42, t + 0.9);
    if (!this.muted) this.fadeMaster(1, 0.5);

    return { release };
  }

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
   * the collection pulled down underneath it.
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
