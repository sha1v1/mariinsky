// Mariinsky, centred in the middle of the page. The dog illustration and the
// title text have been replaced by a single portrait image; the only motion
// left is her thought bubble, which still asks the visitor to share a memory.
//
// She lies facing left with her head at the left edge of the portrait, so her
// thoughts go out that way. Where they land is the stylesheet's business —
// `.thought` is anchored to the left edge of the hero box, and on a screen too
// narrow to hold the question out there the bubble turns the corner and sits
// above her instead.

export class Mascot {
  constructor({ onAsk } = {}) {
    this.onAsk = onAsk;
    this.el = null;
    this.cycle = null;
    this.hideTimer = null;
    this.dismissed = false;
  }

  /** Markup for the hero: her portrait and her thoughts. */
  static markup() {
    return `
      <div class="hero" data-role="hero">
        <img class="hero-image" src="/images/mariinsky_grey.png" alt="Mariinsky">
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

  /** Three pips climbing away to her left, then the question, then she lets it go. */
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
