// The sound of an orb: each audio window becomes a looping strand, optionally
// split into low/mid/high bands and run through tape effects. Nothing is
// pre-rendered -- the "layers" are filters applied live, so they cost nothing
// to store and can differ on every replay.

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
    this.reverb = null;
    this.buffers = new Map();
    this.active = [];
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

      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = impulse(this.ctx, 2.6, 2.4);
      this.reverbIn = this.ctx.createGain();
      this.reverbIn.connect(this.reverb);
      this.reverb.connect(this.master);
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

  async play(orb, version) {
    await this.ensure();
    if (!this.ctx) return;
    this.stopStrands();

    const strands = version.audio?.strands || [];
    for (const s of strands) {
      const comp = orb.components[s.c];
      if (!comp) continue;
      const src = orb.sources[comp.src];
      if (!src?.url) continue;
      try {
        await this.startStrand(src, comp, s);
      } catch (err) {
        console.warn('strand failed, falling back to element source', comp.src, err);
        try { this.startElementStrand(src, comp, s); } catch { /* this source has no usable audio */ }
      }
    }

    const target = this.muted ? 0 : 1;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(this.master.gain.value, this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 1.6);
  }

  buildChain(s) {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const strandGain = ctx.createGain();
    strandGain.gain.value = 0;

    const flat = s.bands.every((b) => b > 0.98);
    if (flat) {
      input.connect(strandGain);
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
        g.connect(strandGain);
      });
    }

    if (s.fx.trem > 0) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = s.fx.trem;
      depth.gain.value = 0.42;
      lfo.connect(depth);
      depth.connect(strandGain.gain);
      lfo.start();
      this.active.push({ stop: () => { try { lfo.stop(); } catch {} } });
    }

    strandGain.connect(this.master);
    if (s.fx.verb > 0.01) {
      const send = ctx.createGain();
      send.gain.value = s.fx.verb;
      strandGain.connect(send);
      send.connect(this.reverbIn);
    }

    // Long fade-in: windows should seep in, not cut in.
    const t = ctx.currentTime;
    strandGain.gain.setValueAtTime(0.0001, t);
    strandGain.gain.exponentialRampToValueAtTime(Math.max(0.02, s.g), t + 1.8);
    return { input, strandGain };
  }

  async startStrand(src, comp, s) {
    const buf = s.fx.rev ? await this.reversed(src.url) : await this.buffer(src.url);
    const dur = buf.duration;
    // A reversed buffer needs its window mirrored too.
    let start = s.fx.rev ? dur - comp.end : comp.start;
    let end = s.fx.rev ? dur - comp.start : comp.end;
    start = Math.max(0, Math.min(start, dur - 0.2));
    end = Math.max(start + 0.4, Math.min(end, dur));

    const node = this.ctx.createBufferSource();
    node.buffer = buf;
    node.loop = true;
    node.loopStart = start;
    node.loopEnd = end;
    node.playbackRate.value = s.fx.rate || 1;

    const { input, strandGain } = this.buildChain(s);
    node.connect(input);
    node.start(this.ctx.currentTime, start);
    this.active.push({
      stop: () => { try { node.stop(); } catch {} node.disconnect(); strandGain.disconnect(); },
      gain: strandGain,
    });
  }

  /** For containers the decoder refuses -- route a hidden element instead. */
  startElementStrand(src, comp, s) {
    const el = document.createElement(src.kind === 'video' ? 'video' : 'audio');
    el.src = src.url;
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.playsInline = true;
    el.style.display = 'none';
    document.body.appendChild(el);
    const node = this.ctx.createMediaElementSource(el);
    const { input, strandGain } = this.buildChain(s);
    node.connect(input);
    el.playbackRate = s.fx.rate || 1;
    const loop = () => { if (el.currentTime >= comp.end || el.currentTime < comp.start - 0.5) el.currentTime = comp.start; };
    el.addEventListener('loadedmetadata', () => { el.currentTime = comp.start; el.play().catch(() => {}); });
    el.addEventListener('timeupdate', loop);
    this.active.push({
      stop: () => { el.pause(); el.removeEventListener('timeupdate', loop); node.disconnect(); strandGain.disconnect(); el.remove(); },
      gain: strandGain,
    });
  }

  stopStrands() {
    for (const a of this.active) { try { a.stop(); } catch {} }
    this.active = [];
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
