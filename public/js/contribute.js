// Adding to the wall. The whole thing is built around one constraint: a
// stranger should be able to finish it in under a minute without being told
// what to do. So there is one choice (how you want to leave it), one input, and
// one button -- and the panel underneath shows, in plain words, exactly what
// the site is about to do with what you gave it.
//
// It opens the same way a memory does: a card over the frosted collection, with
// the page still visible behind it, and clicking outside is how you leave. That
// is deliberate -- backing out of leaving a memory should cost exactly as
// little as backing out of reading one, and nothing is created on the way out.

import { mulberry32, seed32 } from './rng.js';
import { loadImageFile, analyzeImage, mediaMeta, probeAudio, splitText, hslToHex } from './analyze.js';
import { imageComponents, videoComponents, audioComponents, textComponents } from './components.js';
import { defaults as defaultSettings } from './settings.js';
import { analyzeMemory, explain, EMOTION_HUE } from './emotion.js';

const WAYS = [
  { id: 'write', label: 'write it', hint: 'a few words', icon: iconPen() },
  { id: 'speak', label: 'say it', hint: '15 seconds', icon: iconMic() },
  { id: 'draw',  label: 'draw it', hint: 'one scribble', icon: iconScribble() },
  { id: 'photo', label: 'show it', hint: 'a photo or clip', icon: iconFrame() },
];

export class Contribute {
  constructor(root, scape, session, { onLanded } = {}) {
    this.root = root;
    this.scape = scape;
    this.session = session;
    this.onLanded = onLanded;
    this.way = 'write';
    this.files = [];
    this.words = '';
    this.recorder = null;
    this.recTimer = null;
    this.recSeconds = 0;
  }

