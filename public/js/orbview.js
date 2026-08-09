// Inside one memory.
//
// The shell is the collection's: a sphere that grows out of the marble you
// clicked, dead centre at every window size, with the page frosted behind it
// and no back button -- anywhere outside closes it.
//
// What happens *inside* the sphere is the orb prototype's engine, and it gives
// a memory back in one of two ways, chosen by the memory's own recipe:
//
//   sequence  one thing at a time, running until you leave   (sequence.js)
//   collage   one arrangement, everything at once, held still (compose.js)
//
// A collage version stores its whole arrangement. A sequence version stores a
// seed and how long you stayed, because the arrangement is endless -- and is
// replayed by handing that seed back to the same generator.

import { layerCanvas, trimLayerCache } from './imagelayers.js';
import { composeVersion, idsOf, settingsOf } from './compose.js';
import { makeStream, decayAt, retainedStrain } from './sequence.js';
import { StreamPlayer } from './stream.js';
import { get } from './settings.js';
import { r3 } from './rng.js';
import { EMOTION_HUE } from './emotion.js';

export class OrbView {
  constructor(root, audio, scape, session) {
    this.root = root;
    this.audio = audio;
    this.scape = scape;
    this.session = session;
    this.orb = null;
    this.version = null;
    this.token = 0;
    this.videos = [];
    this.timers = [];
    this.raf = null;
  }

  async open(id) {
    const res = await fetch(`/api/orbs/${id}`);
    if (!res.ok) throw new Error('orb not found');
    this.orb = await res.json();
    this.settings = settingsOf(this.orb);

    // The collection keeps playing underneath, but this memory sits on top of
    // it -- pulled down far enough that its own sound is clearly the loudest
    // thing in the room, not so far that the room disappears.
    this.scape.duck(0.34, 1.2);

    this.shell();

    // Visiting a memory is what puts it into the shared audioscape. It swells
    // in the collection when you come back out.
    if (this.orb.analysis) this.session.queue(this.orb.analysis, this.orb.title);

    if (this.mode === 'sequence') return this.openStream();
    const version = composeVersion(this.orb, this.settings);
    await this.show(version);
    await this.persist(version);
  }

  get mode() { return get(this.settings, 'global.mode'); }

  // -------------------------------------------------------------- the shell --

