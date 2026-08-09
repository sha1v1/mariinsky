// Mariinsky, centred in the middle of the page. She is a looping video rather
// than a still, and she carries the title with her; her thought bubble is the
// only other thing moving out here.
//
// The clip is H.264 on flat white, because MP4 has no alpha to key against, so
// the white is removed at paint time by `mix-blend-mode: multiply` in the
// stylesheet. Multiplying by white leaves the backdrop untouched, which is
// exactly what "no background" means on paper this pale.
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

  /**
   * Markup for the hero: her, and her thoughts.
   *
   * `muted` is not a preference, it is the precondition for `autoplay` — a clip
   * with sound is refused by every browser until the visitor has interacted,
   * and a mascot that only starts moving once you click something is worse than
   * a still. The bubble's cloud is drawn by the stylesheet out of the empty
   * `.puffs` span, so the question stays one plain line of text in the markup.
   */
  static markup() {
    return `
      <div class="hero" data-role="hero">
        <video class="hero-image" data-role="hero-video"
               src="/video/mariinsky.mp4"
               autoplay muted loop playsinline disablepictureinpicture
               aria-label="Mariinsky"></video>
        <div class="thought" data-role="thought" aria-hidden="true">
          <span class="thought-pip one"></span>
          <span class="thought-pip two"></span>
          <span class="thought-pip three"></span>
          <button class="thought-bubble" data-role="ask">
            <span class="puffs" aria-hidden="true"></span>
            <span class="thought-text">share a memory with me?</span>
          </button>
        </div>
      </div>`;
  }

  mount(root) {
    this.el = root.querySelector('[data-role=thought]');
    if (!this.el) return;
    root.querySelector('[data-role=ask]').addEventListener('click', () => this.onAsk?.());

    // Autoplay is refused outright in a few settings (low-power mode is the
    // common one), and it is also dropped silently when the tab starts in the
    // background. Nudging her on the first interaction and on becoming visible
    // costs nothing and is the difference between a mascot and a frozen frame.
    this.video = root.querySelector('[data-role=hero-video]');
    this.nudge = () => { this.video?.play?.().catch(() => {}); };
    this.nudge();
    document.addEventListener('pointerdown', this.nudge, { passive: true });
    document.addEventListener('visibilitychange', this.nudge);

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
    if (this.nudge) {
      document.removeEventListener('pointerdown', this.nudge);
      document.removeEventListener('visibilitychange', this.nudge);
    }
    this.el = null;
    this.video = null;
  }
}
