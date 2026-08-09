<<<<<<< HEAD
// Mariinsky, flopped across the middle of the page with the title resting on
// her side. She is not a widget in a corner -- she is the centre of the spread,
// and the words are printed across her the way a name is printed across the
// cover of a book.
//
// Drawn to the reference illustration: near-white, outlined in pale pink rather
// than ink, one eye squeezed shut, a blue nose and a tongue hanging out of the
// side of her mouth. Her head is well to the left of the type so nothing
// overlaps her face.
//
// Everything that moves is its own group with its own transform-origin, and
// every animation is *occasional* -- long still stretches with a short burst in
// them. A dog that wags without stopping reads as a gif; one that wags every
// eleven seconds reads as alive. The four clocks are deliberately coprime-ish
// (11s, 9s, 13s, 17s) so they drift apart instead of locking into one pulse.

const C = {
  line:  '#fcdfd8',   // the pale pink she is drawn in
  coat:  '#fafafa',
  shade: '#efefef',   // the soft interior marks that separate leg from body
  ear:   '#fbcfc6',
  nose:  '#1b3fa0',
  mouth: '#2b2b2b',
  tongue:'#f8756e',
  eye:   '#141414',
};

/* Draw order is the whole trick. Every part is a closed white blob with its own
   pink outline, laid front-to-back the way the reference is: the body first,
   then the tail and the legs *over* it -- which is why their outlines read as
   creases across her side rather than as separate shapes parked next to her --
   and the head last, over everything. */
const DOG = `
<svg class="hero-dog" viewBox="0 0 920 680" aria-hidden="true">
  <g fill="${C.coat}" stroke="${C.line}" stroke-width="16" stroke-linejoin="round" stroke-linecap="round">

    <!-- the body: one long flop from her shoulder to her hindquarters -->
    <path d="M256 338c-4-116 96-208 250-208 152 0 272 88 272 200s-120 194-272 194
             c-148 0-246-78-250-186z"/>

    <!-- the plume: two lobes overlapping hard enough to read as one piece of
         fur rather than as two circles parked behind her -->
    <g class="hero-tail">
      <ellipse cx="792" cy="376" rx="106" ry="92" transform="rotate(-16 792 376)"/>
      <ellipse cx="812" cy="494" rx="88" ry="74" transform="rotate(12 812 494)"/>
    </g>

    <!-- the hind leg, folded under her -->
    <ellipse cx="472" cy="466" rx="82" ry="60"/>

    <!-- the front leg: a limb, not a bubble. it is a capsule out of her chest
         with the paw as its far end, which is the only way a leg reads at this
         size without any shading to help it -->
    <rect x="178" y="446" width="200" height="88" rx="44" transform="rotate(-22 278 490)"/>
  </g>

  <!-- interior marks: not outlines, just the soft creases that say this is a
       leg in front of a body rather than a shape stuck on one -->
  <g fill="none" stroke="${C.shade}" stroke-width="15" stroke-linecap="round">
    <path d="M600 206c46 44 58 116 34 176"/>
    <path d="M236 306c30 4 52 24 58 52"/>
  </g>
  <g fill="none" stroke="${C.line}" stroke-width="11" stroke-linecap="round">
    <path d="M186 486v34M214 470v36M244 458v34"/>
  </g>

  <!-- her head. tilts as a whole, so ears, muzzle, mouth and eye all go with it -->
  <g class="hero-head">
    <g fill="${C.coat}" stroke="${C.line}" stroke-width="16" stroke-linejoin="round">
      <path d="M140 122c-10-44-6-80 12-84 20-5 48 28 66 72z"/>
      <path d="M290 148c16-42 18-76 0-84-20-9-50 24-66 68z"/>
    </g>
    <path d="M150 116c-7-31-5-56 6-59 13-2 33 20 47 50z" fill="${C.ear}"/>
    <path d="M281 138c11-29 13-53 1-58-13-7-35 17-46 47z" fill="${C.ear}"/>

    <circle cx="205" cy="216" r="120" fill="${C.coat}" stroke="${C.line}" stroke-width="16"/>

    <!-- the muzzle, tucked into the near side of her face -->
    <circle cx="134" cy="252" r="68" fill="#fff"/>

    <!-- the tongue hangs out from under the mouth, and lolls on its own clock -->
    <g class="hero-tongue">
      <path d="M62 318c-20 26-20 60 4 72 26 13 60-4 72-32 7-17 3-33-8-40z" fill="${C.tongue}"/>
    </g>
    <path d="M50 300c16-17 46-25 84-21 33 3 63 16 76 31 8 9 2 19-12 22
             -42 8-100 2-130-12-13-6-19-13-18-20z" fill="${C.mouth}"/>

    <ellipse cx="86" cy="250" rx="31" ry="23" fill="${C.nose}" transform="rotate(-20 86 250)"/>

    <!-- the near eye, squeezed shut, and the far one just showing past her
         cheek. those two marks are the entire face -->
    <path class="hero-eye" d="M168 228c9-19 35-19 44 0" fill="none"
          stroke="${C.eye}" stroke-width="15" stroke-linecap="round"/>
    <path d="M100 176c5-11 18-13 25-4" fill="none"
          stroke="${C.eye}" stroke-width="13" stroke-linecap="round"/>
=======
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
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
  </g>
</svg>`;

export class Mascot {
<<<<<<< HEAD
  constructor({ onAsk } = {}) {
    this.onAsk = onAsk;
    this.el = null;
    this.cycle = null;
    this.hideTimer = null;
    this.dismissed = false;
  }

  /** Markup for the hero: the dog, the words on her side, and her thoughts. */
  static markup() {
    return `
      <div class="hero" data-role="hero">
        ${DOG}
        <div class="hero-words">
          <h1>mar<span class="dot-a">i</span><span class="dot-b">i</span>nsky</h1>
          <p>a memory collective</p>
        </div>
        <div class="thought" data-role="thought" aria-hidden="true">
          <span class="thought-pip one"></span>
          <span class="thought-pip two"></span>
          <span class="thought-pip three"></span>
          <button class="thought-bubble" data-role="ask">share a memory with me?</button>
        </div>
      </div>`;
  }

  mount(root) {
    this.el = root.querySelector('[data-role=thought]');
    if (!this.el) return;
    root.querySelector('[data-role=ask]').addEventListener('click', () => this.onAsk?.());
    // She asks soon after you arrive, then only now and then.
    this.schedule(6000);
  }

  schedule(delay) {
    clearTimeout(this.cycle);
    this.cycle = setTimeout(() => this.wonder(), delay);
  }

  /** Three pips climbing away from her head, then the question, then she lets it go. */
  wonder() {
    if (!this.el || this.dismissed) return;
    this.el.classList.add('thinking');
    this.el.setAttribute('aria-hidden', 'false');
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.el?.classList.remove('thinking');
      this.el?.setAttribute('aria-hidden', 'true');
      this.schedule(16000);
    }, 11000);
  }

  destroy() {
    clearTimeout(this.cycle);
    clearTimeout(this.hideTimer);
=======
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
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
    this.el = null;
  }
}
