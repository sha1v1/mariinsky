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
import { loadItems, assignItems, fitRotated, itemSrc } from './items.js';

const HOVER_DWELL = 170;   // ms before a marble starts sounding

// Mariinsky's portrait, at her natural proportions. The layout has to know how
// tall she is to keep the page off her, and asking the DOM is circular -- the
// image is laid out by the same pass that is trying to measure it -- so the one
// number that cannot be derived is written down here and the stylesheet is told
// her width rather than choosing it.
const HERO_ASPECT = 1706 / 1222;   // the clip's own frame; mirrored in .hero-image
const HERO_MAX = 480;      // px. she used to be 820 and swallowed the middle of the page
const HERO_SHARE = 0.46;   // ...or this much of the window, whichever is less
const HERO_SHARE_NARROW = 0.56;   // a phone has less paper to spare her
const NARROW_PX = 720;     // must match the stylesheet's breakpoint: below it her
                           // thoughts sit above her rather than beside her
const HERO_PAD = 14;       // clear paper kept around her on every side

const GAP = 6;             // px of guaranteed air between any two objects

// A cell is chosen to suit how many memories there are (see `layout`). These
// are the ends of that range: below CELL_MIN the page grows and pans instead,
// above CELL_MAX a nearly-empty wall would be a handful of billboards.
const CELL_MIN = 104;
const CELL_MAX = 260;

