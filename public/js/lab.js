// The laboratory: the same sphere, the same composer, but with the dice held
// still and every bias exposed.
//
// Three panes, and the difference between them is the whole idea:
//
//   recipe  -- biases the composer obeys. You are not choosing the result, you
//              are choosing the walls the result must be rolled inside.
//   this take -- the result that has already been composed, rearranged by hand.
//              Nothing here is a setting. When you like an arrangement, "keep
//              this arrangement" reads it back out as a bias, which is the only
//              door between the two panes.
//   pieces  -- what is allowed into the roll at all. Hiding is hiding, in the
//              photo-editor sense: the component is untouched and still listed.
//
// Nothing in here writes to the orb until you press save, and no lab render
// ever appends a version or advances the decay.
import { SCHEMA, defaults, normalize, get, sub, isManual, controlOf, applies } from './settings.js';
import { composeVersion, plateKey } from './compose.js';
import { loadImage } from './imagelayers.js';
import { OrbView, beatIds, orbGradient } from './orbview.js';
import { seed32 } from './rng.js';

const KIND_LABEL = {
  imageLayer: 'image layers',
  videoPortion: 'video portions',
  textFragment: 'text fragments',
  audioWindow: 'audio windows',
};

export class LabView extends OrbView {
  constructor(root, audio, scape, session) {
    super(root, audio, scape, session);
    this.tab = 'recipe';
    this.hidden = new Set();
    this.order = new Map();
    this.seed = seed32();
    this.pinned = true;
    this.open2 = new Set();       // which macros are expanded
    this.dirty = false;
    this.timer = null;
  }

  async open(id) {
    const res = await fetch(`/api/orbs/${id}`);
    if (!res.ok) throw new Error('orb not found');
    this.orb = await res.json();
    this.settings = normalize(this.orb.settings);
    // The bench is a listening room too: the collection stays audible
    // underneath, but well below whatever is being tuned on the glass.
    this.scape?.duck(0.34, 1.2);
    this.shell();
    this.rerender();
  }

  /** The lab is a sandbox. Versions are never appended from in here, and a
   *  sequence watched in here never charges the orb any strain. */
  async persist() {}
  async flush() {}

  shell() {
    const o = this.orb;
    // The glass is lit by the same three colours here as it is in the memory
    // itself -- the sphere's whole background is built out of them, so a bench
    // that only set --glow put an unlit black ball on the stand.
    const g = orbGradient(o);
    this.root.innerHTML = `
      <div class="lab" style="--glow:${g[0]};--g1:${g[0]};--g2:${g[1]};--g3:${g[2]}">
        <header class="lab-head">
          <button class="hudbtn" data-act="exit">← the orb</button>
          <div class="lab-title">
            <h1>laboratory <span class="dim">· ${esc(o.title)}</span></h1>
            <p class="hud-sub" data-role="sub"></p>
          </div>
          <div class="lab-acts">
            <button class="hudbtn" data-act="copy" title="copy this recipe to the clipboard">copy</button>
            <button class="hudbtn" data-act="paste" title="paste a recipe from another orb">paste</button>
            <button class="hudbtn" data-act="reset">reset</button>
            <button class="hudbtn" data-act="mute">sound on</button>
            <button class="hudbtn hudbtn-solid" data-act="save">save recipe</button>
          </div>
        </header>
        <div class="lab-body">
          <aside class="lab-panel">
            <nav class="lab-tabs">
              <button data-tab="recipe">recipe</button>
              <button data-tab="take">this take</button>
              <button data-tab="pieces">pieces</button>
            </nav>
            <div class="lab-scroll" data-role="panel"></div>
          </aside>
          <div class="lab-stage">
            <div class="sphere" data-role="sphere">
              <div class="collage" data-role="collage"></div>
              <div class="grain"></div>
              <div class="glass"></div>
              <div class="rim"></div>
            </div>
            <div class="reveal" data-role="reveal" hidden></div>
            <div class="lab-transport">
              <label class="tp-range">
                <span>decay <b data-role="decayval"></b></span>
                <input type="range" data-role="decay" min="0" max="0.94" step="0.01">
              </label>
              <label class="tp-check">
                <input type="checkbox" data-role="pin" checked>
                <span>pin the seed</span>
              </label>
              <button class="hudbtn" data-act="roll">re-roll</button>
            </div>
          </div>
        </div>
      </div>`;

    this.sphere = this.q('sphere');
    this.collage = this.q('collage');
    this.sub = this.q('sub');
    this.revealEl = this.q('reveal');
    this.panel = this.q('panel');
    this.strip = null;            // the lab has no history strip

    // Scoped to the bench rather than the root, which outlives this view: a
    // listener left behind would keep firing inside whatever replaces it.
    this.bench = this.root.querySelector('.lab');
    this.bench.addEventListener('click', (e) => this.onClick(e));
    this.panel.addEventListener('input', (e) => this.onInput(e));
    this.panel.addEventListener('change', (e) => this.onInput(e));

    const decay = this.q('decay');
    decay.value = get(this.settings, 'global.decay');
    decay.addEventListener('input', () => {
      this.settings.global.decay = Number(decay.value);
      this.q('decayval').textContent = `${Math.round(decay.value * 100)}%`;
      this.touch();
    });
    this.q('decayval').textContent = `${Math.round(decay.value * 100)}%`;
    this.q('pin').addEventListener('change', (e) => { this.pinned = e.target.checked; });

    this.sphere.addEventListener('pointermove', (e) => {
      const r = this.sphere.getBoundingClientRect();
      this.sphere.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      this.sphere.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    });

    this.drawPanel();
    this.pulse();
  }