  shell() {
    const o = this.orb;
    const g = orbGradient(o);
    this.root.innerHTML = `
      <div class="orbmodal" data-role="modal" style="--glow:${o.marble || o.glow};--g1:${g[0]};--g2:${g[1]};--g3:${g[2]}">
        <div class="orbscrim" data-role="scrim"></div>
        <div class="orbstage" data-role="stage">
          <div class="sphere" data-role="sphere">
            <div class="collage" data-role="collage"></div>
            <div class="grain"></div>
            <div class="glass"></div>
            <div class="rim"></div>
          </div>
          <h2 class="orb-title">${esc(o.title)}</h2>
          <p class="orb-sub" data-role="sub"></p>
        </div>
      </div>`;

    this.modal = this.root.querySelector('[data-role=modal]');
    this.stage = this.root.querySelector('[data-role=stage]');
    this.sphere = this.root.querySelector('[data-role=sphere]');
    this.collage = this.root.querySelector('[data-role=collage]');
    this.sub = this.root.querySelector('[data-role=sub]');

    // There is no back button: anywhere outside the orb closes it.
    this.root.querySelector('[data-role=scrim]').addEventListener('click', () => this.dismiss());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal || e.target === this.stage) this.dismiss();
    });
    this.onKey = (e) => { if (e.key === 'Escape') this.dismiss(); };
    document.addEventListener('keydown', this.onKey);

    this.sphere.addEventListener('pointermove', (e) => {
      const r = this.sphere.getBoundingClientRect();
      this.sphere.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      this.sphere.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    });
    this.sphere.addEventListener('pointerleave', () => {
      this.sphere.style.setProperty('--mx', 0);
      this.sphere.style.setProperty('--my', 0);
    });

    this.growFrom(window.__fromRect);
    this.pulse();
  }

  /** The marble you clicked becomes the orb: grow out of exactly where it was. */
  growFrom(rect) {
    if (!rect || !this.stage) return;
    const r = this.sphere.getBoundingClientRect();
    if (!r.width) return;
    const scale = Math.max(0.06, rect.width / r.width);
    const dx = (rect.left + rect.width / 2) - (r.left + r.width / 2);
    const dy = (rect.top + rect.height / 2) - (r.top + r.height / 2);
    this.stage.style.transition = 'none';
    this.stage.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    this.stage.style.opacity = '0.5';
    requestAnimationFrame(() => {
      this.stage.style.transition = 'transform .72s cubic-bezier(.16,1,.3,1), opacity .5s ease';
      this.stage.style.transform = 'translate(0,0) scale(1)';
      this.stage.style.opacity = '1';
    });
    window.__fromRect = null;
  }

  dismiss() {
    if (this.dismissing) return;
    this.dismissing = true;
    location.hash = '#/';
  }

  /** The sphere breathes with whatever is actually audible. */
  pulse() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (!this.sphere?.isConnected) return;
      this.sphere.style.setProperty('--pulse', (0.8 + this.audio.level() * 0.9).toFixed(3));
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** The one line under the glass. It is the only readout left in here. */
  say(html) {
    if (this.sub) this.sub.innerHTML = html;
  }

  // ------------------------------------------------------------- sequence ---

  /**
   * A sequence is committed to the history the moment it starts -- opening the
   * memory is what costs it, not finishing. What you stayed for is written back
   * when you leave, by `flush`.
   */
  async openStream(opts = {}) {
    this.stopStream();
    this.stopVideos();
    const stream = makeStream(this.orb, this.settings, opts);
    this.stream = stream;
    this.seen = new Set();
    this.collage.innerHTML = '';

    const version = {
      n: this.orb.versions.length + 1,
      at: Date.now(),
      mode: 'seq',
      seed: stream.seed,
      decay: r3(stream.base),
      beats: 0,
      seen: [],
    };
    this.version = version;
    await this.persist(version);

    this.player = new StreamPlayer({
      stage: this.collage,
      audio: this.audio,
      onBeat: (b) => this.onBeat(b),
    });
    this.player.start(this.orb, stream);
  }

  onBeat(b) {
    for (const id of beatIds(b)) this.seen.add(id);
    this.sphere?.style.setProperty('--decay', b.decay);
    if (b.flash) {
      this.sphere?.classList.add('flashing');
      setTimeout(() => this.sphere?.classList.remove('flashing'), 2600 / this.player.speed);
    }
    const total = Object.keys(this.orb.components).length;
    this.say(`${this.seen.size} of ${total} fragments seen · ${Math.round(b.decay * 100)}% faded${b.flash ? ' · <span class="flashword">a vivid flash</span>' : ''}`);
  }

  /**
   * Looking wears a memory out, but you do not keep all of that damage: most of
   * the strain relaxes once the memory is closed, and only a fraction is folded
   * into it for good.
   */
  async flush() {
    if (!this.player || !this.stream || this.version?.mode !== 'seq') return;
    const i = this.player.watched;
    const body = JSON.stringify({
      beats: i,
      decay: r3(decayAt(this.stream, i)),
      strain: retainedStrain(this.stream, i),
      seen: [...this.seen],
    });
    this.version.beats = i;
    this.version.seen = [...this.seen];
    // A tab being closed is a common way to leave, and fetch does not survive
    // it. The beacon does.
    const url = `/api/orbs/${this.orb.id}/versions/${this.version.n}`;
    if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    else await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body }).catch(() => {});
  }

  stopStream() {
    this.player?.stop();
    this.player = null;
  }

  // -------------------------------------------------------------- collage ---

  async persist(version) {
    const res = await fetch(`/api/orbs/${this.orb.id}/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version }),
    });
    if (!res.ok) return;
    const meta = await res.json();
    version.n = meta.n;
    version.at = meta.at;
    this.orb.versions.push(version);
    this.orb.decay = meta.decay;
  }

  async show(version) {
    const token = ++this.token;
    this.version = version;
    this.stopStream();
    this.stopVideos();
    this.collage.innerHTML = '';
    this.sphere.style.setProperty('--decay', version.decay);
    this.sphere.classList.toggle('flashing', !!version.flash);
    if (version.flash) setTimeout(() => this.sphere?.classList.remove('flashing'), 2600);

    const present = idsOf(version).size;
    const total = Object.keys(this.orb.components).length;
    this.say(`${present} of ${total} fragments present · ${Math.round(version.decay * 100)}% faded${version.flash ? ' · <span class="flashword">a vivid flash</span>' : ''}`);

    const rect = this.sphere.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height) || 720;

    let i = 0;
    for (const plate of version.plates) {
      const el = this.plateEl(plate, size, version);
      if (!el) continue;
      el.style.setProperty('--in-delay', `${(i++ * 90 + Math.random() * 200).toFixed(0)}ms`);
      this.collage.appendChild(el);
    }

    // Image layers decode asynchronously; bail if a newer version started.
    for (const plate of version.plates) {
      if (plate.k !== 'image') continue;
      for (const layer of plate.layers) {
        try {
          const canvas = await layerCanvas(this.orb, layer.c, 880, plate.sh);
          if (token !== this.token) return;
          const holder = this.collage.querySelector(`[data-layer="${cssEsc(layer.c)}"]`);
          if (holder) {
            const clone = canvas.cloneNode(true);
            clone.getContext('2d').drawImage(canvas, 0, 0);
            holder.appendChild(clone);
            holder.classList.add('ready');
          }
        } catch (err) {
          console.warn('layer failed', layer.c, err);
        }
      }
    }

    if (token !== this.token) return;
    trimLayerCache();
    this.audio.play(this.orb, version, this.settings).catch(() => {});
  }

  plateEl(plate, size, version) {
    const el = document.createElement('div');
    el.className = `plate plate-${plate.k}`;
    el.style.left = `${plate.x * 100}%`;
    el.style.top = `${plate.y * 100}%`;
    el.style.setProperty('--r', `${plate.r}deg`);
    el.style.setProperty('--z', plate.z);
    el.style.setProperty('--drift', `${(16 + Math.random() * 18).toFixed(1)}s`);
    el.style.setProperty('--drift-delay', `${(-Math.random() * 12).toFixed(1)}s`);
    el.style.setProperty('--o', plate.o);

    const inner = document.createElement('div');
    inner.className = 'plate-inner';
    el.appendChild(inner);

    if (plate.k === 'image') {
      el.style.width = `${plate.s * size}px`;
      const src = this.orb.sources[plate.src];
      const ratio = src.h && src.w ? src.h / src.w : 0.7;
      inner.style.paddingBottom = `${ratio * 100}%`;
      inner.style.filter = cssFilter(plate.blur, plate.sat);
      for (const layer of plate.layers) {
        const holder = document.createElement('div');
        holder.className = 'layer';
        holder.dataset.layer = layer.c;
        holder.style.setProperty('--layer-o', layer.o);
        holder.style.mixBlendMode = layer.b;
        holder.style.transform = `translate(${layer.dx * 100}%, ${layer.dy * 100}%)`;
        if (layer.blur) holder.style.filter = `blur(${layer.blur}px)`;
        if (version.flashed?.includes(layer.c)) holder.classList.add('flashed');
        inner.appendChild(holder);
      }
      return el;
    }

    if (plate.k === 'video') {
      const comp = this.orb.components[plate.c];
      const src = this.orb.sources[comp.src];
      el.style.width = `${plate.s * size}px`;
      const ratio = src.h && src.w ? src.h / src.w : 0.56;
      inner.style.paddingBottom = `${ratio * 100}%`;
      inner.style.mixBlendMode = plate.b;
      inner.style.filter = cssFilter(plate.blur, plate.sat);
      // The window is the plate's, not the component's: the portion cut at
      // upload is only the anchor the settings slid around.
      const win = plate.win || { start: comp.start, end: comp.end };
      const video = document.createElement('video');
      video.muted = true;             // the picture is silent; its sound is a strand
      video.playsInline = true;
      video.preload = 'auto';
      video.src = src.url;
      video.playbackRate = plate.rate || 1;
      const loop = () => {
        if (video.currentTime >= win.end || video.currentTime < win.start - 0.4) {
          video.currentTime = win.start;
        }
      };
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = win.start;
        video.play().catch(() => {});
      });
      video.addEventListener('timeupdate', loop);
      if (version.flashed?.includes(plate.c)) inner.classList.add('flashed');
      inner.appendChild(video);
      if (plate.fl) this.flicker(inner, video, plate, win);
      this.videos.push(video);
      return el;
    }

    if (plate.k === 'text') {
      el.style.width = `${plate.w * size}px`;
      if (plate.tr != null) inner.style.letterSpacing = `${plate.tr}em`;
      if (plate.lh != null) inner.style.lineHeight = plate.lh;
      for (const f of plate.frags) {
        const comp = this.orb.components[f.c];
        if (!comp) continue;
        const line = document.createElement('p');
        line.className = 'frag' + (f.em ? ' em' : '');
        line.textContent = comp.text;
        line.style.opacity = f.o;
        line.style.fontSize = `${f.sc}em`;
        if (plate.gl) line.style.textShadow = `0 0 ${(plate.gl * 18).toFixed(1)}px currentColor`;
        if (f.blur) line.style.filter = `blur(${f.blur}px)`;
        if (version.flashed?.includes(f.c)) line.classList.add('flashed');
        inner.appendChild(line);
      }
      return inner.childElementCount ? el : null;
    }
    return null;
  }

  /**
   * A bad tape: the picture dips, occasionally drops out entirely, and now and
   * then jumps somewhere else inside its own window. Driven on a timer rather
   * than an animation so the stutter is genuinely irregular.
   */
  flicker(inner, video, plate, win) {
    const { depth, rate, dropout, jump } = plate.fl;
    const period = 1000 / Math.max(0.2, rate);
    const timer = setInterval(() => {
      if (!inner.isConnected) return clearInterval(timer);
      if (dropout > 0 && Math.random() < dropout * 0.3) {
        inner.style.opacity = '0';
        setTimeout(() => { if (inner.isConnected) inner.style.opacity = ''; }, period * (0.5 + Math.random()));
        return;
      }
      inner.style.opacity = (1 - Math.random() * depth).toFixed(3);
      if (jump > 0 && Math.random() < jump * 0.12) {
        const span = Math.max(0.1, win.end - win.start);
        try { video.currentTime = win.start + Math.random() * span; } catch {}
      }
    }, period);
    this.timers.push(timer);
  }

  stopVideos() {
    for (const v of this.videos) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch {} }
    for (const t of this.timers) clearInterval(t);
    this.videos = [];
    this.timers = [];
  }

  /** Leaving the memory entirely: hand back what the sitting cost it. */
  close() {
    this.flush();
    cancelAnimationFrame(this.raf);
    this.stopStream();
    this.stopVideos();
    document.removeEventListener('keydown', this.onKey);
    this.token++;
  }
}

/** Every component a single beat put in front of you. */
export function beatIds(b) {
  const ids = [];
  if (b.kind === 'image') for (const l of b.layers || []) ids.push(l.c);
  if (b.kind === 'video') ids.push(b.c);
  for (const f of b.text?.frags || []) ids.push(f.c);
  return ids;
}

/**
 * The orb's colour. If the memory has pictures in it, the gradient is built
 * from their own dominant clusters, so the sphere is lit by the thing inside
 * it. If it is only words, the gradient comes from the mood those words were
 * read as instead.
 */
function orbGradient(orb) {
  const cols = [];
  for (const src of Object.values(orb.sources)) {
    for (const c of (src.analysis?.palette || []).slice(0, 2)) {
      cols.push(`rgb(${c.r},${c.g},${c.b})`);
    }
  }
  if (cols.length >= 2) {
    return [cols[0], cols[1], cols[2] || cols[0]];
  }
  const hue = EMOTION_HUE[orb.emotion] ?? 268;
  return [
    `hsl(${hue} 62% 58%)`,
    `hsl(${(hue + 38) % 360} 55% 48%)`,
    `hsl(${(hue + 330) % 360} 48% 40%)`,
  ];
}

/** Blur and saturation share one property, so they have to be built together. */
function cssFilter(blur, sat) {
  const parts = [];
  if (blur) parts.push(`blur(${blur}px)`);
  if (sat != null && Math.abs(sat - 1) > 0.01) parts.push(`saturate(${sat})`);
  return parts.join(' ');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const cssEsc = (s) => String(s).replace(/["\\]/g, '\\$&');