  open() {
    this.root.innerHTML = `
      <div class="addmodal" data-role="modal">
        <div class="orbscrim" data-role="scrim"></div>
        <div class="addcard" data-role="card" role="dialog" aria-modal="true" aria-label="leave one moment">
          <div class="add-head">
            <h2>leave one moment.</h2>
            <p>it does not have to be a good one, or explained.</p>
          </div>
          <div class="ways" role="tablist">
            ${WAYS.map((w) => `
              <button class="way${w.id === this.way ? ' on' : ''}" role="tab" data-way="${w.id}" aria-selected="${w.id === this.way}">
                ${w.icon}<b>${w.label}</b><span>${w.hint}</span>
              </button>`).join('')}
          </div>
          <div data-role="stage"></div>
          <div class="reading" data-role="reading"></div>
          <div class="add-actions">
            <button class="btn btn-solid" data-role="commit">put it on the wall</button>
            <button class="btn" data-role="cancel">not now</button>
            <span class="status" data-role="status"></span>
          </div>
        </div>
      </div>`;

    this.modal = this.root.querySelector('[data-role=modal]');
    this.card = this.root.querySelector('[data-role=card]');
    this.stage = this.root.querySelector('[data-role=stage]');
    this.readingEl = this.root.querySelector('[data-role=reading]');
    this.statusEl = this.root.querySelector('[data-role=status]');

    this.root.querySelectorAll('[data-way]').forEach((b) => {
      b.addEventListener('click', () => this.setWay(b.dataset.way));
    });
    this.root.querySelector('[data-role=commit]').addEventListener('click', () => this.commit());
    this.root.querySelector('[data-role=cancel]').addEventListener('click', () => this.dismiss());

    // Anywhere outside the card is the way back, and it takes nothing with it.
    this.root.querySelector('[data-role=scrim]').addEventListener('click', () => this.dismiss());
    this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.dismiss(); });
    this.onKey = (e) => { if (e.key === 'Escape' && !this.sealing) this.dismiss(); };
    document.addEventListener('keydown', this.onKey);

    this.drawStage();
    this.reading();
  }

  dismiss() {
    // Halfway through sealing there is already an upload in flight; letting a
    // stray click cancel it would leave a half-written memory on the wall.
    if (this.sealing || this.dismissing) return;
    this.dismissing = true;
    location.hash = '#/';
  }

  setWay(way) {
    if (this.way === way) return;
    this.stopRecording();
    this.way = way;
    this.root.querySelectorAll('[data-way]').forEach((b) => {
      const on = b.dataset.way === way;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    this.drawStage();
  }

  // ---------------------------------------------------------- the inputs --

  drawStage() {
    const shared = `
      <div class="panel">
        <label for="words">${this.way === 'write' ? 'the memory' : 'a line about it, if you want one'}</label>
        <textarea id="words" rows="${this.way === 'write' ? 4 : 2}"
          placeholder="${this.way === 'write' ? 'the smell of the hallway at my grandmother’s' : 'optional'}">${esc(this.words)}</textarea>
      </div>`;

    if (this.way === 'write') {
      this.stage.innerHTML = shared;
    } else if (this.way === 'speak') {
      this.stage.innerHTML = `
        <div class="panel">
          <label>say it out loud</label>
          <div class="rec">
            <button class="rec-btn" data-role="rec" aria-label="start recording"><i></i></button>
            <div class="rec-meta">
              <b data-role="clock">0:00</b>
              <span data-role="rechint">tap to record. anything — a name, a hum, the room.</span>
            </div>
          </div>
          <ul class="staged" data-role="staged"></ul>
        </div>${shared}`;
      this.stage.querySelector('[data-role=rec]').addEventListener('click', () => this.toggleRecording());
    } else if (this.way === 'draw') {
      this.stage.innerHTML = `
        <div class="panel">
          <label>draw it, or write one word by hand</label>
          <canvas data-role="pad" width="900" height="480"
            style="width:100%;border-radius:12px;background:#fff;border:1.5px dashed var(--hairline);touch-action:none;cursor:crosshair"></canvas>
          <div style="display:flex;gap:.5rem;margin-top:.6rem">
            <button class="btn" data-role="clear">start over</button>
            <span class="status" data-role="padhint">use your finger or the mouse</span>
          </div>
        </div>${shared}`;
      this.pad();
    } else {
      this.stage.innerHTML = `
        <div class="panel">
          <label>a photo or a short clip</label>
          <div class="drop" data-role="drop">
            drop it here, or <button class="linkish" data-role="pick">choose a file</button>
            <input type="file" data-role="file" multiple accept="image/*,video/*,audio/*" hidden>
          </div>
          <ul class="staged" data-role="staged"></ul>
        </div>${shared}`;
      this.fileStage();
    }

    const ta = this.stage.querySelector('#words');
    ta?.addEventListener('input', () => { this.words = ta.value; this.reading(); });
    this.drawStaged();
  }

  fileStage() {
    const input = this.stage.querySelector('[data-role=file]');
    const drop = this.stage.querySelector('[data-role=drop]');
    this.stage.querySelector('[data-role=pick]').addEventListener('click', () => input.click());
    input.addEventListener('change', () => this.add([...input.files]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      this.add([...e.dataTransfer.files]);
    });
  }

  /** A scribble pad. What comes out is a PNG, so it goes down the image path. */
  pad() {
    const canvas = this.stage.querySelector('[data-role=pad]');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = '#17161c';
    ctx.lineWidth = 6;

    let drawing = false, last = null, marked = false;
    const at = (e) => {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      drawing = true; marked = true; last = at(e);
      ctx.beginPath(); ctx.arc(last[0], last[1], 3, 0, 7); ctx.fillStyle = '#17161c'; ctx.fill();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = at(e);
      ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      last = p;
    });
    const up = () => { drawing = false; this.padDirty = marked; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointerleave', up);
    this.stage.querySelector('[data-role=clear]').addEventListener('click', () => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#17161c';
      marked = false;
      this.padDirty = false;
    });
    this.padEl = canvas;
  }

  async toggleRecording() {
    if (this.recorder) return this.stopRecording();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.status('the browser would not give us the microphone. try a file instead.');
      return;
    }
    const chunks = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      const ext = (rec.mimeType || '').includes('ogg') ? 'ogg' : (rec.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
      this.files = this.files.filter((f) => f.kind !== 'audio');
      this.add([new File([blob], `said-out-loud.${ext}`, { type: blob.type })]);
    };
    rec.start();
    this.recorder = rec;
    this.recSeconds = 0;
    this.stage.querySelector('[data-role=rec]')?.classList.add('on');
    this.stage.querySelector('[data-role=rechint]').textContent = 'listening. tap again when you are done.';
    this.recTimer = setInterval(() => {
      this.recSeconds++;
      const el = this.stage.querySelector('[data-role=clock]');
      if (el) el.textContent = `0:${String(this.recSeconds).padStart(2, '0')}`;
      if (this.recSeconds >= 60) this.stopRecording();
    }, 1000);
  }

  stopRecording() {
    clearInterval(this.recTimer);
    if (!this.recorder) return;
    try { this.recorder.stop(); } catch {}
    this.recorder = null;
    this.stage.querySelector('[data-role=rec]')?.classList.remove('on');
    const hint = this.stage.querySelector('[data-role=rechint]');
    if (hint) hint.textContent = 'got it. record again to replace it.';
  }

  add(list) {
    for (const file of list) {
      const kind = kindOf(file);
      if (!kind) continue;
      if (kind === 'audio') this.files = this.files.filter((f) => f.kind !== 'audio');
      this.files.push({ file, kind });
    }
    this.drawStaged();
    this.reading();
  }

  drawStaged() {
    const el = this.stage.querySelector('[data-role=staged]');
    if (!el) return;
    el.innerHTML = this.files.map((f, i) => `
      <li><b>${f.kind}</b> ${esc(f.file.name)}
        <button class="drop-one" data-drop="${i}" aria-label="remove">×</button></li>`).join('');
    el.querySelectorAll('[data-drop]').forEach((b) => {
      b.addEventListener('click', () => {
        this.files.splice(Number(b.dataset.drop), 1);
        this.drawStaged();
        this.reading();
      });
    });
  }

  // ----------------------------------------------------- showing the work --

  /**
   * The panel that says what is about to happen. Two things it must be honest
   * about: the emotion read is keyword matching, not a model, and the memory
   * will be taken apart and will not come back whole.
   */
  reading() {
    const text = this.words.trim();
    const a = analyzeMemory(text || 'a moment');
    const media = this.files.length + (this.padDirty ? 1 : 0);
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

    // The scribble is only collected at the last moment, so a half-finished
    // drawing is never uploaded behind the contributor's back.
    if (this.way === 'draw' && this.padDirty && !this.files.some((f) => f.kind === 'image' && f.file.name === 'drawn.png')) {
      const blob = await new Promise((r) => this.padEl.toBlob(r, 'image/png'));
      if (blob) this.files.push({ file: new File([blob], 'drawn.png', { type: 'image/png' }), kind: 'image' });
    }
    this.stopRecording();
    await new Promise((r) => setTimeout(r, 120));   // let the recorder flush

    if (!words && !this.files.length) return this.status('give it something first — even one word.');

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
    for (const item of this.files) {
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
    const result = await res.json().catch(() => ({}));
    const { id } = result;
    if (result.worldSynced === false) {
      window.__toast?.('saved here — the 3D world will retry this memory automatically');
    }

    // The contribution joins the audioscape on the way back to the collection, so
    // you hear your own memory arrive in the room the moment you see it land.
    this.session.queue(analysis, title);
    this.files = [];
    this.words = '';

    // The card gets out of the way, then the frost lifts, and only then does
    // the marble fly in -- so it is watched all the way into its slot on a page
    // that is already clear, instead of arriving blurred behind glass under a
    // form that has not finished closing.
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

  close() {
    this.stopRecording();
    document.removeEventListener('keydown', this.onKey);
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

function iconPen() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L8 20l-5 1 1-5z"/><path d="M14 6l4 4"/></svg>`;
}
function iconMic() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></svg>`;
}
function iconScribble() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 17c3-9 6 4 9-3s5 4 9-4"/></svg>`;
}
function iconFrame() {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-4 4 3 3-2 4 3"/></svg>`;
}
