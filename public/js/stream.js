// Plays a stream: puts one beat on the glass, takes it away, puts up the next.
//
// Everything here is timing. sequence.js already decided *what* beat 12 is; all
// this does is honour its clock -- and there are three clocks, deliberately out
// of step with each other:
//
//   beats   one picture at a time, each with its own length
//   drift   words arriving on their own schedule, outliving the picture they
//           appeared over
//   sound   changed every few beats, and only occasionally on a beat boundary
//
// `global.speed` multiplies all three at once. It exists so you can watch a
// memory go from whole to nearly gone in a minute instead of an evening; at 1
// it changes nothing.
import { get, sub } from './settings.js';
import { beatAt, driftAt, driftMost, audioAt } from './sequence.js';
import { layerCanvas, trimLayerCache } from './imagelayers.js';

export class StreamPlayer {
  constructor({ stage, audio, onBeat }) {
    this.stage = stage;
    this.audio = audio;
    this.onBeat = onBeat || (() => {});
    this.timers = new Set();
    this.intervals = new Set();
    this.running = false;
    this.i = 0;
  }

  get speed() { return Math.max(0.1, get(this.stream.s, 'global.speed') || 1); }

  start(orb, stream) {
    this.stop();
    this.orb = orb;
    this.stream = stream;
    this.running = true;
    this.token = (this.token || 0) + 1;
    this.t0 = performance.now();
    this.i = 0;
    this.driftK = 0;
    this.audioSlot = null;
    this.audioCount = -1;

    // Drifting words sit above every beat and are never torn down with one.
    this.driftEl = document.createElement('div');
    this.driftEl.className = 'seq-drift';
    this.stage.appendChild(this.driftEl);

    this.beat();
    this.scheduleDrift();
  }

  /** Beats seen so far -- what the orb charges you strain for. */
  get watched() { return this.i; }

  // --------------------------------------------------------------- beats ---

  beat() {
    if (!this.running) return;
    const b = beatAt(this.stream, this.i++);
    this.onBeat(b, this);
    this.show(b);
    this.sound(b);
    this.after((b.dur / this.speed) * 1000, () => this.beat());
  }

  show(b) {
    const prev = this.current;
    const el = this.build(b);
    el.style.opacity = '0';
    el.style.transitionDuration = `${b.fade.in / this.speed}s`;
    this.stage.insertBefore(el, this.driftEl);
    this.current = el;

    // A cut that goes through black waits for the old picture to be gone before
    // it brings the new one up. A dissolve overlaps them.
    const wait = b.fade.black ? (b.fade.out / this.speed) * 1000 + 90 : 16;
    this.after(wait, () => { el.style.opacity = '1'; });

    if (prev) {
      prev.style.transitionDuration = `${b.fade.out / this.speed}s`;
      prev.style.opacity = '0';
      this.after((b.fade.out / this.speed) * 1000 + 240, () => this.drop(prev));
    }
  }

  build(b) {
    const el = document.createElement('div');
    el.className = `seq-beat seq-${b.kind}${b.flash ? ' seq-flash' : ''}`;
    el.dataset.beat = b.i;
    el.cleanup = [];

    if (b.kind !== 'black') {
      const frame = document.createElement('div');
      frame.className = 'seq-frame';
      frame.style.filter = grade(b.grade);
      frame.style.opacity = b.grade.o;
      el.appendChild(frame);
      if (b.kind === 'image') this.buildImage(b, frame, el);
      else this.buildVideo(b, frame, el);
    }

    if (b.text) el.appendChild(this.buildText(b));
    return el;
  }

