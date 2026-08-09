<<<<<<< HEAD
// Router and shell.
//
// The collection is never torn down. Both of the things you can do to it --
// opening a memory, and leaving one -- mount *over* it in the same overlay,
// which is why the page behind can frost rather than disappear, and why closing
// either costs nothing: there is nothing to rebuild.
=======
// Router and shell. Three places you can be: the garden, adding to it, or
// inside one memory. The audioscape outlives all three -- it is created once
// and never torn down, which is what makes the sound feel like a property of
// the place rather than of the page you happen to be on.
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8

import { Audioscape } from './audioscape.js';
import { OrbAudio } from './orbaudio.js';
import { Garden } from './garden.js';
import { Contribute } from './contribute.js';
import { OrbView } from './orbview.js';

const root = document.getElementById('app');
<<<<<<< HEAD
const overlay = document.getElementById('overlay');
const scape = new Audioscape();     // the collection, collaborative and looping
const orbAudio = new OrbAudio();    // one memory's own decayed sound

/**
 * Memories opened or contributed elsewhere, waiting to be heard once there is a
 * collection to hear them in. This is how "a memory joins the audioscape when
 * it is viewed or created" works across screens.
=======
const scape = new Audioscape();     // the garden, collaborative and looping
const orbAudio = new OrbAudio();    // one memory's own decayed sound

/**
 * Memories opened or contributed on another screen, waiting to be heard when
 * you are back in the garden. This is the mechanism behind "a memory joins the
 * audioscape when it is viewed or created" -- the joining is deferred to the
 * moment there is a garden to join.
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
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

<<<<<<< HEAD
let garden = null;
let orb = null;
let adding = null;

function shell() {
  document.body.insertAdjacentHTML('afterbegin', '<div class="paper"></div><div class="frame" aria-hidden="true"></div>');
  document.body.insertAdjacentHTML('beforeend', '<div class="toast" data-role="toast" role="status"></div>');

  // Browsers will not start audio without a gesture. The first one anywhere
  // wakes the collection up, so nobody has to hunt for a play button.
=======
let current = null;

// ------------------------------------------------------------------ shell ---

function shell() {
  document.body.insertAdjacentHTML('afterbegin', `
    <div class="paper"></div>
    <header class="masthead">
      <a class="wordmark" href="#/" aria-label="mariisnky, home">
        <h1>mar<span class="dot-a">i</span><span class="dot-b">i</span>snky</h1>
        <p>i-spy memory garden</p>
      </a>
      <div class="top-actions">
        <button class="btn" data-act="sound" aria-pressed="false" aria-label="toggle sound" title="sound">
          <span class="sound-pip"></span><span data-role="soundlabel">sound</span>
        </button>
        <a class="btn btn-solid" href="#/add">add a memory</a>
      </div>
    </header>
    <div class="toast" data-role="toast" role="status"></div>`);

  const soundBtn = document.querySelector('[data-act=sound]');
  const label = soundBtn.querySelector('[data-role=soundlabel]');

  const reflect = () => {
    const on = scape.running && !scape.muted;
    soundBtn.classList.toggle('sound-on', on);
    soundBtn.setAttribute('aria-pressed', String(on));
    label.textContent = on ? 'sound on' : scape.running ? 'sound off' : 'turn on sound';
  };

  soundBtn.addEventListener('click', async () => {
    await scape.ensure();
    scape.setMuted(scape.running ? !scape.muted : false);
    if (!scape.muted) scape.fadeMaster(1, 1.2);
    reflect();
  });

  // Browsers will not start audio without a gesture. The first one anywhere on
  // the page wakes the garden up, so nobody has to find a play button.
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
  const wake = async () => {
    await scape.ensure();
    await orbAudio.ensure();
    if (scape.running) {
      if (!scape.muted) scape.fadeMaster(1, 2);
<<<<<<< HEAD
=======
      reflect();
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
      document.removeEventListener('pointerdown', wake);
      document.removeEventListener('keydown', wake);
    }
  };
  document.addEventListener('pointerdown', wake, { passive: true });
  document.addEventListener('keydown', wake);
<<<<<<< HEAD

  // Closing the tab is the most common way to leave a sequence mid-run, and it
  // is the one route that never fires `hashchange`.
  window.addEventListener('pagehide', () => { try { orb?.flush(); } catch {} });
=======
  setInterval(reflect, 1500);
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8

  let toastTimer;
  const toastEl = document.querySelector('[data-role=toast]');
  window.__toast = (msg) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3600);
  };
}

<<<<<<< HEAD
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
  garden?.frost(false);
  orbAudio.stop(0.5);
  scape.duck(1, 1.4);
}

async function route() {
  const hash = location.hash || '#/';

  if (hash.startsWith('#/orb/')) {
    await ensureGarden();
    closeOverlay();
    overlay.classList.add('on');
    garden.frost(true);
    orb = new OrbView(overlay, orbAudio, scape, session);
    try {
      await orb.open(hash.slice(6));
    } catch {
      closeOverlay();
      window.__toast?.('that memory is not here any more');
      location.hash = '#/';
=======
// ----------------------------------------------------------------- router ---

async function route() {
  const hash = location.hash || '#/';
  current?.close?.();
  current = null;
  orbAudio.stop(0.5);

  if (hash.startsWith('#/orb/')) {
    root.innerHTML = `<div class="loading">opening…</div>`;
    const view = new OrbView(root, orbAudio, scape, session);
    current = view;
    try {
      await view.open(hash.slice(6));
    } catch {
      document.body.classList.remove('in-memory');
      root.innerHTML = `<div class="loading">that memory is not here. <a href="#/" style="border-bottom:1px solid">back to the garden</a></div>`;
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
    }
    return;
  }

<<<<<<< HEAD
  if (hash === '#/add') {
    await ensureGarden();
    closeOverlay();
    overlay.classList.add('on');
    garden.frost(true);
    adding = new Contribute(overlay, scape, session, {
      onLanded: (id) => garden?.land(id),
    });
    adding.open();
    return;
  }

  closeOverlay();
  await ensureGarden();
=======
  // Leaving a memory: the garden comes back up to full.
  scape.duck(1, 1.4);

  if (hash === '#/add') {
    const add = new Contribute(root, scape, session);
    current = add;
    add.open();
    return;
  }

  const garden = new Garden(root, scape, session);
  current = garden;
  await garden.open();
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
}

shell();
window.addEventListener('hashchange', route);
route();
