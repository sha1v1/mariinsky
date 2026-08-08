// Inside one memory. Renders a version of it in the sphere, drives the history
// timeline, and asks compose.js for a fresh version every time it is opened.
//
// Unchanged from the orb prototype apart from where it sits in the app: the
// glow follows the memory's marble colour, the garden's audioscape is ducked
// while you are in here so the memory's own decayed sound has the room, and
// opening a memory hands it to the audioscape to be heard when you go back.

import { layerCanvas } from './imagelayers.js';
import { composeVersion, idsOf } from './compose.js';
import { explain } from './emotion.js';

const KIND_LABEL = {
  imageLayer: 'image layer',
  videoPortion: 'video portion',
  textFragment: 'text fragment',
  audioWindow: 'audio window',
};

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
    this.raf = null;
  }

  async open(id) {
    const res = await fetch(`/api/orbs/${id}`);
    if (!res.ok) throw new Error('orb not found');
    this.orb = await res.json();
    document.body.classList.add('in-memory');

    // The garden keeps playing behind you, just far away.
    this.scape.duck(0.12, 1.2);

    this.shell();
    const version = composeVersion(this.orb);
    await this.show(version);
    await this.persist(version);

    // Visiting a memory is what puts it into the shared audioscape. It swells
    // in the garden when you come back out.
    if (this.orb.analysis) this.session.queue(this.orb.analysis, this.orb.title);
  }

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
    this.drawTimeline();
  }

  async again() {
    const version = composeVersion(this.orb);
    await this.show(version);
    await this.persist(version);
  }

  shell() {
    const o = this.orb;
    this.root.innerHTML = `
      <div class="orbscene" style="--glow:${o.marble || o.glow}">
        <header class="hud">
          <button class="btn" data-act="back">← the garden</button>
          <div class="hud-title">
            <h1>${esc(o.title)}</h1>
            <p class="hud-sub" data-role="sub"></p>
          </div>
          <div class="hud-actions">
            <button class="btn" data-act="reveal">what is left</button>
            <button class="btn" data-act="mute">sound on</button>
            <button class="btn btn-key" data-act="again">open it again</button>
          </div>
        </header>
        <div class="stagewrap">
          <div class="sphere" data-role="sphere">
            <div class="collage" data-role="collage"></div>
            <div class="grain"></div>
            <div class="glass"></div>
            <div class="rim"></div>
          </div>
          <div class="reveal" data-role="reveal" hidden></div>
        </div>
        <footer class="timeline">
          <div class="tl-label">every time somebody has opened this</div>
          <div class="tl-strip" data-role="strip"></div>
        </footer>
      </div>`;

    this.sphere = this.root.querySelector('[data-role=sphere]');
    this.collage = this.root.querySelector('[data-role=collage]');
    this.strip = this.root.querySelector('[data-role=strip]');
    this.sub = this.root.querySelector('[data-role=sub]');
    this.revealEl = this.root.querySelector('[data-role=reveal]');

    this.root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'back') location.hash = '#/';
      if (act === 'again') this.again();
      if (act === 'reveal') this.toggleReveal();
      if (act === 'mute') {
        const btn = e.target.closest('[data-act=mute]');
        const next = !this.audio.muted;
        this.audio.setMuted(next);
        btn.textContent = next ? 'sound off' : 'sound on';
      }
    });

    this.sphere.addEventListener('pointermove', (e) => {
      const r = this.sphere.getBoundingClientRect();
      this.sphere.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      this.sphere.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    });
    this.sphere.addEventListener('pointerleave', () => {
      this.sphere.style.setProperty('--mx', 0);
      this.sphere.style.setProperty('--my', 0);
    });

    this.drawTimeline();
    this.pulse();
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

  async show(version, { replay = false } = {}) {
    const token = ++this.token;
    this.version = version;
    this.stopVideos();
    this.collage.innerHTML = '';
    this.sphere.style.setProperty('--decay', version.decay);
    this.sphere.classList.toggle('flashing', !!version.flash);
    if (version.flash) setTimeout(() => this.sphere?.classList.remove('flashing'), 2600);

    const present = idsOf(version).size;
    const total = Object.keys(this.orb.components).length;
    const label = replay ? `replaying opening ${version.n}` : `opening ${version.n}`;
    this.sub.innerHTML = `${label} · ${present} of ${total} fragments present · ${Math.round(version.decay * 100)}% faded${version.flash ? ' · <span class="flashword">a vivid flash</span>' : ''}`;

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
          const canvas = await layerCanvas(this.orb, layer.c);
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
    this.audio.play(this.orb, version).catch(() => {});
    this.drawTimeline();
    if (!this.revealEl.hidden) this.drawReveal();
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
      if (plate.blur) inner.style.filter = `blur(${plate.blur}px)`;
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
      if (plate.blur) inner.style.filter = `blur(${plate.blur}px)`;
      const video = document.createElement('video');
      video.muted = true;             // the picture is silent; its sound is a strand
      video.playsInline = true;
      video.preload = 'auto';
      video.src = src.url;
      const loop = () => {
        if (video.currentTime >= comp.end || video.currentTime < comp.start - 0.4) {
          video.currentTime = comp.start;
        }
      };
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = comp.start;
        video.play().catch(() => {});
      });
      video.addEventListener('timeupdate', loop);
      if (version.flashed?.includes(plate.c)) inner.classList.add('flashed');
      inner.appendChild(video);
      const tag = document.createElement('span');
      tag.className = 'stamp';
      tag.textContent = comp.name;
      el.appendChild(tag);
      this.videos.push(video);
      return el;
    }

    if (plate.k === 'text') {
      el.style.width = `${plate.w * size}px`;
      for (const f of plate.frags) {
        const comp = this.orb.components[f.c];
        if (!comp) continue;
        const line = document.createElement('p');
        line.className = 'frag' + (f.em ? ' em' : '');
        line.textContent = comp.text;
        line.style.opacity = f.o;
        line.style.fontSize = `${f.sc}em`;
        if (f.blur) line.style.filter = `blur(${f.blur}px)`;
        if (version.flashed?.includes(f.c)) line.classList.add('flashed');
        inner.appendChild(line);
      }
      return inner.childElementCount ? el : null;
    }
    return null;
  }

  stopVideos() {
    for (const v of this.videos) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch {} }
    this.videos = [];
  }

  drawTimeline() {
    this.strip.innerHTML = this.orb.versions
      .map((v) => {
        const active = this.version && v.n === this.version.n;
        return `<button class="chip${active ? ' active' : ''}${v.flash ? ' flash' : ''}" data-v="${v.n}" title="${new Date(v.at).toLocaleString()}">
          <span class="chip-n">${v.n}</span>
          <span class="chip-bar"><i style="width:${Math.round(v.decay * 100)}%"></i></span>
        </button>`;
      })
      .join('');
    this.strip.onclick = (e) => {
      const n = e.target.closest('[data-v]')?.dataset.v;
      if (!n) return;
      const v = this.orb.versions.find((x) => x.n === Number(n));
      if (v) this.show(v, { replay: true });
    };
    this.strip.scrollLeft = this.strip.scrollWidth;
  }

  toggleReveal() {
    this.revealEl.hidden = !this.revealEl.hidden;
    if (!this.revealEl.hidden) this.drawReveal();
  }

  drawReveal() {
    const here = idsOf(this.version);
    const groups = new Map();
    for (const [id, c] of Object.entries(this.orb.components)) {
      const key = KIND_LABEL[c.kind] || c.kind;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ id, c, here: here.has(id) });
    }
    const note = this.orb.analysis
      ? `<p class="note">in the garden this memory plays as ${esc(explain(this.orb.analysis))}.</p>`
      : '';
    this.revealEl.innerHTML = note + [...groups]
      .map(([kind, items]) => {
        const rows = items
          .map((it) => `<li class="${it.here ? 'here' : 'gone'}">${esc(labelFor(it.c))}</li>`)
          .join('');
        const n = items.filter((i) => i.here).length;
        return `<section><h3>${kind}s <em>${n}/${items.length}</em></h3><ul>${rows}</ul></section>`;
      })
      .join('');
  }

  close() {
    cancelAnimationFrame(this.raf);
    this.stopVideos();
    this.token++;
  }
}

function labelFor(c) {
  if (c.kind === 'textFragment') return `“${c.text.slice(0, 46)}${c.text.length > 46 ? '…' : ''}”`;
  return c.name || c.kind;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const cssEsc = (s) => String(s).replace(/["\\]/g, '\\$&');
