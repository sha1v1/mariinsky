// The landing page: every memory in the garden, scattered across the paper.
//
// Placement is a jittered grid seeded by each memory's own id, so a marble sits
// in the same place on every load and for every visitor -- you can tell someone
// "mine is the green one near the top" and be believed -- while still looking
// strewn rather than tabulated. Marbles are allowed to crowd each other; an
// i-spy page is meant to be a little hard to read.

import { mulberry32 } from './rng.js';
import { marbleTraits, hashId } from './marble.js';
import { EMOTION_HUE } from './emotion.js';
import { Mascot } from './mascot.js';

const HOVER_DWELL = 190;   // ms before a marble starts speaking

export class Garden {
  constructor(root, scape, session) {
    this.root = root;
    this.scape = scape;
    this.session = session;
    this.wall = [];
    this.mascot = null;
    this.raf = null;
    this.pollTimer = null;
    this.hoverTimer = null;
    this.hovered = null;
  }

  async open() {
    document.body.classList.remove('in-memory');
    this.root.innerHTML = `
      <div class="garden">
        <div class="wall" data-role="wall"></div>
        <p class="garden-hint" data-role="hint">
          sweep across the marbles to hear them. <b>click one</b> to open it.
        </p>
        <aside class="readout" data-role="readout" aria-live="polite"></aside>
      </div>`;

    this.wallEl = this.root.querySelector('[data-role=wall]');
    this.readoutEl = this.root.querySelector('[data-role=readout]');
    this.hintEl = this.root.querySelector('[data-role=hint]');

    this.wall = await fetch('/api/wall').then((r) => r.json()).catch(() => []);
    this.draw();
    this.readout();
    this.pollTimer = setInterval(() => this.refresh(), 12000);

    // The bed is the sound of the wall as a whole; it is the only thing here
    // that loops. Everything else is a memory being visited.
    this.scape.setBed(this.wall.map((m) => m.emotion));
    this.scape.duck(1, 1.4);
    this.scape.fadeMaster(1, 2.2);

    // Anything opened or contributed while you were away is still ringing.
    this.session.drain((analysis, label) => {
      this.scape.contribute(analysis, { label, cycles: 2 });
      this.markSounding(label);
    });

    this.mascot = new Mascot({
      onYes: () => { location.hash = '#/add'; },
      onNo: () => this.toast('she will be in the corner if you change your mind'),
    });
    this.mascot.mount(this.root.querySelector('.garden'));
    this.mascot.arrive(this.wall.length ? 5200 : 2200,
      this.wall.length ? undefined : 'nothing here yet. want to be the first?');

    this.pulse();
  }

  // ------------------------------------------------------------ placement --

  /**
   * An i-spy page is dense: things touch, overlap and crowd. So the scatter is
   * sized to a *cell*, not stretched to fill the viewport -- with nine memories
   * the wall is a tight drift in the middle of the paper rather than nine
   * lonely marbles at the corners of an invisible grid. The cell is capped, so
   * as the garden fills up the drift grows outward and eventually does run
   * edge to edge, which is the point.
   */
  layout() {
    const n = this.wall.length;
    if (!n) return [];
    const box = this.wallEl.getBoundingClientRect();
    const W = box.width || 1200;
    const H = box.height || 640;

    const aspect = Math.max(0.35, W / Math.max(1, H));
    const rows = Math.max(1, Math.round(Math.sqrt(n / aspect)));

    // Spread the remainder across the top rows instead of leaving a stray
    // marble alone on a final row -- an even drift, not a grid with a widow.
    const base = Math.floor(n / rows);
    const extra = n % rows;
    const perRow = Array.from({ length: rows }, (_, r) => base + (r < extra ? 1 : 0));
    const widest = Math.max(...perRow);

    const CELL_MAX = W < 620 ? 132 : 200;
    const cell = Math.min(W / widest, H / rows, CELL_MAX) * 0.94;
    const padY = (H - cell * rows) / 2;

    // Bigger memories make bigger marbles. Size is the one thing on the wall
    // that is not decorative: it is how much was actually put in.
    const fragMax = Math.max(...this.wall.map((m) => m.fragments || 1), 1);

    // Walk the wall row by row so each row can be centred on its own count.
    const place = [];
    let i = 0;
    for (let row = 0; row < rows; row++) {
      const count = perRow[row];
      const padX = (W - cell * count) / 2;
      for (let col = 0; col < count; col++, i++) {
        const memory = this.wall[i];
        if (!memory) break;
        const rng = mulberry32(hashId(memory.id) ^ 0x5f3a);
        const jx = (rng() - 0.5) * 0.52;
        const jy = (rng() - 0.5) * 0.52;
        const weight = 0.62 + 0.38 * Math.sqrt((memory.fragments || 1) / fragMax);
        const px = padX + (col + 0.5 + jx) * cell;
        const py = padY + (row + 0.5 + jy) * cell;
        place.push({
          memory,
          size: Math.max(40, cell * 0.86 * weight),
          x: (Math.max(cell * 0.34, Math.min(W - cell * 0.34, px)) / W) * 100,
          y: (Math.max(cell * 0.34, Math.min(H - cell * 0.34, py)) / H) * 100,
        });
      }
    }
    return place;
  }

