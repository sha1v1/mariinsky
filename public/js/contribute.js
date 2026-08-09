// Adding to the wall. Two fields: what you want to say, and whatever you have
// of it. There is no mode to pick first and no limit on how much goes in --
// text, photos, clips and recordings all arrive through the same door, and the
// only instruction either field gets is its own label.
//
// It opens the way a memory does: the whole screen, over the frosted
// collection, with clicking outside as the way back. That is deliberate --
// backing out of leaving a memory should cost exactly as little as backing out
// of reading one, and nothing is created on the way out.

import { mulberry32, seed32 } from './rng.js';
import { loadImageFile, analyzeImage, mediaMeta, probeAudio, splitText, hslToHex } from './analyze.js';
import { imageComponents, videoComponents, audioComponents, textComponents } from './components.js';
import { defaults as defaultSettings, DEV } from './settings.js';
import { analyzeMemory, explain, EMOTION_HUE } from './emotion.js';

export class Contribute {
  constructor(root, scape, session, { onLanded } = {}) {
    this.root = root;
    this.scape = scape;
    this.session = session;
    this.onLanded = onLanded;
    this.items = [];
    this.words = '';
  }

  open() {
    this.root.innerHTML = `
      <div class="addscene" data-role="modal">
        <div class="addveil" data-role="scrim"></div>
        <div class="addorb" data-role="card" role="dialog" aria-modal="true" aria-label="leave one moment">
          <div class="addfield">
            <label for="words">what do you remember?</label>
            <textarea class="addtext" id="words" rows="5"></textarea>
          </div>
          <div class="addfield">
            <label id="medialabel">add pictures, videos, and audio</label>
            <button class="adddrop" data-role="drop" aria-describedby="medialabel">press / drag</button>
            <input type="file" data-role="file" multiple accept="image/*,video/*,audio/*" hidden>
            <div class="addtray" data-role="tray" hidden>
              <ul data-role="staged"></ul>
              <button class="traymore" data-role="more" aria-label="show the rest" hidden>${iconArrow()}</button>
            </div>
          </div>
          ${DEV ? '<div class="reading" data-role="reading"></div>' : ''}
          <div class="addfoot">
            <button class="addquiet" data-role="cancel">cancel</button>
            <span class="status" data-role="status" role="status"></span>
            <button class="btn btn-solid" data-role="commit">continue</button>
          </div>
        </div>
      </div>`;

    this.modal = this.root.querySelector('[data-role=modal]');
    this.card = this.root.querySelector('[data-role=card]');
    this.trayEl = this.root.querySelector('[data-role=tray]');
    this.stagedEl = this.root.querySelector('[data-role=staged]');
    this.moreEl = this.root.querySelector('[data-role=more]');
    this.readingEl = this.root.querySelector('[data-role=reading]');
    this.statusEl = this.root.querySelector('[data-role=status]');

    const ta = this.root.querySelector('#words');
    ta.addEventListener('input', () => { this.words = ta.value; this.reading(); });

    const input = this.root.querySelector('[data-role=file]');
    const drop = this.root.querySelector('[data-role=drop]');
    drop.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      this.add([...input.files]);
      // Cleared so that picking the same file twice in a row still fires.
      input.value = '';
    });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      this.add([...e.dataTransfer.files]);
    });

    this.moreEl.addEventListener('click', () => {
      this.stagedEl.scrollBy({ left: this.stagedEl.clientWidth * 0.8, behavior: 'smooth' });
    });
    this.stagedEl.addEventListener('scroll', () => this.reflectTray());

    this.root.querySelector('[data-role=commit]').addEventListener('click', () => this.commit());
    this.root.querySelector('[data-role=cancel]').addEventListener('click', () => this.dismiss());

    // Anywhere outside the orb is the way back, and it takes nothing with it.
    this.root.querySelector('[data-role=scrim]').addEventListener('click', () => this.dismiss());
    this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.dismiss(); });
    this.onKey = (e) => { if (e.key === 'Escape' && !this.sealing) this.dismiss(); };
    document.addEventListener('keydown', this.onKey);

    this.onResize = () => this.reflectTray();
    window.addEventListener('resize', this.onResize);

    this.reading();
  }

  dismiss() {
    // Halfway through sealing there is already an upload in flight; letting a
    // stray click cancel it would leave a half-written memory on the wall.
    if (this.sealing || this.dismissing) return;
    this.dismissing = true;
    location.hash = '#/';
  }

  // ---------------------------------------------------------- what is in --

  add(list) {
    for (const file of list) {
      const kind = kindOf(file);
      if (!kind) continue;
      // Nothing displaces anything else: an eighth photo and a third recording
      // are both just one more thing the memory is made of.
      const item = { file, kind, url: URL.createObjectURL(file) };
      this.items.push(item);
      if (kind === 'video') this.poster(item);
    }
    this.drawStaged();
    this.reading();
  }

  /**
   * A frame out of the middle of a clip, so the row reads as what was actually
   * put in. A file the browser cannot decode simply keeps its glyph tile --
   * the server can still convert it later, at commit.
   */
  async poster(item) {
    try {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'metadata';
      v.src = item.url;
      await once(v, 'loadeddata', 4000);
      v.currentTime = Math.min(0.3, (v.duration || 1) * 0.1);
      await once(v, 'seeked', 2000).catch(() => {});
      const side = Math.min(v.videoWidth, v.videoHeight);
      if (!side) return;
      const c = document.createElement('canvas');
      c.width = c.height = 124;
      c.getContext('2d').drawImage(
        v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, 124, 124);
      item.poster = c.toDataURL('image/jpeg', 0.72);
      this.drawStaged();
    } catch {
      /* it keeps the glyph */
    }
  }

  drawStaged() {
    this.trayEl.hidden = !this.items.length;
    this.stagedEl.innerHTML = this.items.map((it, i) => {
      const face = it.kind === 'image' ? `<img src="${it.url}" alt="">`
        : it.poster ? `<img src="${it.poster}" alt="">`
        : it.kind === 'video' ? iconClip() : iconWave();
      return `
        <li class="tile" title="${esc(it.file.name)}">
          ${face}
          <button class="tile-x" data-drop="${i}" aria-label="remove ${esc(it.file.name)}">×</button>
        </li>`;
    }).join('');
    this.stagedEl.querySelectorAll('[data-drop]').forEach((b) => {
      b.addEventListener('click', () => {
        const [gone] = this.items.splice(Number(b.dataset.drop), 1);
        if (gone) URL.revokeObjectURL(gone.url);
        this.drawStaged();
        this.reading();
      });
    });
    this.reflectTray();
  }

  /** The arrow is only offered when there is in fact something past the edge. */
  reflectTray() {
    if (!this.moreEl) return;
    const el = this.stagedEl;
    this.moreEl.hidden = el.scrollWidth - el.clientWidth - el.scrollLeft < 4;
  }

  // ----------------------------------------------------- showing the work --

  /**
   * Only built under ?dev. Two things it has to be honest about: the emotion
   * read is keyword matching, not a model, and the memory will be taken apart
   * and will not come back whole.
   */
  reading() {
    if (!this.readingEl) return;
    const text = this.words.trim();
    const a = analyzeMemory(text || 'a moment');
    const media = this.items.length;
    const hue = EMOTION_HUE[a.emotion] ?? 268;
    this.readingEl.style.setProperty('--reading', `hsl(${hue} 62% 58%)`);
    this.readingEl.innerHTML = `
      <span class="lede">what happens to it</span>
      it gets torn into fragments the moment it arrives${media ? ` — ${media} file${media > 1 ? 's' : ''} plus whatever you wrote` : ''}.
      every time somebody opens it, it comes back from a different handful of those fragments, and a little more of it is gone.
      <br><br>
      <span class="lede">what it will sound like</span>
      ${text ? `<b>${esc(explain(a))}</b>. that is keyword matching against five word lists, not a model — you can read the lists in the source.`
             : 'write a line and this will tell you which instruments it joins the collection on.'}`;
  }

  status(s) { this.statusEl.textContent = s; }

  // -------------------------------------------------------------- sealing --

  async commit() {
    const btn = this.root.querySelector('[data-role=commit]');
    const words = this.words.trim();

    if (!words && !this.items.length) return this.status('give it something first.');

    btn.disabled = true;
    this.sealing = true;
    const rng = mulberry32(seed32());
    const settings = defaultSettings();
    const sources = {};
    const components = {};
    const files = [];
    const glows = [];
    const skipped = [];

    // Shredding is the one setting that has to bite here rather than at replay:
    // components are cut exactly once, and this is that once.
    const limits = { maxWords: settings.text.maxWords, maxChars: settings.text.maxChars };

    if (words) {
      const frags = splitText(words, limits);
      if (frags.length) {
        sources.txt1 = { kind: 'text', text: words, label: 'what was written' };
        Object.assign(components, textComponents('txt1', frags));
      }
    }

    let n = 0;
    for (const item of this.items) {
      n++;
      const sid = `${item.kind.slice(0, 3)}${n}`;
      this.status(`tearing apart ${item.file.name}…`);
      await tick();

      let prep = null;
      const mount = (base) => {
        if (prep) return { ...base, prepId: prep.prepId, name: item.file.name };
        const src = { ...base, fileIndex: files.length, name: item.file.name };
        files.push(item.file);
        return src;
      };

      if (item.kind === 'image') {
        let img = await loadImageFile(item.file).catch(() => null);
        if (!img) {
          prep = await this.prepare(item, 'image');
          if (!prep) { skipped.push(item.file.name); continue; }
          img = await loadImageFile(prep.url).catch(() => null);
          if (!img) { skipped.push(item.file.name); continue; }
        }
        const analysis = analyzeImage(img);
        glows.push(analysis.glow);
        sources[sid] = mount({ kind: 'image', w: analysis.w, h: analysis.h, analysis });
        Object.assign(components, imageComponents(sid, analysis, rng));
      } else if (item.kind === 'video') {
        let meta = await mediaMeta(item.file, 'video');
        let hasAudio;
        if (!(meta.duration > 0 && meta.w > 0)) {
          prep = await this.prepare(item, 'video');
          if (!prep) { skipped.push(item.file.name); continue; }
          meta = { duration: prep.duration, w: prep.w, h: prep.h };
          hasAudio = prep.hasAudio;
        } else {
          hasAudio = (await probeAudio(item.file)).hasAudio;
        }
        if (!meta.duration) { skipped.push(item.file.name); continue; }
        sources[sid] = mount({ kind: 'video', w: meta.w, h: meta.h, duration: meta.duration, hasAudio });
        Object.assign(components, videoComponents(sid, meta.duration, rng));
        if (hasAudio && meta.duration > 2) {
          Object.assign(components, audioComponents(sid, meta.duration, rng, 'the clip'));
        }
      } else {
        let meta = await mediaMeta(item.file, 'audio');
        if (!(meta.duration > 0)) {
          prep = await this.prepare(item, 'audio');
          if (!prep) { skipped.push(item.file.name); continue; }
          meta = { duration: prep.duration };
        }
        // A short recording still deserves at least one window.
        const dur = meta.duration > 0 ? meta.duration : 0;
        if (!(dur > 0.8)) { skipped.push(item.file.name); continue; }
        sources[sid] = mount({ kind: 'audio', duration: dur });
        Object.assign(components, audioComponents(sid, dur, rng, 'the recording'));
      }
    }

    if (!Object.keys(components).length) {
      btn.disabled = false;
      this.sealing = false;
      return this.status(skipped.length
        ? `nothing in ${skipped.join(', ')} could be split. try another file.`
        : 'nothing there could be split. add a word or a file.');
    }

    const analysis = analyzeMemory(words || 'a moment', (rng() + 1) % 1);
    const title = (words.split('\n')[0] || 'a moment with no words').slice(0, 110);
    const glow = glows.length ? boldest(glows) : hslToHex(rng(), 0.55, 0.62);

    this.status(`sealing ${Object.keys(components).length} fragments…`);
    const body = new FormData();
    body.append('manifest', JSON.stringify({
      title, glow, sources, components, settings,
      emotion: analysis.emotion,
      analysis: { emotion: analysis.emotion, tempo: analysis.tempo, mood: analysis.mood, instruments: analysis.instruments, chords: analysis.chords, reverb: analysis.reverb, matched: analysis.matched },
    }));
    for (const f of files) body.append('files', f);

    const res = await fetch('/api/orbs', { method: 'POST', body });
    if (!res.ok) {
      btn.disabled = false;
      this.sealing = false;
      return this.status('the wall would not take it. try again in a second.');
    }
    const { id } = await res.json().catch(() => ({}));

    // The contribution joins the audioscape on the way back to the collection, so
    // you hear your own memory arrive in the room the moment you see it land.
    this.session.queue(analysis, title);
    this.release();
    this.words = '';

    // The orb gets out of the way, then the frost lifts, and only then does the
    // marble fly in -- so it is watched all the way into its slot on a page that
    // is already clear, instead of arriving blurred behind glass under a form
    // that has not finished closing.
    this.card?.classList.add('sealed');
    await new Promise((r) => setTimeout(r, 340));
    this.sealing = false;
    location.hash = '#/';
    if (id) this.onLanded?.(id);
  }

  async prepare(item, kind) {
    this.status(`your browser can’t read ${item.file.name} — converting it…`);
    const body = new FormData();
    body.append('kind', kind);
    body.append('file', item.file);
    const res = await fetch('/api/prepare', { method: 'POST', body });
    if (!res.ok) return null;
    return res.json();
  }

  /** Every thumbnail holds a blob alive until it is let go of. */
  release() {
    this.items.forEach((it) => URL.revokeObjectURL(it.url));
    this.items = [];
  }

  close() {
    this.release();
    document.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
  }
}