// Every object is turned and sized at random within a range, seeded by its own
// id. Both ranges are deliberately modest: past about a third of a turn a
// photographed object stops reading as *lying there* and starts reading as
// broken, and a size range any wider than this makes the small ones look like
// dirt on the page rather than things to find.
const MAX_TURN = 34;       // degrees, either way
const SIZE_MIN = 0.58;     // of the cell's usable square
const SIZE_MAX = 1.00;

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
          <div class="wall" data-role="wall"></div>
          ${Mascot.markup()}
        </div>
      </div>`;

    this.stage = this.root.querySelector('[data-role=stage]');
    this.page = this.root.querySelector('[data-role=page]');
    this.wallEl = this.root.querySelector('[data-role=wall]');

    // The object library has to be in hand before the first draw: what a memory
    // is a picture of decides how big its box is, and the boxes are the layout.
    await loadItems();

    this.wall = await fetch('/api/wall').then((r) => r.json()).catch(() => []);
    this.draw();
    this.pollTimer = setInterval(() => this.refresh(), 15000);

    this.scape.setBed();
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
   * A cell grid, one object per cell, jittered inside its cell by less than the
   * slack around it -- which is what guarantees no two objects ever touch. Cells
   * that fall under Mariinsky are struck out before anything is placed, so she
   * is never crowded and never covered.
   *
   * Every object on the page is a memory. There used to be inert filler in the
   * cells the memories did not take, to keep the spread dense; it is gone,
   * because a page where half the things do not answer teaches you to stop
   * touching things. Density now comes from the grid instead: it is sized to
   * the wall, so a small wall is a few large objects rather than a few small
   * ones adrift in white.
   *
   * The grid is sized to the *window* first: rows and columns are chosen so a
   * wall that fits lands inside one screen exactly, margins included, and
   * nothing is ever cropped by the printed border. Only when there are more
   * memories than the screen has cells does the page grow past the window and
   * become something you drag -- panning is what you do when there is too much
   * to fit, not the resting state of a page with eleven things on it.
   */
  layout() {
    const n = Math.max(1, this.wall.length);
    const vw = this.stage.clientWidth || 1200;
    const vh = this.stage.clientHeight || 800;

    // Keep the grid inside the printed border. `.frame` is inset by
    // clamp(10px, 1.6vmin, 22px) and is 3px thick, and its matte crops whatever
    // is underneath, so anything laid out in that band is a half-object.
    const inset = Math.max(10, Math.min(22, Math.min(vw, vh) * 0.016)) + 3;
    const m = inset + 6;
    const gw = Math.max(1, vw - m * 2);
    const gh = Math.max(1, vh - m * 2);

    // Mariinsky, in page coordinates. The stylesheet is handed this width so
    // the two can never drift apart -- the old pair of hand-kept numbers said
    // she was 320 tall while she was really rendering at 564, which is exactly
    // how objects ended up lying across her.
    const heroW = Math.min(HERO_MAX, vw * (vw <= NARROW_PX ? HERO_SHARE_NARROW : HERO_SHARE));
    const heroH = heroW / HERO_ASPECT;
    this.hero = { w: heroW, h: heroH };

    /** How many cells survive the hole cut for her, at a given grid. */
    const usable = (cols, rows, cellW, cellH) => {
      const H = m * 2 + rows * cellH;
      const hx0 = (vw - heroW) / 2 - HERO_PAD, hx1 = hx0 + heroW + HERO_PAD * 2;
      const hy0 = (H - heroH) / 2 - HERO_PAD, hy1 = hy0 + heroH + HERO_PAD * 2;
      const out = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x0 = m + c * cellW, y0 = m + r * cellH;
          const clash = x0 < hx1 && x0 + cellW > hx0 && y0 < hy1 && y0 + cellH > hy0;
          if (!clash) out.push({ c, r });
        }
      }
      return out;
    };

    // The grid is chosen for the number of memories, not for a fixed object
    // size. Now that nothing on the page is filler, a wall of eleven laid out on
    // a grid built for forty is eleven things adrift in white -- so the coarsest
    // grid that still holds them all wins, and the objects get correspondingly
    // bigger. As the wall fills, cells shrink back toward CELL_MIN; past that
    // the page grows taller than the window and you drag it.
    let cols = Math.max(2, Math.floor(gw / CELL_MIN));
    let cellW = gw / cols;
    let rows = Math.max(1, Math.round(gh / cellW));
    let cellH = gh / rows;
    for (let c = 2; c <= Math.max(2, Math.floor(gw / CELL_MIN)); c++) {
      const w = gw / c;
      if (w > CELL_MAX) continue;
      const r = Math.max(1, Math.round(gh / w));
      if (usable(c, r, w, gh / r).length >= n) { cols = c; cellW = w; rows = r; cellH = gh / r; break; }
    }

    // Still not enough at the tightest grid: the page grows downward. It never
    // shrinks the objects further to cram them in, because an i-spy page is a
    // fixed scale you move around, not a diagram that reflows.
    let cells = usable(cols, rows, cellW, cellH);
    for (let guard = 0; guard < 400 && cells.length < n; guard++) {
      rows++;
      cells = usable(cols, rows, cellW, cellH);
    }

    // Order the cells so that any prefix is spread over the whole page instead
    // of filling the top-left first. Golden-ratio scrambling keeps earlier
    // memories where they were as later ones are appended.
    const PHI = 0.6180339887498949;
    cells = cells
      .map((cellRef, i) => ({ cellRef, k: (i * PHI) % 1 }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.cellRef);

    // The largest square that can sit in a cell and still leave air around it.
    const avail = Math.max(8, Math.min(cellW, cellH) - GAP);

    // Oldest first, so a new memory takes the next free cell rather than
    // shunting everybody else along.
    const ordered = this.wall.slice().sort((a, b) => a.createdAt - b.createdAt);

    // Size, angle and jitter are drawn from the memory's own id, so they are
    // random-looking but identical on every load and to every visitor -- the
    // same promise the marble colours make. Size is deliberately *not* tied to
    // anything about the memory: an i-spy page is a jumble of things that
    // happen to be different sizes, and a page where size meant something would
    // be a chart.
    const spots = [];
    const rngs = [];
    const boxes = [];
    ordered.forEach((memory, i) => {
      const spot = cells[i % Math.max(1, cells.length)];
      const rng = mulberry32(hashId(memory.id) ^ 0x5f3a);
      const box = avail * (SIZE_MIN + rng() * (SIZE_MAX - SIZE_MIN));
      const jx = rng(), jy = rng();
      rngs.push(rng);
      boxes.push(box);
      spots.push({
        x: m + spot.c * cellW + cellW / 2 + (jx - 0.5) * 2 * Math.max(0, (cellW - box) / 2 - 1),
        y: m + spot.r * cellH + cellH / 2 + (jy - 0.5) * 2 * Math.max(0, (cellH - box) / 2 - 1),
      });
    });

    // One pass, with the positions already known, so "do not put two of these
    // next to each other" is a question the assignment can actually answer.
    const items = assignItems(ordered, spots);

    const place = ordered.map((memory, i) => ({
      memory,
      item: items[i],
      box: boxes[i],
      turn: items[i] ? (rngs[i]() - 0.5) * 2 * MAX_TURN : 0,
      ...spots[i],
    }));

    return { place, W: vw, H: m * 2 + rows * cellH };
  }

  draw() {
    const { place, W, H } = this.layout();
    this.bounds = { w: W, h: H };
    this.page.style.width = `${W}px`;
    this.page.style.height = `${H}px`;
    this.page.style.setProperty('--hero-w', `${this.hero.w}px`);
    this.page.style.setProperty('--hero-h', `${this.hero.h}px`);

    const frag = document.createDocumentFragment();
    place.forEach((p, i) => frag.appendChild(this.marbleEl(p, i)));
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

  /**
   * One memory on the page. It is whichever object its own words matched, and a
   * marble when the library had nothing close -- which is not a failure state:
   * the marble is what a memory looks like before it has told you enough to be
   * a picture of anything.
   *
   * Either way the box is square and behaves identically. Everything that makes
   * a memory a memory rather than junk -- the pointer, the focus ring, the
   * sound, the title that wraps around it -- lives out here, on the button.
   */
  marbleEl({ memory, item, turn, box, x, y }, i) {
    const t = marbleTraits(memory.id);
    const el = document.createElement('button');
    el.className = item ? 'marble is-object' : 'marble';
    el.dataset.id = memory.id;
    el.type = 'button';
    el.setAttribute('aria-label', `${memory.title} — open it`);
    el.style.cssText = `
      left:${x}px; top:${y}px;
      width:${box}px; height:${box}px;
      --marble:${memory.marble};
      --decay:${memory.decay};
      --twist:${t.twist}deg;
      --hx:${t.highlightX}%;
      --hy:${t.highlightY}%;
      --bob-dur:${t.bobDur}ms;
      --bob-delay:${t.bobDelay}ms;
      --in-delay:${Math.min(800, i * 22)}ms;`;

    // The title wraps itself around the object instead of sitting in a card
    // beside it — an i-spy page has no captions.
    const ring = `
      <svg class="marble-ring" viewBox="0 0 100 100" aria-hidden="true">
        <defs><path id="r${memory.id}" d="M50,50 m-41,0 a41,41 0 1,1 82,0 a41,41 0 1,1 -82,0"/></defs>
        <text><textPath href="#r${memory.id}" startOffset="0%">${esc(memory.title).slice(0, 84)}</textPath></text>
      </svg>`;

    const body = item
      ? (() => {
          const fit = fitRotated(item, box, turn);
          return `<img class="marble-object" src="${itemSrc(item)}" alt="" draggable="false" decoding="async"
                    style="width:${fit.w.toFixed(1)}px;height:${fit.h.toFixed(1)}px;--turn:${turn.toFixed(1)}deg">`;
        })()
      : `<span class="marble-body">
           ${swirlSvg(memory.id)}
           <span class="marble-glass"></span>
           <span class="marble-haze"></span>
           <span class="marble-shine"></span>
         </span>`;

    el.innerHTML = `${body}${ring}`;

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
    // The bed is fixed, so a changed wall only redraws -- it no longer retunes
    // the room underneath.
    if (changed) this.draw();
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
