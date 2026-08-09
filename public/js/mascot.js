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
  </g>
</svg>`;

export class Mascot {
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
    this.el = null;
  }
}
