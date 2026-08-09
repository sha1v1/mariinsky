// Router and shell.
//
// The collection is never torn down. Both of the things you can do to it --
// opening a memory, and leaving one -- mount *over* it in the same overlay,
// which is why the page behind can frost rather than disappear, and why closing
// either costs nothing: there is nothing to rebuild.

import { Audioscape } from './audioscape.js';
import { OrbAudio } from './orbaudio.js';
import { Garden } from './garden.js';
import { Contribute } from './contribute.js';
import { OrbView } from './orbview.js';

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
    document.body.classList.add('overlay-on');
    garden.frost(true);
    orb = new OrbView(overlay, orbAudio, scape, session);
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

window.__audit = { scape, orbAudio, garden: () => garden, orb: () => orb };  // TEMP DEBUG — remove

shell();
window.addEventListener('hashchange', route);
route();