  /**
   * A rectangle has to fill a circle. Cropping alone throws away too much of a
   * panorama; stretching alone turns a face into a smear. `warp` blends the two
   * in log space, so the middle of the slider genuinely does a little of each.
   */
  fit(frame, aspect, warp) {
    const a = aspect > 0 ? aspect : 1;
    const cw = a >= 1 ? 1 : a;            // the contain-box, as a fraction of the square
    const ch = a >= 1 ? 1 / a : 1;
    const fx = 1 / cw, fy = 1 / ch;       // what each axis would need to fill on its own
    const cover = Math.max(fx, fy);
    const sx = Math.pow(cover, 1 - warp) * Math.pow(fx, warp);
    const sy = Math.pow(cover, 1 - warp) * Math.pow(fy, warp);
    frame.style.width = `${cw * 100}%`;
    frame.style.height = `${ch * 100}%`;
    frame.style.transform = `translate(-50%, -50%) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
  }

  buildImage(b, frame, el) {
    const src = this.orb.sources[b.src];
    this.fit(frame, src?.w && src?.h ? src.w / src.h : 1.4, b.grade.warp);

    const shader = shaderSpec(this.stream.s);
    for (const layer of b.layers) {
      const holder = document.createElement('div');
      holder.className = 'seq-layer';
      holder.style.setProperty('--layer-o', layer.o);
      holder.style.mixBlendMode = layer.b;
      holder.style.transform = `translate(${layer.dx * 100}%, ${layer.dy * 100}%)`;
      if (layer.blur) holder.style.filter = `blur(${layer.blur}px)`;
      frame.appendChild(holder);

      const token = this.token;
      layerCanvas(this.orb, layer.c, 880, shader).then((canvas) => {
        if (token !== this.token || !holder.isConnected) return;
        const clone = canvas.cloneNode(true);
        clone.getContext('2d').drawImage(canvas, 0, 0);
        holder.appendChild(clone);
        holder.classList.add('ready');
      }).catch(() => {});

      // The strobe. When the memory is whole this fires slowly and almost never
      // takes anything away; as it rots it fires constantly and the picture
      // spends most of its time incomplete. A flash sends `strobe` null.
      if (!layer.strobe) continue;
      const period = Math.max(50, (layer.strobe.period * 1000) / this.speed);
      this.after(period * layer.strobe.phase, () => {
        if (!holder.isConnected) return;
        const t = this.every(period, () => {
          holder.style.opacity = Math.random() < layer.strobe.gap ? '0' : '';
        });
        el.cleanup.push(() => this.cancel(t));
      });
    }
    trimLayerCache();
  }

  buildVideo(b, frame, el) {
    const comp = this.orb.components[b.c];
    const src = this.orb.sources[comp.src];
    this.fit(frame, src?.w && src?.h ? src.w / src.h : 1.78, b.grade.warp);

    const video = document.createElement('video');
    video.muted = true;                 // the picture is silent; its sound is a strand
    video.playsInline = true;
    video.preload = 'auto';
    video.src = src.url;
    frame.appendChild(video);

    const win = b.win;
    const hold = () => {
      if (video.rev) return;            // reverse drives currentTime itself
      if (video.currentTime >= win.end || video.currentTime < win.start - 0.4) {
        video.currentTime = win.start;
      }
    };
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = win.start;
      this.resume(video);
    });
    video.addEventListener('timeupdate', hold);
    // Seeking back to the head of the window can drop the element out of play
    // on its own, and a beat that silently freezes reads as a bug rather than
    // as a memory. Anything that pauses us while we are not deliberately
    // running backwards gets picked straight back up.
    video.addEventListener('pause', () => {
      if (video.rev || video.dead || !this.running) return;
      this.after(0, () => {
        if (!video.rev && !video.dead && video.isConnected && video.paused) this.resume(video);
      });
    });

    // The ramp: the clip speeds up and slows down inside its own beat, and now
    // and then a stretch runs backwards -- which no browser will do, so it is
    // driven a frame at a time by hand.
    for (const seg of b.ramp || []) {
      this.after((seg.at / this.speed) * 1000, () => {
        if (!video.isConnected) return;
        if (seg.rev) return this.reverse(video, seg.rate, win, el);
        // Coming out of reverse, the hand-driven currentTime writes have to be
        // stopped *before* play() is asked for: a seek landing in the same frame
        // rejects the promise and the clip stays frozen with a rate set on it.
        video.rev = false;
        cancelAnimationFrame(video.raf);
        video.playbackRate = Math.min(16, seg.rate * this.speed);
        this.resume(video);
      });
    }

    if (b.fl) this.flicker(frame, video, b.fl, win, el, b.grade.o);
    el.cleanup.push(() => {
      // `dead` first: tearing down pauses the element, and the pause guard above
      // would otherwise dutifully start it playing again on the way out.
      video.dead = true;
      video.rev = false;
      cancelAnimationFrame(video.raf);
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch {}
    });
  }

  /** play() loses races against seeks. One retry is enough to settle them. */
  resume(video) {
    video.play().catch(() => {
      this.after(60, () => {
        if (video.isConnected && !video.rev && video.paused) video.play().catch(() => {});
      });
    });
  }

  /**
   * No browser plays video backwards, so it is driven a frame at a time.
   *
   * The position has to be kept here rather than read back off the element:
   * writing `currentTime` starts a seek, and until that seek lands the element
   * still reports the old position -- so a loop that reads, subtracts a frame,
   * and writes ends up subtracting from a stale number and going nowhere. It
   * runs paused, because a playing element would be fighting every write.
   */
  reverse(video, rate, win, el) {
    video.rev = true;
    video.pause();
    let pos = video.currentTime;
    let last = performance.now();
    const step = (now) => {
      if (!video.rev || video.dead || !video.isConnected || !this.running) return;
      const dt = (now - last) / 1000;
      last = now;
      pos -= dt * rate * this.speed;
      if (pos <= win.start) pos = win.end;
      // Queuing a second seek on top of an unfinished one just makes the
      // picture judder; skip the frame and let the accumulator carry on.
      if (!video.seeking) { try { video.currentTime = pos; } catch {} }
      video.raf = requestAnimationFrame(step);
    };
    video.raf = requestAnimationFrame(step);
  }

  /** A bad tape: dips, whole frames gone, and the odd jump elsewhere in the window. */
  flicker(frame, video, fl, win, el, base) {
    const period = 1000 / Math.max(0.2, fl.rate * this.speed);
    const t = this.every(period, () => {
      if (!frame.isConnected) return;
      if (fl.dropout > 0 && Math.random() < fl.dropout * 0.3) {
        frame.style.visibility = 'hidden';
        this.after(period * (0.5 + Math.random()), () => { frame.style.visibility = ''; });
        return;
      }
      // The dip is against the beat's own level, not against full brightness --
      // a faded picture that flickers to 1.0 would be brighter than it started.
      frame.style.opacity = ((1 - Math.random() * fl.depth) * base).toFixed(3);
      if (fl.jump > 0 && Math.random() < fl.jump * 0.12 && !video.rev) {
        const span = Math.max(0.1, win.end - win.start);
        try { video.currentTime = win.start + Math.random() * span; } catch {}
      }
    });
    el.cleanup.push(() => this.cancel(t));
  }

  buildText(b) {
    const wrap = document.createElement('div');
    wrap.className = 'seq-block';
    wrap.style.width = `${Math.min(0.82, b.text.w) * 100}%`;
    wrap.style.letterSpacing = `${b.text.tr}em`;
    wrap.style.lineHeight = b.text.lh;
    wrap.style.transform = `translate(-50%, -50%) rotate(${b.text.r}deg)`;
    for (const f of b.text.frags) {
      const comp = this.orb.components[f.c];
      if (!comp) continue;
      const p = document.createElement('p');
      p.className = 'frag' + (f.em ? ' em' : '');
      p.textContent = comp.text;
      p.style.opacity = f.o;
      p.style.fontSize = `${f.sc}em`;
      if (b.text.gl) p.style.textShadow = `0 0 ${(b.text.gl * 18).toFixed(1)}px currentColor`;
      if (f.blur) p.style.filter = `blur(${f.blur}px)`;
      wrap.appendChild(p);
    }
    return wrap.childElementCount ? wrap : document.createComment('');
  }

  drop(el) {
    for (const fn of el.cleanup || []) { try { fn(); } catch {} }
    el.remove();
  }

  // --------------------------------------------------------------- drift ---

  scheduleDrift() {
    if (!this.running) return;
    const d = driftAt(this.stream, this.driftK);
    if (!d) return;
    const due = (d.at * 1000) / this.speed - (performance.now() - this.t0);
    this.after(Math.max(30, due), () => {
      this.driftK++;
      this.word(d);
      this.scheduleDrift();
    });
  }

  word(d) {
    const comp = this.orb.components[d.c];
    if (!comp || !this.driftEl) return;
    const most = Math.max(0, driftMost(this.stream));
    if (most === 0) return;
    while (this.driftEl.childElementCount >= most) this.driftEl.firstElementChild.remove();

    const el = document.createElement('p');
    el.className = 'seq-word frag' + (d.em ? ' em' : '');
    el.textContent = comp.text;
    el.style.left = `${d.x * 100}%`;
    el.style.top = `${d.y * 100}%`;
    el.style.fontSize = `${d.sc}em`;
    el.style.transform = `translate(-50%, -50%) rotate(${d.r}deg)`;
    const fade = Math.min(1.4, d.life * 0.35) / this.speed;
    el.style.transitionDuration = `${fade}s`;
    this.driftEl.appendChild(el);

    this.after(24, () => { el.style.opacity = d.o; });
    this.after((d.life * 1000) / this.speed, () => {
      el.style.opacity = '0';
      this.after(fade * 1000 + 120, () => el.remove());
    });
  }

  // --------------------------------------------------------------- sound ---

  /**
   * Sound changes on its own schedule -- every few beats, regardless of what the
   * picture is doing. `audioCut` is the exception: now and then the roll says
   * this cut takes the sound with it, and those land like a downbeat precisely
   * because they are rare.
   */
  sound(b) {
    const slot = Math.floor(b.i / Math.max(1, get(this.stream.s, 'sequence.audioRefresh')));
    if (this.audioSlot !== null && slot === this.audioSlot && !b.audioCut) return;
    this.audioSlot = slot;
    this.audioCount++;
    const set = audioAt(this.stream, this.audioCount);
    if (!set.strands.length) return;
    this.audio.play(this.orb, set, this.stream.s, {
      fade: b.audioCut ? 0.22 / this.speed : 2.4 / this.speed,
    }).catch(() => {});
  }

  // --------------------------------------------------------------- admin ---

  after(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }

  every(ms, fn) {
    const t = setInterval(fn, ms);
    this.intervals.add(t);
    return t;
  }

  /**
   * Clearing an interval has to forget it too. A stream runs until you leave,
   * and a set that only ever grows is a leak with no upper bound -- an hour of
   * strobing is tens of thousands of dead ids.
   */
  cancel(t) {
    clearInterval(t);
    this.intervals.delete(t);
  }

  stop() {
    this.running = false;
    this.token = (this.token || 0) + 1;
    for (const t of this.timers) clearTimeout(t);
    for (const t of this.intervals) clearInterval(t);
    this.timers.clear();
    this.intervals.clear();
    for (const el of [...(this.stage?.children || [])]) this.drop(el);
    this.current = null;
    this.driftEl = null;
  }
}

function shaderSpec(s) {
  const kind = get(s, 'image.shader');
  if (kind === 'none') return null;
  const at = (k) => sub(s, 'image.shaderAmount', k);
  return {
    kind,
    radius: at('radius'), bloom: at('bloom'), bleed: at('bleed'),
    haze: at('haze'), drain: at('drain'), lift: at('lift'),
  };
}

function grade(g) {
  const parts = [];
  if (g.blur) parts.push(`blur(${g.blur}px)`);
  if (g.sat != null && Math.abs(g.sat - 1) > 0.01) parts.push(`saturate(${g.sat})`);
  return parts.join(' ');
}
