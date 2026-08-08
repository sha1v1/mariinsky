// Mariinsky. She trots in from the right once you have had a moment to look at
// the wall, asks the one question the whole site is for, and then lies down in
// the corner rather than nagging. Declining does not make her leave -- she just
// stops asking, and stays there to be asked back.

// Drawn front-on and sitting rather than in profile. A side view needs one eye
// and a long muzzle to read as a dog; drawn small in a corner it just reads as
// a rat. Front-on gets the two things a samoyed is actually recognised by --
// the ruff and the upturned mouth -- into the same silhouette. She arrives at a
// trot (the whole body bounces), then sits.
const DOG = `
<svg viewBox="0 0 200 200" role="img" aria-label="Mariinsky, a samoyed">
  <ellipse cx="100" cy="188" rx="60" ry="9" fill="rgba(60,46,20,.14)"/>
  <g class="dog-body">
    <!-- the plume, carried up over the back -->
    <g class="dog-tail">
      <path d="M143 152c32-4 47-32 36-54-9-18-31-21-38-6-5 12 5 22 13 16"
            fill="none" stroke="#f0ede3" stroke-width="21" stroke-linecap="round"/>
      <path d="M143 152c32-4 47-32 36-54-9-18-31-21-38-6-5 12 5 22 13 16"
            fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round"/>
    </g>

    <!-- seated body -->
    <path d="M100 78c31 0 50 29 50 62 0 25-22 42-50 42s-50-17-50-42c0-33 19-62 50-62z" fill="#fff"/>
    <path d="M56 150c8 19 25 28 44 28s36-9 44-28c1 27-20 44-44 44s-45-17-44-44z" fill="#f4f1e8"/>

    <!-- front paws -->
    <ellipse cx="76" cy="176" rx="17" ry="11" fill="#fff"/>
    <ellipse cx="124" cy="176" rx="17" ry="11" fill="#fdfcf8"/>
    <path d="M71 172v7M76 171v8M81 172v7" stroke="#e6e1d3" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M119 172v7M124 171v8M129 172v7" stroke="#e6e1d3" stroke-width="1.8" stroke-linecap="round"/>

    <!-- the ruff. broken into scallops rather than shaded as a band: a single
         curved highlight across here reads as the rim of a mug -->
    <path d="M100 88c30 0 52 13 52 29 0 15-23 25-52 25s-52-10-52-25c0-16 22-29 52-29z" fill="#fdfcf8"/>
    <path d="M50 118c4 7 11 7 15 1 4 8 12 9 17 2 4 8 13 9 18 2 5 7 14 6 18-2 4 6 11 6 15-1 1 2 1 4 1 6 0 14-23 24-52 24s-53-10-53-24c0-2 0-4 1-8z" fill="#f6f4ec"/>

    <g class="dog-head">
      <!-- ears -->
      <path class="dog-ear-l" d="M72 44C64 28 62 13 67 9c6-4 20 11 27 24z" fill="#fff" stroke="#e6e1d3" stroke-width="2" stroke-linejoin="round"/>
      <path class="dog-ear-r" d="M128 44c8-16 10-31 5-35-6-4-20 11-27 24z" fill="#fff" stroke="#e6e1d3" stroke-width="2" stroke-linejoin="round"/>
      <path class="dog-ear-l" d="M75 40c-5-11-7-20-4-22 3-2 11 7 16 16z" fill="#f2d3cc"/>
      <path class="dog-ear-r" d="M125 40c5-11 7-20 4-22-3-2-11 7-16 16z" fill="#f2d3cc"/>

      <!-- head, with fluff broken along the silhouette -->
      <circle cx="100" cy="72" r="42" fill="#fff"/>
      <path d="M60 62c3-6 9-6 12-1 3-7 10-8 14-2 3-8 11-9 15-2 4-7 12-7 15 1 4-7 12-7 15 1 3-6 10-6 13 1C138 40 121 28 100 28S62 40 60 62z" fill="#fdfcf8"/>

      <!-- muzzle -->
      <ellipse cx="100" cy="92" rx="22" ry="15" fill="#ffffff"/>
      <!-- nose -->
      <path d="M90 83c0-4 20-4 20 0 0 7-6 12-10 12s-10-5-10-12z" fill="#1b1a20"/>
      <ellipse cx="95" cy="85" rx="2.6" ry="1.8" fill="#4a4753"/>
      <!-- the samoyed smile: corners turned up, which is the whole point of her -->
      <path d="M100 95v6" stroke="#2a2831" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M100 101c-4 9-14 10-19 2M100 101c4 9 14 10 19 2" stroke="#2a2831" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <!-- eyes -->
      <ellipse cx="80" cy="68" rx="6" ry="7.4" fill="#1b1a20"/>
      <ellipse cx="120" cy="68" rx="6" ry="7.4" fill="#1b1a20"/>
      <circle cx="82.2" cy="64.6" r="2.1" fill="#fff"/>
      <circle cx="122.2" cy="64.6" r="2.1" fill="#fff"/>
    </g>
  </g>
</svg>`;

export class Mascot {
  constructor({ onYes, onNo } = {}) {
    this.onYes = onYes;
    this.onNo = onNo;
    this.el = null;
    this.timer = null;
    this.dismissed = false;
  }

  mount(parent) {
    if (this.el) return;
    const el = document.createElement('div');
    el.className = 'dog';
    el.innerHTML = `
      ${DOG}
      <div class="bubble" role="dialog" aria-label="Mariinsky asks">
        <p class="who">mariinsky</p>
        <p class="line"></p>
        <div class="bubble-actions">
          <button class="yes">yes, hold on</button>
          <button class="no">just looking</button>
        </div>
      </div>`;
    parent.appendChild(el);
    this.el = el;
    this.line = el.querySelector('.line');

    el.querySelector('.yes').addEventListener('click', () => this.onYes?.());
    el.querySelector('.no').addEventListener('click', () => {
      this.dismissed = true;
      el.classList.remove('asking');
      this.onNo?.();
    });
    // She stays reachable after being waved off.
    el.querySelector('svg').addEventListener('click', () => {
      if (this.el.classList.contains('asking')) this.el.classList.remove('asking');
      else this.ask();
    });
  }

  /** Trot in after `delay`, settle, then put the question. */
  arrive(delay = 5200, prompt) {
    if (!this.el || this.dismissed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.el.classList.add('here');
      // stop trotting once she has arrived
      setTimeout(() => this.el?.classList.add('settled'), 1150);
      setTimeout(() => this.ask(prompt), 1450);
    }, delay);
  }

  ask(prompt) {
    if (!this.el || this.dismissed) return;
    this.line.textContent = prompt || this.pick();
    this.el.classList.add('here', 'settled', 'asking');
  }

  pick() {
    const lines = [
      'want to put something on the wall? one moment is plenty.',
      'you could leave a memory here. it takes about a minute.',
      'the wall takes anything — a photo, a scribble, six words.',
      'add one of yours? the garden gets better the more it holds.',
    ];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  destroy() {
    clearTimeout(this.timer);
    this.el?.remove();
    this.el = null;
  }
}