  q(role) { return this.root.querySelector(`[data-role=${role}]`); }

  onClick(e) {
    const tab = e.target.closest('[data-tab]')?.dataset.tab;
    if (tab) { this.tab = tab; return this.drawPanel(); }

    const macro = e.target.closest('[data-macro]')?.dataset.macro;
    if (macro) {
      this.open2.has(macro) ? this.open2.delete(macro) : this.open2.add(macro);
      return this.drawPanel();
    }

    const auto = e.target.closest('[data-auto]')?.dataset.auto;
    if (auto) {
      const [group, k, sk] = auto.split('.');
      delete this.settings[group][k].manual[sk];
      this.drawPanel();
      return this.touch();
    }

    const dec = e.target.closest('[data-dec]')?.dataset.dec;
    if (dec) return this.decompose(dec);

    const move = e.target.closest('[data-move]');
    if (move) return this.reorder(move.dataset.move, Number(move.dataset.dir));

    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'exit') location.hash = `#/orb/${this.orb.id}`;
    if (act === 'roll') { this.seed = seed32(); this.order.clear(); this.rerender(); }
    if (act === 'save') this.save();
    if (act === 'copy') this.copy();
    if (act === 'paste') this.paste();
    if (act === 'reset') this.reset();
    if (act === 'learn') this.learn();
    if (act === 'mute') {
      const btn = e.target.closest('[data-act=mute]');
      const next = !this.audio.muted;
      this.audio.setMuted(next);
      btn.textContent = next ? 'sound off' : 'sound on';
    }
  }

  onInput(e) {
    const el = e.target;
    if (el.dataset.role === 'manualfiles') return this.importLayers([...el.files]);
    if (el.dataset.role === 'manualsid' || el.dataset.role === 'declayers') return;
    if (el.dataset.hide !== undefined) {
      const id = el.dataset.hide;
      el.checked ? this.hidden.delete(id) : this.hidden.add(id);
      return this.touch();
    }
    const path = el.dataset.c;
    if (!path) return;
    const [group, k] = path.split('.');
    const c = controlOf(group, k);
    if (!c) return;
    const store = this.settings[group];

    if (c.type === 'range2') {
      const i = Number(el.dataset.part);
      const v = Number(el.value);
      const cur = [...store[k]];
      cur[i] = v;
      // Dragging one handle past the other pushes rather than swaps -- swapping
      // mid-drag makes the slider fight your hand.
      if (cur[0] > cur[1]) cur[i === 0 ? 1 : 0] = v;
      store[k] = cur;
    } else if (c.type === 'macro') {
      const sk = el.dataset.part;
      if (sk) store[k].manual[sk] = Number(el.value);
      else store[k].m = Number(el.value);
    } else if (c.type === 'toggle') {
      store[k] = el.checked;
    } else if (c.type === 'multi') {
      const on = [...this.panel.querySelectorAll(`[data-c="${path}"]:checked`)].map((x) => x.value);
      store[k] = on.length ? on : store[k];
    } else if (c.type === 'select') {
      store[k] = el.value;
    } else {
      store[k] = c.type === 'int' ? Math.round(Number(el.value)) : Number(el.value);
    }

    // Switching modes changes which knobs exist, so the panel has to be rebuilt
    // rather than just re-read.
    if (path === 'global.mode') this.drawPanel();

    this.syncReadouts(group, k);
    this.touch();
  }

  /** Update the number beside a slider without redrawing the panel mid-drag. */
  syncReadouts(group, k) {
    const c = controlOf(group, k);
    const out = this.panel.querySelector(`[data-out="${group}.${k}"]`);
    if (out) out.textContent = readout(c, this.settings[group][k]);
    if (c.type === 'macro') {
      for (const s of c.subs) {
        const so = this.panel.querySelector(`[data-out="${group}.${k}.${s.k}"]`);
        if (so) so.textContent = fmt(sub(this.settings, `${group}.${k}`, s.k), s.unit);
        const row = this.panel.querySelector(`[data-subrow="${group}.${k}.${s.k}"]`);
        if (row) {
          const man = isManual(this.settings, `${group}.${k}`, s.k);
          row.classList.toggle('manual', man);
          const input = row.querySelector('input');
          if (input && !man) input.value = sub(this.settings, `${group}.${k}`, s.k);
        }
      }
    }
  }

  /** Debounced: a slider drag would otherwise recompose sixty times a second. */
  touch() {
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.rerender(), 130);
  }

  rerender() {
    if (this.pinned === false) this.seed = seed32();
    const common = {
      seed: this.seed,
      decay: get(this.settings, 'global.decay'),
      hidden: this.hidden,
    };
    // A sequence preview runs for real, from beat zero, every time a knob
    // moves. Pinning the seed is what makes two settings comparable: the same
    // beats come round in the same order and only the treatment differs.
    if (get(this.settings, 'global.mode') === 'sequence') {
      this.openStream({ ...common, replay: true, n: '—' });
      return;
    }
    const version = composeVersion(this.orb, this.settings, { ...common, order: this.order });
    version.n = '—';
    this.show(version).then(() => {
      if (this.tab === 'take') this.drawPanel();
    });
  }

  // ------------------------------------------------------------ panes ----

  drawPanel() {
    for (const b of this.root.querySelectorAll('[data-tab]')) {
      b.classList.toggle('on', b.dataset.tab === this.tab);
    }
    if (this.tab === 'recipe') this.panel.innerHTML = this.recipeHTML();
    else if (this.tab === 'take') this.panel.innerHTML = this.takeHTML();
    else this.panel.innerHTML = this.piecesHTML();
  }

  /**
   * Only the knobs the current mode can act on. A collage has no beat length
   * and a sequence has no stacking order, and leaving either on screen invites
   * you to spend an afternoon tuning something that is not connected to
   * anything. Nothing is deleted -- switch modes and it all comes back.
   */
  recipeHTML() {
    const mode = get(this.settings, 'global.mode');
    return SCHEMA.filter((g) => applies(g, mode)).map((g) => {
      const rows = g.controls
        .filter((c) => !(g.group === 'global' && c.k === 'decay'))   // lives in the transport
        .filter((c) => applies(c, mode))
        .map((c) => this.controlHTML(g.group, c))
        .join('');
      return `<section class="lab-group">
        <h3>${g.label}</h3>
        ${g.hint ? `<p class="lab-hint">${esc(g.hint)}</p>` : ''}
        ${rows}
      </section>`;
    }).join('');
  }

  controlHTML(group, c) {
    const path = `${group}.${c.k}`;
    const v = this.settings[group][c.k];
    const head = `<span class="lab-l">${esc(c.label)}${c.applies === 'new' ? ' <em class="tagnew">new orbs</em>' : ''}</span>
                  <b class="lab-v" data-out="${path}">${readout(c, v)}</b>`;
    const hint = c.hint ? `<p class="lab-hint">${esc(c.hint)}</p>` : '';

    switch (c.type) {
      case 'toggle':
        return `<label class="lab-row lab-toggle">
          <input type="checkbox" data-c="${path}"${v ? ' checked' : ''}>
          <span class="lab-l">${esc(c.label)}</span></label>${hint}`;

      case 'select':
        return `<div class="lab-row lab-col"><span class="lab-l">${esc(c.label)}</span>
          <select data-c="${path}">${c.options.map((o) =>
            `<option value="${o.v}"${o.v === v ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select></div>${hint}`;

      case 'multi':
        return `<div class="lab-row lab-col"><span class="lab-l">${esc(c.label)}</span>
          <div class="lab-chips">${c.options.map((o) =>
            `<label class="chipbox"><input type="checkbox" data-c="${path}" value="${o}"${
              v.includes(o) ? ' checked' : ''}><span>${esc(o)}</span></label>`).join('')}
          </div></div>${hint}`;

      case 'range2':
        return `<div class="lab-row lab-col"><div class="lab-head">${head}</div>
          <div class="lab-pair">
            <input type="range" data-c="${path}" data-part="0" min="${c.min}" max="${c.max}" step="${c.step}" value="${v[0]}">
            <input type="range" data-c="${path}" data-part="1" min="${c.min}" max="${c.max}" step="${c.step}" value="${v[1]}">
          </div></div>${hint}`;

      case 'macro': {
        const open = this.open2.has(path);
        const subs = !open ? '' : `<div class="lab-subs">${c.subs.map((s) => {
          const man = isManual(this.settings, path, s.k);
          return `<div class="lab-sub${man ? ' manual' : ''}" data-subrow="${path}.${s.k}">
            <div class="lab-head">
              <span class="lab-l">${esc(s.label)}</span>
              <b class="lab-v" data-out="${path}.${s.k}">${fmt(sub(this.settings, path, s.k), s.unit)}</b>
              ${man ? `<button class="autobtn" data-auto="${path}.${s.k}" title="follow the macro again">auto</button>` : ''}
            </div>
            <input type="range" data-c="${path}" data-part="${s.k}" min="${s.min}" max="${s.max}" step="${s.step}" value="${sub(this.settings, path, s.k)}">
            ${s.hint ? `<p class="lab-hint">${esc(s.hint)}</p>` : ''}
          </div>`;
        }).join('')}</div>`;
        return `<div class="lab-row lab-col">
          <div class="lab-head">${head}
            <button class="expand${open ? ' on' : ''}" data-macro="${path}" title="${open ? 'collapse' : 'break this out'}">${open ? '−' : '+'}</button>
          </div>
          <input type="range" data-c="${path}" min="${c.min}" max="${c.max}" step="${c.step}" value="${v.m}">
          ${hint}${subs}</div>`;
      }

      default:
        return `<div class="lab-row lab-col"><div class="lab-head">${head}</div>
          <input type="range" data-c="${path}" min="${c.min}" max="${c.max}" step="${c.step || 1}" value="${v}">
          </div>${hint}`;
    }
  }

  takeHTML() {
    if (get(this.settings, 'global.mode') === 'sequence') {
      return `<section class="lab-group">
        <h3>this take</h3>
        <p class="lab-hint">A sequence has nothing to stack — there is only ever one thing
          on the glass, and the order it arrives in is time, not depth. Rearranging by hand
          belongs to the collage. Switch <b>the whole memory → how it replays</b> to get it back.</p>
      </section>`;
    }
    const plates = [...(this.version?.plates || [])].sort((a, b) => b.z - a.z);
    if (!plates.length) return `<p class="lab-empty">nothing survived this roll.</p>`;
    const rows = plates.map((p, i) => `
      <li class="take-row">
        <span class="take-k">${p.k}</span>
        <span class="take-n">${esc(this.plateLabel(p))}</span>
        <span class="take-z">${p.z.toFixed(2)}</span>
        <button class="hudbtn tiny" data-move="${esc(plateKey(p))}" data-dir="-1"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="hudbtn tiny" data-move="${esc(plateKey(p))}" data-dir="1"${i === plates.length - 1 ? ' disabled' : ''}>↓</button>
      </li>`).join('');
    return `<section class="lab-group">
      <h3>this take</h3>
      <p class="lab-hint">Front of the stack at the top. This is the result the composer
        already made — rearranging it changes nothing about the recipe until you say so.</p>
      <ul class="take-list">${rows}</ul>
      <button class="hudbtn wide" data-act="learn">keep this arrangement</button>
      <p class="lab-hint">Reads your order back out as a stacking bias per medium, and
        narrows the jitter so the composer leans this way from now on.</p>
    </section>`;
  }

  /**
   * Semantic decomposition lives in the pieces pane because that is what it
   * produces: more pieces. The photo is scaled to the model's own working
   * resolution here rather than server-side -- the browser already has it
   * decoded, and 1024px is the ceiling the model works at anyway.
   */
  decomposeHTML() {
    const images = Object.entries(this.orb.sources).filter(([, s]) => s.kind === 'image');
    if (!images.length) return '';
    const rows = images.map(([sid, s]) => {
      const have = Object.values(this.orb.components)
        .filter((c) => c.src === sid && c.set === 'semantic').length;
      return `<div class="dec-row">
        <span class="lab-l">${esc(s.name || sid)}</span>
        ${have ? `<em class="tagnew">${have} layers</em>` : ''}
        <button class="hudbtn tiny" data-dec="${esc(sid)}">${have ? 're-cut' : 'decompose'}</button>
      </div>`;
    }).join('');
    return `<section class="lab-group">
      <h3>semantic layers</h3>
      <p class="lab-hint">Qwen-Image-Layered cuts a photo by <em>meaning</em> — subject, background,
        each object — and paints back in what every layer was hiding, so each one is whole.
        Switch <b>image → layers from</b> to see them instead of the derived ones.</p>
      <label class="lab-row lab-col"><span class="lab-l">layers to ask for</span>
        <input type="range" data-role="declayers" min="2" max="8" step="1" value="4">
        <span class="lab-hint">More layers means finer objects. Run it again on a busy
          photo to decompose further — that is recursive decomposition.</span>
      </label>
      ${rows}
      <p class="lab-hint" data-role="decnote"></p>
      <div class="dec-manual">
        <span class="lab-hint">No key? Run it through the free
          <a href="https://huggingface.co/spaces/Qwen/Qwen-Image-Layered" target="_blank" rel="noopener">Hugging Face Space</a>
          and drop the layer PNGs here — same result, same place.</span>
        <select data-role="manualsid">${images.map(([sid, s2]) =>
          `<option value="${esc(sid)}">${esc(s2.name || sid)}</option>`).join('')}</select>
        <input type="file" data-role="manualfiles" accept="image/png,image/webp" multiple>
      </div>
    </section>`;
  }

  /** Layer PNGs produced elsewhere, imported by hand. Filename order is layer order. */
  async importLayers(files) {
    const note = this.q('decnote');
    const sid = this.q('manualsid')?.value;
    if (!sid || !files.length) return;
    const body = new FormData();
    body.append('sid', sid);
    for (const f of files) body.append('files', f);
    note.textContent = `importing ${files.length} layers…`;
    const res = await fetch(`/api/orbs/${this.orb.id}/layers`, { method: 'POST', body });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { note.textContent = out.error || 'import failed'; return; }
    Object.assign(this.orb.components, out.components);
    this.settings.image.layerSet = 'semantic';
    note.textContent = `${out.added} layers imported.`;
    this.drawPanel();
    this.rerender();
  }

  async decompose(sid) {
    const src = this.orb.sources[sid];
    const note = this.q('decnote');
    const layers = Number(this.q('declayers')?.value || 4);
    note.textContent = 'scaling the photo…';
    try {
      const img = await loadImage(src.url);
      // 1024 is the model's high-quality mode; 640 is its fast, stabler one.
      const max = 1024;
      const k = Math.min(max / img.naturalWidth, max / img.naturalHeight, 1);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      note.textContent = `asking for ${layers} layers — this takes a minute…`;
      const res = await fetch(`/api/orbs/${this.orb.id}/decompose`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sid, layers, dataUrl: c.toDataURL('image/jpeg', 0.92) }),
      });
      const body = await res.json();
      if (!res.ok) { note.textContent = body.error || 'decomposition failed'; return; }
      Object.assign(this.orb.components, body.components);
      this.settings.image.layerSet = 'semantic';
      note.textContent = `${body.added} layers came back.`;
      this.drawPanel();
      this.rerender();
    } catch (err) {
      note.textContent = String(err.message || err);
    }
  }

  piecesHTML() {
    const groups = new Map();
    for (const [id, c] of Object.entries(this.orb.components)) {
      const key = KIND_LABEL[c.kind] || c.kind;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ id, c });
    }
    const here = this.player ? this.seen : new Set(this.version ? idsIn(this.version) : []);
    return this.decomposeHTML() + [...groups].map(([kind, items]) => `
      <section class="lab-group">
        <h3>${kind} <em>${items.filter((i) => !this.hidden.has(i.id)).length}/${items.length}</em></h3>
        ${items.map(({ id, c }) => `
          <label class="lab-row lab-toggle piece${here.has(id) ? ' present' : ''}">
            <input type="checkbox" data-hide="${esc(id)}"${this.hidden.has(id) ? '' : ' checked'}>
            <span class="lab-l">${esc(pieceLabel(c))}</span>
            ${c.set === 'semantic' ? '<em class="tagnew">qwen</em>' : ''}
          </label>`).join('')}
      </section>`).join('');
  }

  plateLabel(p) {
    if (p.k === 'image') return this.orb.sources[p.src]?.name || p.src;
    if (p.k === 'video') return this.orb.components[p.c]?.name || p.c;
    const first = this.orb.components[p.frags[0]?.c]?.text || '';
    return `“${first.slice(0, 30)}${first.length > 30 ? '…' : ''}” +${p.frags.length - 1}`;
  }

  // ------------------------------------------------------------ actions ---

  reorder(key, dir) {
    const plates = [...(this.version?.plates || [])].sort((a, b) => b.z - a.z);
    const i = plates.findIndex((p) => plateKey(p) === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= plates.length) return;
    [plates[i], plates[j]] = [plates[j], plates[i]];
    // Front of the list is the front of the stack, so the index inverts.
    const n = Math.max(1, plates.length - 1);
    this.order = new Map(plates.map((p, k) => [plateKey(p), n - k]));
    this.rerender();
  }

  /**
   * The one door from "this take" back into the recipe: average where each
   * medium ended up and make that its resting place, then tighten the jitter so
   * the lean is actually felt.
   */
  learn() {
    const plates = this.version?.plates || [];
    if (!plates.length) return;
    const by = { Image: [], Video: [], Text: [] };
    for (const p of plates) {
      const key = p.k === 'image' ? 'Image' : p.k === 'video' ? 'Video' : 'Text';
      by[key].push(p.z);
    }
    for (const [key, zs] of Object.entries(by)) {
      if (zs.length) this.settings.global[`z${key}`] = round(zs.reduce((a, b) => a + b, 0) / zs.length);
    }
    this.settings.global.zJitter = round(Math.max(0.08, get(this.settings, 'global.zJitter') * 0.6));
    this.order.clear();
    this.tab = 'recipe';
    this.drawPanel();
    this.flash('arrangement kept — stacking bias updated');
    this.rerender();
  }

  async save() {
    const res = await fetch(`/api/orbs/${this.orb.id}/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: this.settings }),
    });
    // The wall is shared, so a recipe is a property of the memory rather than
    // of whoever tuned it: this is how it comes back for everybody now.
    this.flash(res.ok ? 'recipe saved — this is how it comes back for everyone now' : 'save failed');
    if (res.ok) { this.orb.settings = this.settings; this.dirty = false; }
  }

  async copy() {
    const text = JSON.stringify(this.settings);
    try {
      await navigator.clipboard.writeText(text);
      this.flash('recipe copied — paste it into another orb');
    } catch {
      // Clipboard is gated on a secure context; a prompt still gets it across.
      window.prompt('copy this recipe', text);
    }
  }

  async paste() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { /* ask instead */ }
    if (!text) text = window.prompt('paste a recipe') || '';
    if (!text.trim()) return;
    try {
      this.settings = normalize(JSON.parse(text));
    } catch {
      return this.flash('that is not a recipe');
    }
    this.afterSwap('recipe pasted');
  }

  reset() {
    this.settings = defaults();
    this.hidden.clear();
    this.order.clear();
    this.afterSwap('back to the defaults');
  }

  afterSwap(msg) {
    const decay = this.q('decay');
    decay.value = get(this.settings, 'global.decay');
    this.q('decayval').textContent = `${Math.round(decay.value * 100)}%`;
    this.drawPanel();
    this.flash(msg);
    this.rerender();
  }

  flash(msg) {
    this.note = msg;
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => { this.note = ''; this.status(); }, 3200);
    this.status();
  }

  /** A sequence preview reports itself beat by beat rather than all at once. */
  onBeat(b) {
    for (const id of beatIds(b)) this.seen.add(id);
    this.sphere?.style.setProperty('--decay', b.decay);
    this.beat = b;
    if (b.flash) {
      this.sphere?.classList.add('flashing');
      setTimeout(() => this.sphere?.classList.remove('flashing'), 2600 / this.player.speed);
    }
    this.status();
    if (this.tab === 'pieces') this.drawPanel();
  }

  /** Overrides the HUD line: version numbers mean nothing in here. */
  status() {
    if (!this.sub) return;
    const v = this.version;
    const streaming = !!this.player;
    const n = streaming ? this.seen.size : v ? idsIn(v).length : 0;
    const total = Object.keys(this.orb.components).length;
    const bits = [
      streaming ? `beat ${(this.beat?.i ?? 0) + 1}` : null,
      `${n} of ${total} pieces`,
      `${Math.round(((streaming ? this.beat?.decay : v?.decay) || 0) * 100)}% faded`,
      `seed ${this.pinned ? this.seed : '—'}`,
    ].filter(Boolean);
    if (this.hidden.size) bits.push(`${this.hidden.size} hidden`);
    if (v?.flash || this.beat?.flash) bits.push('<span class="flashword">a vivid flash</span>');
    this.sub.innerHTML = bits.join(' · ') + (this.note ? ` · <span class="flashword">${esc(this.note)}</span>` : '');
  }
}

