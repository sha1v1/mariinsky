// Router and shell.
//
// The collection is never torn down. Both of the things you can do to it --
// opening a memory, and leaving one -- mount *over* it in the same overlay,
// which is why the page behind can frost rather than disappear, and why closing
// either costs nothing: there is nothing to rebuild.

import { Audioscape } from './audioscape.js';
import { OrbAudio } from './orbaudio.js';
import { Garden } from './garden.js';

/**
 * Only the collection is needed to open the page. The two things you can do
 * *to* it -- open a memory, leave one -- are fetched when you actually go
 * there. That halves what has to arrive intact before anything is on screen,
 * so a request dropped on the way to the laboratory costs the laboratory
 * rather than the wall.
 */
const VIEWS = {
  orb: () => import('./orbview.js').then((m) => m.OrbView),
  lab: () => import('./lab.js').then((m) => m.LabView),
  add: () => import('./contribute.js').then((m) => m.Contribute),
};

async function view(name) {
  try {
    return await VIEWS[name]();
  } catch {
    // A module that fails to fetch stays failed for the life of the document --
    // the browser remembers the failure and will not go back for it -- so there
    // is nothing to retry against here. Only a fresh document will do.
    window.__toast?.('that part of the page did not arrive. fetching it again…');
    setTimeout(() => window.__recover?.('a piece of the page did not arrive.'), 1200);
    return null;
  }
}

const root = document.getElementById('app');
const overlay = document.getElementById('overlay');
const scape = new Audioscape();     // the collection, collaborative and looping
const orbAudio = new OrbAudio();    // one memory's own decayed sound

/**
 * Memories opened or contributed elsewhere, waiting to be heard once there is a
 * collection to hear them in. This is how "a memory joins the audioscape when
 * it is viewed or created" works across screens.
 */
const session = {
  pending: [],
  queue(analysis, label) {
    if (!analysis) return;
    this.pending.push({ analysis, label });
    if (this.pending.length > 4) this.pending.shift();
  },
  drain(play) {
    const batch = this.pending.splice(0);
    batch.forEach((item, i) => setTimeout(() => play(item.analysis, item.label), i * 2600 + 900));
  },
};

let garden = null;
let orb = null;
let adding = null;

function shell() {
  document.body.insertAdjacentHTML('afterbegin', `
    <div class="paper"></div>
    <div class="frame" aria-hidden="true"></div>
    <header class="masthead">
      <div class="top-actions">
        <button class="btn" data-act="sound" aria-pressed="false" aria-label="toggle sound" title="sound">
          <span class="sound-pip"></span><span data-role="soundlabel">sound</span>
        </button>
        <a class="btn btn-solid" href="#/add">add a memory</a>
      </div>
    </header>`);
  document.body.insertAdjacentHTML('beforeend', '<div class="toast" data-role="toast" role="status"></div>');

  const soundBtn = document.querySelector('[data-act=sound]');
  const soundLabel = soundBtn.querySelector('[data-role=soundlabel]');

  const reflect = () => {
    const on = scape.running && !scape.muted;
    soundBtn.classList.toggle('sound-on', on);
    soundBtn.setAttribute('aria-pressed', String(on));
    soundLabel.textContent = on ? 'sound on' : scape.running ? 'sound off' : 'turn on sound';
  };

  soundBtn.addEventListener('click', async () => {
    await scape.ensure();
    scape.setMuted(scape.running ? !scape.muted : false);
    if (!scape.muted) scape.fadeMaster(1, 1.2);
    reflect();
  });

  // Browsers will not start audio without a gesture. The first one anywhere
  // wakes the collection up, so nobody has to hunt for a play button.
  const wake = async () => {
    await scape.ensure();
    await orbAudio.ensure();
    if (scape.running) {
      if (!scape.muted) scape.fadeMaster(1, 2);
      reflect();
      document.removeEventListener('pointerdown', wake);
      document.removeEventListener('keydown', wake);
    }
  };
  document.addEventListener('pointerdown', wake, { passive: true });
  document.addEventListener('keydown', wake);

  // The audioscape can also be muted or suspended from outside this button --
  // by a memory ducking it, or by the browser suspending the context on a
  // background tab -- so the label is re-checked rather than only written to.
  setInterval(reflect, 1500);

  // Closing the tab is the most common way to leave a sequence mid-run, and it
  // is the one route that never fires `hashchange`.
  window.addEventListener('pagehide', () => { try { orb?.flush(); } catch {} });

  let toastTimer;
  const toastEl = document.querySelector('[data-role=toast]');
  window.__toast = (msg) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3600);
  };
}

async function ensureGarden() {
  if (garden) return garden;
  garden = new Garden(root, scape, session);
  await garden.open();
  return garden;
}

/** Both overlays leave the same way, so they are taken down the same way. */
function closeOverlay() {
  if (orb) { orb.close(); orb = null; }
  if (adding) { adding.close(); adding = null; }
  overlay.innerHTML = '';
  overlay.classList.remove('on');
  // The masthead belongs to the collection. Inside a memory, and inside the
  // contribution card, the overlay owns the screen and a second set of controls
  // would just be noise -- so it is taken away rather than frosted over.
  document.body.classList.remove('overlay-on');
  document.body.classList.remove('immersive');
  garden?.frost(false);
  orbAudio.stop(0.5);
  scape.duck(1, 1.4);
}

async function route() {
  const hash = location.hash || '#/';

  // A memory and its laboratory are the same view with different chrome, and
  // both take the whole screen: the collection is not torn down behind them,
  // only covered, so stepping between orb and bench and back out again costs
  // nothing but the fetch.
  if (hash.startsWith('#/orb/') || hash.startsWith('#/lab/')) {
    const bench = hash.startsWith('#/lab/');
    // Fetched before anything is torn down, so a view that never arrives leaves
    // the collection exactly as it was.
    const View = await view(bench ? 'lab' : 'orb');
    if (!View) return;
    await ensureGarden();
    closeOverlay();
    overlay.classList.add('on');
    document.body.classList.add('overlay-on');
    garden.frost(true);
    // The printed border belongs to the page, and a memory is not on the page
    // any more -- it is the whole screen. Contributing keeps its frame: it is
    // the collection's own light, laid over the collection.
    document.body.classList.add('immersive');
    orb = new View(overlay, orbAudio, scape, session);
    try {
      await orb.open(hash.slice(6));
    } catch {
      closeOverlay();
      window.__toast?.('that memory is not here any more');
      location.hash = '#/';
    }
    return;
  }

  if (hash === '#/add') {
    const Contribute = await view('add');
    if (!Contribute) return;
    await ensureGarden();
    closeOverlay();
    overlay.classList.add('on');
    document.body.classList.add('overlay-on');
    garden.frost(true);
    adding = new Contribute(overlay, scape, session, {
      onLanded: (id) => garden?.land(id),
    });
    adding.open();
    return;
  }

  closeOverlay();
  await ensureGarden();
}

shell();
// The graph arrived and evaluated. Whatever the routing does next, the page is
// no longer at risk of sitting on "…" for ever, so the boot watchdog stands
// down and the reload counter is cleared.
window.__booted?.();
window.addEventListener('hashchange', route);
route();
