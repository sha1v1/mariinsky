// The sound of an orb: each audio window becomes a strand that fades in, plays
// its moment, fades out, and leaves the room quiet for a while before doing it
// again. Nothing is pre-rendered -- the "layers" are filters applied live, so
// they cost nothing to store and can differ on every replay.
//
// This used to be a seamless buffer loop, which cannot express a gap: a looping
// AudioBufferSourceNode runs its loop region end-to-end forever, with no seam to
// hang a fade or a silence on. So a strand is now a *scheduled one-shot* that
// re-arms itself. Each firing gets its own gain node and its own envelope,
// which is what makes per-loop fades possible at all.
//
// Strands live in *generations*. A sequence changes what it is listening to
// every few beats, and cutting the old set dead to start the new one is a
// splice you can hear. A generation is a gain node with its own reverb hanging
// off it, so retiring one is a single ramp and the two sets dissolve through
// each other instead.
import { get, sub } from './settings.js';

const BANDS = [
  { type: 'lowpass', freq: 260, q: 0.7 },
  { type: 'bandpass', freq: 1150, q: 0.6 },
  { type: 'highpass', freq: 3600, q: 0.7 },
];

export class OrbAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.analyser = null;
    this.buffers = new Map();
    this.gens = [];
    this.gen = null;
    this.impulse = null;
    this.muted = false;
  }

  async ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.master.connect(comp);
      comp.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.impulse = impulse(this.ctx, 2.6, 2.4);
    }
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* needs a user gesture; caller retries */ }
    }
    return this.ctx;
  }

  /** 0..1 loudness, for making the orb breathe with its own sound. */
  level() {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i += 4) peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
    return peak;
  }

  async buffer(url) {
    if (this.buffers.has(url)) return this.buffers.get(url);
    const p = (async () => {
      const res = await fetch(url);
      const bytes = await res.arrayBuffer();
      return await this.ctx.decodeAudioData(bytes);
    })();
    this.buffers.set(url, p);
    return p;
  }

  async reversed(url) {
    const key = url + '#rev';
    if (this.buffers.has(key)) return this.buffers.get(key);
    const p = (async () => {
      const src = await this.buffer(url);
      const out = this.ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
      for (let c = 0; c < src.numberOfChannels; c++) {
        const from = src.getChannelData(c);
        const to = out.getChannelData(c);
        for (let i = 0, n = from.length; i < n; i++) to[i] = from[n - 1 - i];
      }
      return out;
    })();
    this.buffers.set(key, p);
    return p;
  }

  /**
   * A fresh bus for a new set of strands, faded up from nothing. Each carries
   * its own convolver so that retiring the generation takes its tail with it --
   * a shared reverb would keep ringing with the sound of a set you have already
   * left behind.
   */
  newGen(fade) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse;
    // Pre-delay sits in front of the tail: the gap between a sound and its
    // first reflection is most of what tells you how big the room is.
    const predelay = ctx.createDelay(0.5);
    predelay.delayTime.value = this.settings ? sub(this.settings, 'audio.distance', 'predelay') : 0;
    const reverbIn = ctx.createGain();
    reverbIn.connect(predelay);
    predelay.connect(reverb);
    reverb.connect(out);
    out.connect(this.master);

    const t = ctx.currentTime;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(1, t + Math.max(0.05, fade));

    const gen = { out, reverbIn, predelay, reverb, active: [] };
    this.gens.push(gen);
    return gen;
  }

  retire(gen, fade) {
    if (!gen) return;
    this.gens = this.gens.filter((g) => g !== gen);
    const t = this.ctx.currentTime;
    try {
      gen.out.gain.cancelScheduledValues(t);
      gen.out.gain.setValueAtTime(Math.max(0.0001, gen.out.gain.value), t);
      gen.out.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, fade));
    } catch { /* the context went away under us */ }
    setTimeout(() => this.disposeGen(gen), fade * 1000 + 140);
  }

  disposeGen(gen) {
    for (const a of gen.active) { try { a.stop(); } catch {} }
    gen.active = [];
    for (const n of [gen.out, gen.reverbIn, gen.predelay, gen.reverb]) { try { n.disconnect(); } catch {} }
  }

  /**
   * @param {object} opts  {fade} seconds to dissolve between the old set and
   *                       the new one. A sequence swaps often and wants a long
   *                       one; opening an orb outright wants almost none.
   */
  async play(orb, version, settings, opts = {}) {
    await this.ensure();
    if (!this.ctx) return;
    this.settings = settings || this.settings;
    const fade = opts.fade ?? 1.2;

    const old = this.gen;
    this.gen = this.newGen(fade);
    const gen = this.gen;
    if (old) this.retire(old, fade);

    const strands = version.audio?.strands || [];
    strands.forEach((s, i) => {
      const comp = orb.components[s.c];
      if (!comp) return;
      const src = orb.sources[comp.src];
      if (!src?.url) return;
      this.startStrand(gen, src, comp, s, i, strands.length).catch((err) => {
        console.warn('strand failed, falling back to element source', comp.src, err);
        try { this.startElementStrand(gen, src, comp, s, i, strands.length); } catch { /* no usable audio */ }
      });
    });

    const target = this.muted ? 0 : 1;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(this.master.gain.value, this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 1.6);
  }

  /** Everything between a strand's source and its generation's bus. */
  buildChain(gen, s, index, total) {
    const ctx = this.ctx;
    const S = this.settings;
    const input = ctx.createGain();
    const out = ctx.createGain();
    out.gain.value = s.g * (S ? sub(S, 'audio.distance', 'gain') : 1);

    const flat = s.bands.every((b) => b > 0.98);
    if (flat) {
      input.connect(out);
    } else {
      BANDS.forEach((b, i) => {
        if (s.bands[i] <= 0.001) return;
        const f = ctx.createBiquadFilter();
        f.type = b.type;
        f.frequency.value = b.freq;
        f.Q.value = b.q;
        const g = ctx.createGain();
        g.gain.value = s.bands[i] * (b.type === 'bandpass' ? 1.6 : 1);
        input.connect(f);
        f.connect(g);
        g.connect(out);
      });
    }

    // Distance: the far side of a room has no top end, and what does arrive is
    // mostly reflection. Level, air and room all move together off one slider.
    let tail = out;
    if (S) {
      const air = ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = sub(S, 'audio.distance', 'lowpass');
      air.Q.value = 0.7;
      out.connect(air);
      tail = air;

      // Strands are spread across the stereo field rather than each being
      // widened, which stays mono-compatible and avoids phasing.
      if (ctx.createStereoPanner && total > 1) {
        const pan = ctx.createStereoPanner();
        const spread = sub(S, 'audio.distance', 'width');
        pan.pan.value = ((index / Math.max(1, total - 1)) * 2 - 1) * spread * 0.8;
        tail.connect(pan);
        tail = pan;
      }
    }

    if (s.fx.trem > 0) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = s.fx.trem;
      depth.gain.value = 0.42;
      lfo.connect(depth);
      depth.connect(out.gain);
      lfo.start();
      gen.active.push({ stop: () => { try { lfo.stop(); } catch {} } });
    }

    tail.connect(gen.out);
    const verb = Math.max(s.fx.verb, S ? sub(S, 'audio.distance', 'reverb') : 0);
    if (verb > 0.01) {
      const send = ctx.createGain();
      send.gain.value = verb;
      tail.connect(send);
      send.connect(gen.reverbIn);
    }
    return { input, out, tail };
  }

  /** The window this strand plays, honouring the length bias over the stored cut. */
  windowFor(comp, s, dur) {
    const want = s.len || (comp.end - comp.start);
    const len = Math.max(0.4, Math.min(want, dur));
    let start = Math.max(0, Math.min(comp.start, dur - len));
    return { start, end: Math.min(dur, start + len) };
  }

  async startStrand(gen, src, comp, s, index, total) {
    const buf = s.fx.rev ? await this.reversed(src.url) : await this.buffer(src.url);
    const ctx = this.ctx;
    const dur = buf.duration;
    let { start, end } = this.windowFor(comp, s, dur);
    // A reversed buffer needs its window mirrored too.
    if (s.fx.rev) { const a = dur - end, b = dur - start; start = a; end = b; }
    start = Math.max(0, Math.min(start, dur - 0.2));
    end = Math.max(start + 0.4, Math.min(end, dur));

    const chain = this.buildChain(gen, s, index, total);
    const rate = s.fx.rate || 1;
    const strand = { stopped: false, timer: null, nodes: new Set() };

    const fire = () => {
      if (strand.stopped || !this.ctx) return;
      const S = this.settings;
      const span = (end - start) / rate;
      const fadeIn = Math.min(S ? get(S, 'audio.fadeIn') : 1.8, span * 0.45);
      const fadeOut = Math.min(S ? get(S, 'audio.fadeOut') : 2.4, span * 0.45);

      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.playbackRate.value = rate;

      // The envelope belongs to this firing, not to the strand, which is the
      // whole reason each loop can fade independently.
      const env = ctx.createGain();
      const t = ctx.currentTime + 0.02;
      env.gain.setValueAtTime(0.0001, t);
      if (fadeIn > 0.01) env.gain.exponentialRampToValueAtTime(1, t + fadeIn);
      else env.gain.setValueAtTime(1, t);
      const outAt = t + span - fadeOut;
      env.gain.setValueAtTime(1, Math.max(t + fadeIn, outAt));
      env.gain.exponentialRampToValueAtTime(0.0001, t + span);

      node.connect(env);
      env.connect(chain.input);
      node.start(t, start, end - start);
      strand.nodes.add(node);
      node.onended = () => { strand.nodes.delete(node); try { node.disconnect(); env.disconnect(); } catch {} };

      if (!S || get(S, 'audio.loop')) {
        const gap = S ? get(S, 'audio.gap') : 4;
        const jit = S ? get(S, 'audio.gapJitter') : 0.25;
        // Jitter keeps two strands from marching in step forever.
        const wait = Math.max(0, gap * (1 + (Math.random() * 2 - 1) * jit));
        strand.timer = setTimeout(fire, (span + wait) * 1000);
      }
    };

    fire();
    gen.active.push({
      stop: () => {
        strand.stopped = true;
        clearTimeout(strand.timer);
        for (const n of strand.nodes) { try { n.stop(); n.disconnect(); } catch {} }
        try { chain.input.disconnect(); chain.out.disconnect(); chain.tail.disconnect(); } catch {}
      },
    });
  }

  /** For containers the decoder refuses -- route a hidden element instead. */
  startElementStrand(gen, src, comp, s, index, total) {
    const el = document.createElement(src.kind === 'video' ? 'video' : 'audio');
    el.src = src.url;
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.playsInline = true;
    el.style.display = 'none';
    document.body.appendChild(el);
    const node = this.ctx.createMediaElementSource(el);
    const chain = this.buildChain(gen, s, index, total);
    const env = this.ctx.createGain();
    env.gain.value = 0.0001;
    node.connect(env);
    env.connect(chain.input);
    el.playbackRate = s.fx.rate || 1;

    const strand = { stopped: false, timer: null };
    const fire = () => {
      if (strand.stopped) return;
      const S = this.settings;
      const dur = el.duration || comp.end;
      const win = this.windowFor(comp, s, dur || comp.end);
      const span = (win.end - win.start) / (s.fx.rate || 1);
      const fadeIn = Math.min(S ? get(S, 'audio.fadeIn') : 1.8, span * 0.45);
      const fadeOut = Math.min(S ? get(S, 'audio.fadeOut') : 2.4, span * 0.45);
      const t = this.ctx.currentTime;
      try { el.currentTime = win.start; } catch {}
      el.play().catch(() => {});
      env.gain.cancelScheduledValues(t);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(1, t + Math.max(0.02, fadeIn));
      env.gain.setValueAtTime(1, Math.max(t + fadeIn, t + span - fadeOut));
      env.gain.exponentialRampToValueAtTime(0.0001, t + span);

      const loop = !S || get(S, 'audio.loop');
      const gap = S ? get(S, 'audio.gap') : 4;
      const jit = S ? get(S, 'audio.gapJitter') : 0.25;
      const wait = Math.max(0, gap * (1 + (Math.random() * 2 - 1) * jit));
      strand.timer = setTimeout(() => {
        if (strand.stopped) return;
        el.pause();
        if (loop) fire();
      }, (span + (loop ? wait : 0)) * 1000);
    };

    el.addEventListener('loadedmetadata', fire, { once: true });
    gen.active.push({
      stop: () => {
        strand.stopped = true;
        clearTimeout(strand.timer);
        el.pause();
        try { node.disconnect(); env.disconnect(); chain.input.disconnect(); chain.tail.disconnect(); } catch {}
        el.remove();
      },
    });
  }

  stopStrands() {
    for (const g of this.gens) this.disposeGen(g);
    this.gens = [];
    this.gen = null;
  }

  stop(fade = 0.6) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => this.stopStrands(), fade * 1000 + 60);
  }

  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(m ? 0 : 1, t + 0.4);
  }
}

function impulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}
