// The collection: every memory scattered across the page.
//
// This is an i-spy spread, so the rules are the spread's rules. Nothing
// overlaps anything, nothing is labelled, nothing casts a shadow onto the
// paper, and objects run to all four edges. When there are more memories than
// fit on a screen the page simply gets bigger and you drag it around, the way
// you would turn a book to see the bottom corner.

import { mulberry32 } from './rng.js';
import { marbleTraits, hashId } from './marble.js';
import { swirlSvg } from './swirl.js';
import { Mascot } from './mascot.js';
import { trinketFor, trinketEl } from './trinkets.js';

const HOVER_DWELL = 170;   // ms before a marble starts sounding

export class Garden {
  constructor(root, scape, session) {
    this.root = root;
    this.scape = scape;
    this.session = session;
    this.wall = [];
    this.mascot = null;
    this.pollTimer = null;
    this.hoverTimer = null;
    this.held = null;
    this.pan = { x: 0, y: 0 };
    this.bounds = { w: 0, h: 0 };
  }

  async open() {
    this.root.innerHTML = `
      <div class="collection" data-role="stage">
        <div class="page" data-role="page">
          <div class="clutter" data-role="clutter" aria-hidden="true"></div>
          <div class="wall" data-role="wall"></div>
          ${Mascot.markup()}
        </div>
      </div>`;

    this.stage = this.root.querySelector('[data-role=stage]');
    this.page = this.root.querySelector('[data-role=page]');
    this.wallEl = this.root.querySelector('[data-role=wall]');
    this.clutterEl = this.root.querySelector('[data-role=clutter]');

    this.wall = await fetch('/api/wall').then((r) => r.json()).catch(() => []);
    this.draw();
    this.pollTimer = setInterval(() => this.refresh(), 15000);

    this.scape.setBed(this.wall.map((m) => m.emotion));
    this.scape.duck(1, 1.4);
    this.scape.fadeMaster(1, 2.2);

    // Anything opened or contributed while you were away is still ringing.
    this.session.drain((analysis, label) => this.scape.contribute(analysis, { label, cycles: 2 }));

    this.mascot = new Mascot({ onAsk: () => { location.hash = '#/add'; } });
    this.mascot.mount(this.root);

    this.dragging();
    this.onResize = () => this.draw();
    window.addEventListener('resize', this.onResize);
  }

  // ------------------------------------------------------------ the spread --