  draw() {
    if (!this.wall.length) {
      this.wallEl.innerHTML = `
        <div class="empty-garden">
          <h2>the garden is empty</h2>
          <p>somebody has to go first.</p>
        </div>`;
      this.hintEl.classList.add('gone');
      return;
    }
    this.hintEl.classList.remove('gone');

    const frag = document.createDocumentFragment();
    this.layout().forEach(({ memory, size, x, y }, i) => {
      frag.appendChild(this.marbleEl(memory, size, x, y, i));
    });
    this.wallEl.replaceChildren(frag);

    // Marbles lean fractionally toward the cursor, which is enough to make the
    // page feel like a surface with things resting on it.
    this.wallEl.onpointermove = (e) => {
      const r = this.wallEl.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width - 0.5).toFixed(3);
      const py = ((e.clientY - r.top) / r.height - 0.5).toFixed(3);
      this.wallEl.style.setProperty('--mx', px);
      this.wallEl.style.setProperty('--my', py);
    };
  }

  marbleEl(memory, size, x, y, i) {
    const t = marbleTraits(memory.id);
    const el = document.createElement('button');
    el.className = 'marble';
    el.dataset.id = memory.id;
    el.type = 'button';
    el.setAttribute('aria-label', `${memory.title} — ${Math.round(memory.decay * 100)}% faded. open it.`);
    el.style.cssText = `
      left:${x}%; top:${y}%;
      width:${size}px; height:${size}px;
      --marble:${memory.marble};
      --decay:${memory.decay};
      --vane:${t.vane}deg;
      --vane-w:${t.vaneWidth}%;
      --twist:${t.twist}deg;
      --hx:${t.highlightX}%;
      --hy:${t.highlightY}%;
      --bob-dur:${t.bobDur}ms;
      --bob-delay:${t.bobDelay}ms;
      --in-delay:${Math.min(900, i * 26)}ms;`;

    el.innerHTML = `
      <span class="marble-cast"></span>
      <span class="marble-body">
        <span class="marble-haze"></span>
        <span class="marble-glass"></span>
        <span class="marble-shine"></span>
      </span>
      <span class="marble-tag">${esc(memory.title)}<em>${describe(memory)}</em></span>`;

    el.addEventListener('pointerenter', () => this.hover(memory, el));
    el.addEventListener('focus', () => this.hover(memory, el));
    el.addEventListener('pointerleave', () => this.unhover(el));
    el.addEventListener('blur', () => this.unhover(el));
    el.addEventListener('click', () => {
      this.scape.stopPreview();
      location.hash = `#/orb/${memory.id}`;
    });
    return el;
  }

  // -------------------------------------------------------------- hearing --

  /**
   * Hovering plays the memory's own input back at you: a real window of its
   * recorded sound if it has any, and otherwise the chord its words were
   * mapped to. Either way you are hearing that specific memory, not a generic
   * hover noise.
   */
  hover(memory, el) {
    clearTimeout(this.hoverTimer);
    this.hovered = el;
    this.hintEl.classList.add('gone');
    this.hoverTimer = setTimeout(() => {
      el.classList.add('sounding');
      if (memory.preview) this.scape.previewClip(memory.preview.url, memory.preview.start, memory.preview.end);
      else this.scape.shimmer(memory.analysis || { chords: [['C4', 'E4', 'G4']], mood: 'neutral' });
      this.say(memory);
    }, HOVER_DWELL);
  }

  unhover(el) {
    clearTimeout(this.hoverTimer);
    el.classList.remove('sounding');
    if (this.hovered === el) this.hovered = null;
    this.scape.stopPreview();
  }

  say(memory) {
    const now = this.readoutEl.querySelector('[data-role=now]');
    if (!now) return;
    now.innerHTML = memory.preview
      ? `hearing <b>${esc(memory.title)}</b> — a real second of what was recorded`
      : `<b>${esc(memory.title)}</b> — no sound was left, so you get its chord`;
  }

  markSounding(label) {
    const el = [...this.wallEl.querySelectorAll('.marble')]
      .find((m) => m.querySelector('.marble-tag')?.textContent.startsWith(label));
    if (!el) return;
    el.classList.add('sounding');
    setTimeout(() => el.classList.remove('sounding'), 14000);
  }

  /** Ring the sounding marbles in time with what is actually audible. */
  pulse() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (!this.wallEl?.isConnected) return;
      const level = this.scape.level().toFixed(3);
      for (const el of this.wallEl.querySelectorAll('.marble.sounding')) {
        el.style.setProperty('--level', level);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  // ------------------------------------------------------- the live panel --

  async refresh() {
    const wall = await fetch('/api/wall').then((r) => r.json()).catch(() => null);
    if (!wall || !this.wallEl?.isConnected) return;
    const changed = wall.length !== this.wall.length
      || wall.some((m, i) => m.id !== this.wall[i]?.id || m.decay !== this.wall[i]?.decay);
    this.wall = wall;
    if (changed) {
      this.draw();
      this.scape.setBed(wall.map((m) => m.emotion));
    }
    this.readout();
  }

  async readout() {
    const s = await fetch('/api/stats').then((r) => r.json()).catch(() => null);
    if (!s || !this.readoutEl?.isConnected) return;
    const total = Math.max(1, s.memories);
    const order = ['nostalgia', 'joy', 'peace', 'sadness', 'neutral'].filter((e) => s.emotions[e]);

    this.readoutEl.innerHTML = `
      <h3>the garden right now <span class="tick">live</span></h3>
      <div class="readout-figures">
        <span class="figure"><b>${s.memories}</b><span>memories</span></span>
        <span class="figure"><b>${s.openings}</b><span>openings</span></span>
        <span class="figure"><b>${Math.round(s.faded * 100)}%</b><span>faded</span></span>
      </div>
      <div class="moodbar">
        ${order.map((e) => `<i style="width:${(s.emotions[e] / total) * 100}%;background:hsl(${EMOTION_HUE[e]} 62% 58%)"></i>`).join('')}
      </div>
      <div class="moodkeys">
        ${order.map((e) => `<span><i style="background:hsl(${EMOTION_HUE[e]} 62% 58%)"></i>${e} ${s.emotions[e]}</span>`).join('')}
      </div>
      <div class="readout-now" data-role="now">${s.fragments} fragments in the wall, and falling</div>`;
  }

  close() {
    clearInterval(this.pollTimer);
    clearTimeout(this.hoverTimer);
    cancelAnimationFrame(this.raf);
    this.scape.stopPreview();
    this.mascot?.destroy();
  }

  toast(msg) { window.__toast?.(msg); }
}

function describe(m) {
  const bits = [];
  if (m.counts.image) bits.push(`${m.counts.image} image${m.counts.image > 1 ? 's' : ''}`);
  if (m.counts.video) bits.push('a clip');
  if (m.counts.audio) bits.push('a recording');
  if (m.counts.text) bits.push('words');
  return `${bits.join(' · ') || 'empty'} — ${Math.round(m.decay * 100)}% faded`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
