// Mariinsky, flopped across the middle of the page with the title resting on
// her side. She is not a widget in a corner -- she is the centre of the spread,
// and the words are printed across her the way a name is printed across the
// cover of a book.
//
// She is one hand-made illustration with the title lettered onto her side, so
// the words live in the artwork itself; the page keeps only a hidden heading
// for readers who cannot see her.
const DOG = `<img class="hero-dog" src="media/gray_outline.png" alt="">`;

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
        <h1 class="hero-words">mariinsky — a memory collective</h1>
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