  /**
   * A fixed-size cell grid, one object per cell, jittered inside its cell by
   * less than the slack around it -- which is what guarantees no two objects
   * ever touch. Cells that fall under the title are struck out before anything
   * is placed, so the words are never crowded and never covered.
   *
   * Every cell a memory did not take gets a trinket, so the page is full at any
   * wall size. That is not decoration for its own sake: a hunt needs something
   * to hunt through, and eleven marbles alone on white paper is not a page out
   * of an i-spy book, it is a dashboard.
   *
   * The page grows downward to fit; it never shrinks the marbles to cram them
   * in, because an i-spy page is a fixed scale you move around, not a diagram
   * that reflows.
   */
  layout() {
    const n = this.wall.length;
    const vw = this.stage.clientWidth || 1200;
    const vh = this.stage.clientHeight || 800;
    const narrow = vw < 620;

    const target = narrow ? 98 : 132;
    const cols = Math.max(2, Math.round(vw / target));
    const cell = vw / cols;

    // Mariinsky and the title, in page coordinates, kept clear of everything
    // else. These track the `.hero` box in the stylesheet; if she is resized
    // there, they have to move with her or objects land on her.
    const heroW = narrow ? vw : Math.min(820, vw * 0.96);
    const heroH = narrow ? vw * 0.78 : 320;

    // Grow rows until enough cells survive the hero cut-out. Start from a full
    // screen so the spread always reaches every edge.
    let rows = Math.max(Math.ceil(vh / cell), 1);
    let cells = [];
    for (let guard = 0; guard < 60; guard++) {
      const H = rows * cell;
      const hx0 = (vw - heroW) / 2, hx1 = hx0 + heroW;
      const hy0 = (H - heroH) / 2, hy1 = hy0 + heroH;
      cells = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x0 = c * cell, y0 = r * cell;
          const clash = x0 < hx1 && x0 + cell > hx0 && y0 < hy1 && y0 + cell > hy0;
          if (!clash) cells.push({ c, r });
        }
      }
      if (cells.length >= n) break;
      rows++;
    }

    // Order the cells so that any prefix is spread over the whole page instead
    // of filling the top-left first. Golden-ratio scrambling keeps earlier
    // memories where they were as later ones are appended.
    const PHI = 0.6180339887498949;
    cells = cells
      .map((cellRef, i) => ({ cellRef, k: (i * PHI) % 1 }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.cellRef);

    const fragMax = Math.max(...this.wall.map((m) => m.fragments || 1), 1);
    // Oldest first, so a new memory takes the next free cell rather than
    // shunting everybody else along.
    const ordered = this.wall.slice().sort((a, b) => a.createdAt - b.createdAt);

    const place = ordered.map((memory, i) => {
      const spot = cells[i % Math.max(1, cells.length)];
      const rng = mulberry32(hashId(memory.id) ^ 0x5f3a);
      const weight = Math.sqrt((memory.fragments || 1) / fragMax);
      const size = cell * (0.40 + 0.22 * weight);
      // slack is whatever the cell has left over once this marble is in it
      const slack = Math.max(0, (cell - size) / 2 - 2);
      return {
        memory,
        size,
        x: spot.c * cell + cell / 2 + (rng() - 0.5) * 2 * slack,
        y: spot.r * cell + cell / 2 + (rng() - 0.5) * 2 * slack,
      };
    });

    // Whatever the memories left over. Same jitter rule, so a trinket is no
    // more able to touch its neighbour than a marble is.
    const clutter = cells.slice(n).map((spot) => {
      const t = trinketFor(spot.c, spot.r);
      const size = cell * 0.52 * t.scale;
      const slack = Math.max(0, (cell - size) / 2 - 2);
      return {
        t,
        size,
        x: spot.c * cell + cell / 2 + (t.jx - 0.5) * 2 * slack,
        y: spot.r * cell + cell / 2 + (t.jy - 0.5) * 2 * slack,
      };
    });

    return { place, clutter, W: vw, H: rows * cell, heroH };
  }

  draw() {
    const { place, clutter, W, H } = this.layout();
    this.bounds = { w: W, h: H };
    this.page.style.width = `${W}px`;
    this.page.style.height = `${H}px`;

    const junk = document.createDocumentFragment();
    clutter.forEach(({ t, size, x, y }) => junk.appendChild(trinketEl(t, size, x, y)));
    this.clutterEl.replaceChildren(junk);

    const frag = document.createDocumentFragment();
    place.forEach(({ memory, size, x, y }, i) => frag.appendChild(this.marbleEl(memory, size, x, y, i)));
    this.wallEl.replaceChildren(frag);

    // Open centred on the title, wherever it has ended up on the page. A pan
    // the visitor set by hand is theirs to keep -- redrawing under them because
    // somebody else opened a memory would yank the page out of their hands.
    if (!this.panned) {
      this.pan = {
        x: (this.stage.clientWidth - W) / 2,
        y: (this.stage.clientHeight - H) / 2,
      };
    }
    this.clampPan();
    this.applyPan();
    this.stage.classList.toggle('pannable', H > this.stage.clientHeight + 4 || W > this.stage.clientWidth + 4);
    if (this.landing) this.runLanding();
  }

  /**
   * A memory that was just left arrives from where the visitor was looking when
   * they left it -- the middle of the screen, where the card was -- and settles
   * into its slot. The point is that you see *where it went*: on a page this
   * full, a marble that simply appeared would be indistinguishable from one
   * that had always been there.
   */
  runLanding() {
    const el = this.wallEl.querySelector(`[data-id="${cssEsc(this.landing)}"]`);
    this.landing = null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const dx = this.stage.clientWidth / 2 - (r.left + r.width / 2);
    const dy = this.stage.clientHeight / 2 - (r.top + r.height / 2);
    const from = Math.max(2.4, Math.min(9, 190 / r.width));   // roughly card-sized

    el.classList.add('landed');
    // No need to cancel `settle`: an animation created through the Web
    // Animations API outranks a CSS animation on the same property.
    el.animate(
      [
        { transform: `translate(-50%,-50%) translate(${dx}px, ${dy}px) scale(${from})`, opacity: 0 },
        { transform: `translate(-50%,-50%) translate(${dx * 0.12}px, ${dy * 0.12}px) scale(1.22)`, opacity: 1, offset: 0.72 },
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      ],
      { duration: 1150, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' },
    ).finished.then(() => el.classList.remove('landed')).catch(() => {});
  }

  /** Called by the router the moment a contribution is accepted. */
  async land(id) {
    this.landing = id;
    await this.refresh();
    // A wall that had not changed yet skips the redraw, so poll it in.
    if (this.landing) setTimeout(() => this.refresh(), 500);
  }

  marbleEl(memory, size, x, y, i) {
    const t = marbleTraits(memory.id);
    const el = document.createElement('button');
    el.className = 'marble';
    el.dataset.id = memory.id;
    el.type = 'button';
    el.setAttribute('aria-label', `${memory.title} — open it`);
    el.style.cssText = `
      left:${x}px; top:${y}px;
      width:${size}px; height:${size}px;
      --marble:${memory.marble};
      --decay:${memory.decay};
      --twist:${t.twist}deg;
      --hx:${t.highlightX}%;
      --hy:${t.highlightY}%;
      --bob-dur:${t.bobDur}ms;
      --bob-delay:${t.bobDelay}ms;
      --in-delay:${Math.min(800, i * 22)}ms;`;

    // The title wraps itself around the glass instead of sitting in a card
    // beside it — an i-spy page has no captions.
    const ring = `
      <svg class="marble-ring" viewBox="0 0 100 100" aria-hidden="true">
        <defs><path id="r${memory.id}" d="M50,50 m-41,0 a41,41 0 1,1 82,0 a41,41 0 1,1 -82,0"/></defs>
        <text><textPath href="#r${memory.id}" startOffset="0%">${esc(memory.title).slice(0, 84)}</textPath></text>
      </svg>`;

    el.innerHTML = `
      <span class="marble-body">
        ${swirlSvg(memory.id)}
        <span class="marble-glass"></span>
        <span class="marble-haze"></span>
        <span class="marble-shine"></span>
      </span>
      ${ring}`;

    el.addEventListener('pointerenter', () => this.hover(memory, el));
    el.addEventListener('focus', () => this.hover(memory, el));
    el.addEventListener('pointerleave', () => this.unhover(el));
    el.addEventListener('blur', () => this.unhover(el));
    el.addEventListener('click', (e) => {
      if (this.moved) return;                 // a drag should not open anything
      e.preventDefault();
      this.release();
      // hand the marble's on-screen position to the orb so it can grow from it
      window.__fromRect = el.getBoundingClientRect();
      location.hash = `#/orb/${memory.id}`;
    });
    return el;
  }

  // -------------------------------------------------------------- hearing --

  /**
   * A memory sounds for exactly as long as you are on it, and stops when you
   * leave. Sweeping slowly across the page is how you play the collection.
   */
  hover(memory, el) {
    clearTimeout(this.hoverTimer);
    if (this.hoveredEl === el) return;
    this.release();
    this.hoveredEl = el;
    this.hoverTimer = setTimeout(async () => {
      el.classList.add('sounding');
      const handle = await this.scape.hold(memory);
      if (this.hoveredEl === el) this.held = handle;
      else handle.release();
    }, HOVER_DWELL);
  }

  unhover(el) {
    clearTimeout(this.hoverTimer);
    el.classList.remove('sounding');
    if (this.hoveredEl === el) { this.hoveredEl = null; this.release(); }
  }

  release() {
    this.held?.release();
    this.held = null;
  }

  // -------------------------------------------------------------- panning --

  dragging() {
    let start = null;
    this.moved = false;

    this.stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y };
      this.moved = false;
      this.stage.classList.add('grabbing');
    });
    window.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) { this.moved = true; this.panned = true; }
      this.pan = { x: start.px + dx, y: start.py + dy };
      this.clampPan();
      this.applyPan();
    });
    window.addEventListener('pointerup', () => {
      start = null;
      this.stage.classList.remove('grabbing');
      // let the click handler see `moved`, then forget it
      setTimeout(() => { this.moved = false; }, 0);
    });

    this.stage.addEventListener('wheel', (e) => {
      if (!this.stage.classList.contains('pannable')) return;
      e.preventDefault();
      this.panned = true;
      this.pan.x -= e.deltaX;
      this.pan.y -= e.deltaY;
      this.clampPan();
      this.applyPan();
    }, { passive: false });
  }

  clampPan() {
    const vw = this.stage.clientWidth;
    const vh = this.stage.clientHeight;
    const { w, h } = this.bounds;
    this.pan.x = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, this.pan.x));
    this.pan.y = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, this.pan.y));
  }

  applyPan() {
    this.page.style.transform = `translate3d(${Math.round(this.pan.x)}px, ${Math.round(this.pan.y)}px, 0)`;
  }

  // ---------------------------------------------------------------- upkeep --

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
  }

  /** Called when a memory is opened over the top of the collection. */
  frost(on) {
    this.stage?.classList.toggle('frosted', !!on);
    if (on) this.release();
  }

  close() {
    clearInterval(this.pollTimer);
    clearTimeout(this.hoverTimer);
    this.release();
    window.removeEventListener('resize', this.onResize);
    this.mascot?.destroy();
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const cssEsc = (s) => String(s).replace(/["\\]/g, '\\$&');