function kindOf(file) {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  const e = (file.name || '').toLowerCase().split('.').pop();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'heic'].includes(e)) return 'image';
  if (['mp4', 'mov', 'webm', 'm4v', 'ogv', 'mkv'].includes(e)) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus'].includes(e)) return 'audio';
  return null;
}

/** The boldest colour of everything inside, never the average -- averages are mud. */
function boldest(list) {
  let best = list[0], bestScore = -1;
  for (const hex of list) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const score = (mx ? (mx - mn) / mx : 0) * 1.5 + (mx / 255) * 0.5;
    if (score > bestScore) { bestScore = score; best = hex; }
  }
  return best;
}

const tick = () => new Promise((r) => setTimeout(r, 16));
const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

/** One event, or a rejection -- so a file that never decodes cannot hang a tile. */
function once(el, type, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { el.removeEventListener(type, done); reject(new Error(type)); }, ms);
    const done = () => { clearTimeout(timer); resolve(); };
    el.addEventListener(type, done, { once: true });
    el.addEventListener('error', () => { clearTimeout(timer); reject(new Error('error')); }, { once: true });
  });
}

function iconArrow() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>`;
}
function iconClip() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9.5l5 2.5-5 2.5z"/></svg>`;
}
function iconWave() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 12h2M8 7v10M12 4v16M16 8v8M20 11h1"/></svg>`;
}