// `show()` writes the HUD line itself; in the lab that line says something else.
const baseShow = OrbView.prototype.show;
LabView.prototype.show = async function (version, opts) {
  await baseShow.call(this, version, opts);
  this.status();
};

function idsIn(version) {
  const ids = new Set();
  for (const p of version.plates || []) {
    if (p.k === 'image') for (const l of p.layers) ids.add(l.c);
    else if (p.k === 'video') ids.add(p.c);
    else if (p.k === 'text') for (const f of p.frags) ids.add(f.c);
  }
  for (const s of version.audio?.strands || []) ids.add(s.c);
  return [...ids];
}

function pieceLabel(c) {
  if (c.kind === 'textFragment') return `“${c.text.slice(0, 40)}${c.text.length > 40 ? '…' : ''}”`;
  return c.name || c.kind;
}

const round = (n) => Math.round(n * 1000) / 1000;

function fmt(v, unit) {
  const n = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
  return `${n}${unit || ''}`;
}

function readout(c, v) {
  if (c.type === 'range2') return `${fmt(v[0], c.unit)} – ${fmt(v[1], c.unit)}`;
  if (c.type === 'macro') return fmt(v.m);
  if (c.type === 'toggle') return v ? 'on' : 'off';
  if (c.type === 'int') return String(v);
  return fmt(v, c.unit);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
