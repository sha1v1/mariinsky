import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { marbleColor } from './public/js/marble.js';

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The wall is the only thing here that has to survive a restart. Locally that
// is just the repo; on a host it is one mounted disk, so both trees hang off a
// single configurable root rather than two top-level directories.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : __dirname;
const ORBS = path.join(DATA_DIR, 'data', 'orbs');
const UPLOADS = path.join(DATA_DIR, 'uploads');
const PREP = path.join(UPLOADS, '_prep');
fs.mkdirSync(ORBS, { recursive: true });
fs.mkdirSync(PREP, { recursive: true });

const newId = () => crypto.randomBytes(6).toString('hex');
const isId = (id) => /^[a-f0-9]{12}$/.test(id);
const orbFile = (id) => path.join(ORBS, `${id}.json`);

async function readOrb(id) {
  if (!isId(id)) return null;
  try {
    return JSON.parse(await fsp.readFile(orbFile(id), 'utf8'));
  } catch {
    return null;
  }
}

async function allOrbs() {
  const names = (await fsp.readdir(ORBS)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const n of names) {
    const orb = await readOrb(n.replace('.json', ''));
    if (orb) out.push(orb);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Orb writes are read-modify-write, and a shared wall gets concurrent openings.
 * Two of them landing together used to interleave: the shorter payload
 * truncated the longer one and left its tail behind, producing a file that no
 * longer parsed -- a memory that reported itself gone. So writes go through a
 * per-id promise chain and land via a temp file and a rename, which is atomic.
 * A reader sees the old memory or the new one, never a spliced one.
 */
const writeChains = new Map();

function writeOrb(orb) {
  const prev = writeChains.get(orb.id) || Promise.resolve();
  const next = prev.then(async () => {
    const target = orbFile(orb.id);
    const tmp = `${target}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(orb));
    await fsp.rename(tmp, target);
  }).catch((err) => { console.error('orb write failed', orb.id, err); });
  writeChains.set(orb.id, next);
  next.finally(() => { if (writeChains.get(orb.id) === next) writeChains.delete(orb.id); });
  return next;
}

/** Serialise the whole read-modify-write, not just the write half. */
const orbLocks = new Map();

function withOrb(id, fn) {
  const prev = orbLocks.get(id) || Promise.resolve();
  const next = prev.then(fn, fn);
  orbLocks.set(id, next.catch(() => {}));
  return next;
}

// ffmpeg is a fallback only: it is used when the browser reports it cannot
// decode a file at all. Anything the browser can already play is left alone.
let FFMPEG = null;
try {
  const { stdout } = await run('/usr/bin/which', ['ffmpeg']);
  FFMPEG = stdout.trim() || null;
} catch { /* fallback simply is not available */ }

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
app.use('/files', express.static(UPLOADS, { maxAge: '1h' }));

function reserveOrb(req, res, next) {
  req._orbId = newId();
  req._n = 0;
  req._dir = path.join(UPLOADS, req._orbId);
  fs.mkdirSync(req._dir, { recursive: true });
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, req._dir),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').slice(0, 8).replace(/[^\w.]/g, '');
      cb(null, `${String(req._n++).padStart(2, '0')}${ext}`);
    },
  }),
  limits: { fileSize: 512 * 1024 * 1024, files: 48, fieldSize: 32 * 1024 * 1024 },
});

const prepUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PREP),
    filename: (req, file, cb) => {
      req._prepId = newId();
      const ext = (path.extname(file.originalname) || '').slice(0, 10).replace(/[^\w.]/g, '');
      cb(null, `${req._prepId}.src${ext}`);
    },
  }),
  limits: { fileSize: 512 * 1024 * 1024, files: 1 },
});

app.post('/api/prepare', prepUpload.single('file'), async (req, res) => {
  if (!FFMPEG) return res.status(503).json({ error: 'ffmpeg is not installed on this machine' });
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const kind = ['image', 'video', 'audio'].includes(req.body.kind) ? req.body.kind : 'video';
  const src = req.file.path;
  const ext = kind === 'image' ? 'jpg' : kind === 'audio' ? 'm4a' : 'mp4';
  const outName = `${req._prepId}.${ext}`;
  const out = path.join(PREP, outName);

  const args = kind === 'image'
    ? ['-y', '-i', src, '-frames:v', '1', '-q:v', '3', out]
    : kind === 'audio'
      ? ['-y', '-i', src, '-vn', '-c:a', 'aac', '-b:a', '192k', out]
      : ['-y', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
         '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '160k', out];

  try {
    await run(FFMPEG, args, { timeout: 10 * 60 * 1000, maxBuffer: 1 << 24 });
  } catch (err) {
    await fsp.rm(src, { force: true });
    return res.status(422).json({ error: 'ffmpeg could not convert this file', detail: String(err.stderr || err.message).slice(-600) });
  }
  await fsp.rm(src, { force: true });

  const probe = await probeMedia(out);
  res.json({ prepId: outName, url: `/files/_prep/${outName}`, kind, ...probe });
});

async function probeMedia(file) {
  const ffprobe = FFMPEG ? FFMPEG.replace(/ffmpeg$/, 'ffprobe') : null;
  if (!ffprobe) return { duration: 0, w: 0, h: 0, hasAudio: false };
  try {
    const { stdout } = await run(ffprobe, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file]);
    const info = JSON.parse(stdout);
    const v = (info.streams || []).find((s) => s.codec_type === 'video');
    const a = (info.streams || []).find((s) => s.codec_type === 'audio');
    return { duration: Number(info.format?.duration) || 0, w: v?.width || 0, h: v?.height || 0, hasAudio: !!a };
  } catch {
    return { duration: 0, w: 0, h: 0, hasAudio: false };
  }
}

async function adoptPrepared(prepId, destDir) {
  if (!/^[a-f0-9]{12}\.(mp4|m4a|jpg)$/.test(prepId)) return null;
  try {
    await fsp.rename(path.join(PREP, prepId), path.join(destDir, prepId));
    return prepId;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- the wall ---

/**
 * The one line of the memory that stands for it on the wall: the title if it
 * was given one, otherwise the first thing the contributor wrote.
 */
function caption(orb) {
  if (orb.title && orb.title !== 'untitled memory') return orb.title;
  const card = Object.values(orb.sources).find((s) => s.kind === 'text' && s.text);
  if (card) return card.text.split('\n')[0].slice(0, 90);
  return 'a moment with no words';
}

/**
 * A memory's hover preview: a couple of seconds of its own recorded sound. The
 * window is one of the audio components already cut at contribution time, so
 * the preview is a real piece of the input, not a summary of it.
 */
function previewOf(orb) {
  const windows = Object.entries(orb.components).filter(([, c]) => c.kind === 'audioWindow');
  if (!windows.length) return null;
  const [, comp] = windows[Math.floor(windows.length / 2)];
  const src = orb.sources[comp.src];
  if (!src?.url) return null;
  return { url: src.url, start: comp.start, end: Math.min(comp.end, comp.start + 3) };
}

function summarize(orb) {
  const counts = { image: 0, video: 0, audio: 0, text: 0 };
  for (const s of Object.values(orb.sources)) counts[s.kind] = (counts[s.kind] || 0) + 1;
  return {
    id: orb.id,
    title: caption(orb),
    marble: orb.marble || orb.glow,
    glow: orb.glow,
    emotion: orb.emotion || 'neutral',
    analysis: orb.analysis || null,
    decay: orb.decay,
    createdAt: orb.createdAt,
    openings: orb.versions.length,
    lastOpened: orb.versions.at(-1)?.at || null,
    counts,
    fragments: Object.keys(orb.components).length,
    preview: previewOf(orb),
  };
}

/**
 * Older memories -- and any seeded by hand -- may predate the marble field.
 * Assign one the same way a new contribution would, from whatever was already
 * on the wall when it arrived, and write it back so it never moves again.
 */
async function backfill(orbs) {
  const palette = [];
  let dirty = false;
  for (const orb of orbs) {
    if (!orb.marble) {
      orb.marble = marbleColor(orb.id, palette.slice());
      await writeOrb(orb);
      dirty = true;
    }
    palette.push(orb.marble);
  }
  return dirty;
}

app.get('/api/wall', async (_req, res) => {
  const orbs = await allOrbs();
  await backfill(orbs);
  res.json(orbs.map(summarize).reverse());
});

// Kept for compatibility with the orb prototype's own routes.
app.get('/api/orbs', async (_req, res) => {
  const orbs = await allOrbs();
  await backfill(orbs);
  res.json(orbs.map(summarize).reverse());
});

/**
 * Live figures for the panel in the corner of the garden. Everything here is
 * counted off the stored memories at request time -- nothing is precomputed
 * and nothing is invented.
 */
app.get('/api/stats', async (_req, res) => {
  const orbs = await allOrbs();
  const emotions = {};
  let openings = 0, fragments = 0, decaySum = 0;
  const byDay = {};
  for (const orb of orbs) {
    const e = orb.emotion || 'neutral';
    emotions[e] = (emotions[e] || 0) + 1;
    openings += orb.versions.length;
    fragments += Object.keys(orb.components).length;
    decaySum += orb.decay || 0;
    const day = new Date(orb.createdAt).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
  }
  const recent = orbs.slice(-8).reverse().map((o) => ({
    id: o.id, title: caption(o), marble: o.marble, emotion: o.emotion || 'neutral', at: o.createdAt,
  }));
  res.json({
    memories: orbs.length,
    openings,
    fragments,
    faded: orbs.length ? decaySum / orbs.length : 0,
    emotions,
    byDay,
    recent,
    palette: orbs.map((o) => o.marble).filter(Boolean),
    now: Date.now(),
  });
});

app.post('/api/orbs', reserveOrb, upload.array('files'), async (req, res) => {
  let manifest;
  try {
    manifest = JSON.parse(req.body.manifest);
  } catch {
    return res.status(400).json({ error: 'malformed manifest' });
  }

  const files = req.files || [];
  const sources = {};
  for (const [sid, s] of Object.entries(manifest.sources || {})) {
    const out = { kind: s.kind };
    if (s.kind === 'text') {
      out.text = String(s.text || '').slice(0, 40000);
      out.label = String(s.label || '').slice(0, 80);
    } else if (s.prepId) {
      const prepped = await adoptPrepared(s.prepId, req._dir);
      if (!prepped) continue;
      out.url = `/files/${req._orbId}/${prepped}`;
      out.name = String(s.name || prepped).slice(0, 120);
      out.converted = true;
    } else {
      const f = files[s.fileIndex];
      if (!f) continue;
      out.url = `/files/${req._orbId}/${f.filename}`;
      out.name = String(s.name || f.originalname).slice(0, 120);
      out.mime = f.mimetype;
      out.bytes = f.size;
    }
    if (s.kind !== 'text') {
      if (s.w) { out.w = s.w; out.h = s.h; }
      if (s.duration) out.duration = s.duration;
      if (s.analysis) out.analysis = s.analysis;
      if (s.hasAudio != null) out.hasAudio = !!s.hasAudio;
    }
    sources[sid] = out;
  }

  // The colour is drawn from the marbles that were already here when this one
  // arrived, then frozen -- a marble does not change colour as the wall grows.
  const existing = await allOrbs();
  await backfill(existing);
  const palette = existing.map((o) => o.marble).filter(Boolean);

  const orb = {
    id: req._orbId,
    title: String(manifest.title || 'untitled memory').slice(0, 120),
    createdAt: Date.now(),
    glow: /^#[0-9a-f]{6}$/i.test(manifest.glow || '') ? manifest.glow : '#8fa9ff',
    marble: marbleColor(req._orbId, palette),
    emotion: String(manifest.emotion || 'neutral').slice(0, 20),
    analysis: manifest.analysis || null,
    decay: 0,
    // What past sittings wore off permanently, on top of the opening count.
    strain: 0,
    sources,
    components: manifest.components || {},
    // How this memory replays. Stored raw; the client normalises it against the
    // schema on the way in, so a stale blob can never reach the composer.
    settings: manifest.settings && typeof manifest.settings === 'object' ? manifest.settings : null,
    versions: [],
  };

  await writeOrb(orb);
  res.json({ id: orb.id, marble: orb.marble });
});

app.get('/api/orbs/:id', async (req, res) => {
  const orb = await readOrb(req.params.id);
  if (!orb) return res.status(404).json({ error: 'no such orb' });
  res.json(orb);
});

// A new version is composed in the browser (that is where the RNG and the
// renderer live); the server appends the recipe and tracks the decay.
app.post('/api/orbs/:id/versions', async (req, res) => {
  const v = req.body?.version;
  // A collage version carries its whole arrangement; a sequence carries a seed
  // and is generated back out of it. Both are versions.
  const ok = v && (Array.isArray(v.plates) || (v.mode === 'seq' && Number.isFinite(v.seed)));
  if (!ok) return res.status(400).json({ error: 'malformed version' });
  await withOrb(req.params.id, async () => {
    const orb = await readOrb(req.params.id);
    if (!orb) return res.status(404).json({ error: 'no such orb' });
    v.n = orb.versions.length + 1;
    v.at = Date.now();
    orb.versions.push(v);
    orb.decay = typeof v.decay === 'number' ? v.decay : orb.decay;
    await writeOrb(orb);
    res.json({ n: v.n, at: v.at, decay: orb.decay });
  });
});

/**
 * A sequence runs until you leave, so how much of it you actually saw is not
 * known when it starts. This is the write-back: how many beats, what it had
 * shown you, and the strain the sitting left behind.
 *
 * Strain is the part that sticks. It accumulates across openings on top of the
 * decay curve, and is capped so that one very patient visitor cannot rot a
 * memory off the wall in an afternoon.
 *
 * POST as well as PATCH, and that is not tidiness: the usual way to leave is to
 * close the tab, where the only request that survives is `navigator.sendBeacon`
 * -- and a beacon is always a POST. Accepting only PATCH loses the write-back
 * in exactly the case it matters most.
 */
app.route('/api/orbs/:id/versions/:n').patch(writeBack).post(writeBack);

async function writeBack(req, res) {
  const n = Number(req.params.n);
  const { beats, decay, strain, seen } = req.body || {};
  await withOrb(req.params.id, async () => {
    const orb = await readOrb(req.params.id);
    if (!orb) return res.status(404).json({ error: 'no such orb' });
    const v = orb.versions.find((x) => x.n === n);
    if (!v) return res.status(404).json({ error: 'no such version' });
    if (Number.isFinite(beats)) v.beats = Math.max(0, Math.round(beats));
    if (Array.isArray(seen)) v.seen = seen.filter((id) => orb.components[id]).slice(0, 400);
    if (Number.isFinite(decay)) { v.decay = clamp01(decay); orb.decay = v.decay; }
    if (Number.isFinite(strain)) orb.strain = Math.min(0.3, (orb.strain || 0) + Math.max(0, strain));
    await writeOrb(orb);
    res.json({ n, decay: orb.decay, strain: orb.strain || 0 });
  });
}

const clamp01 = (v) => Math.max(0, Math.min(0.94, v));

// ------------------------------------------------------------ the recipe ---

/**
 * The laboratory saves its recipe here. Settings never touch the version
 * history -- they are how the *next* opening gets composed, not a record of a
 * past one.
 *
 * Note what this means on a shared wall: a recipe is a property of the memory,
 * not of the person tuning it, so saving one changes how that memory comes back
 * for everybody. That is the same bargain as the decay itself.
 */
app.put('/api/orbs/:id/settings', async (req, res) => {
  const s = req.body?.settings;
  if (!s || typeof s !== 'object') return res.status(400).json({ error: 'malformed settings' });
  await withOrb(req.params.id, async () => {
    const orb = await readOrb(req.params.id);
    if (!orb) return res.status(404).json({ error: 'no such orb' });
    orb.settings = s;
    await writeOrb(orb);
    res.json({ ok: true });
  });
});

// -------------------------------------------------- semantic decomposition --
//
// Qwen-Image-Layered splits one flat photo into complete RGBA layers -- subject,
// background, individual objects -- and paints back in whatever each layer was
// hiding, so every layer stands on its own. That is a different thing from the
// tonal/chroma/shard layers this app measures for itself: those cut by
// distribution, these cut by meaning.
//
// It is a 20B model, so it runs on somebody else's GPU. fal hosts it behind a
// queue: submit, poll, collect. The image goes over as a data URI, already
// scaled to the model's own working resolution by the browser, which saves an
// upload round-trip and keeps this route dependency-free.
const FAL_KEY = process.env.FAL_KEY || '';
const FAL_MODEL = process.env.FAL_MODEL || 'fal-ai/qwen-image-layered';
const FAL_BASE = process.env.FAL_BASE || 'https://queue.fal.run';

const falHeaders = () => ({ Authorization: `Key ${FAL_KEY}`, 'content-type': 'application/json' });

async function falDecompose({ dataUrl, layers, seed, onStatus }) {
  const submit = await fetch(`${FAL_BASE}/${FAL_MODEL}`, {
    method: 'POST',
    headers: falHeaders(),
    body: JSON.stringify({
      image_url: dataUrl,
      num_layers: layers,
      output_format: 'png',
      ...(seed != null ? { seed } : {}),
    }),
  });
  const queued = await submit.json().catch(() => ({}));
  if (!submit.ok) {
    throw new Error(`fal rejected the request (${submit.status}): ${JSON.stringify(queued).slice(0, 400)}`);
  }

  const statusUrl = queued.status_url || `${FAL_BASE}/${FAL_MODEL}/requests/${queued.request_id}/status`;
  const responseUrl = queued.response_url || `${FAL_BASE}/${FAL_MODEL}/requests/${queued.request_id}`;

  // Decomposition is tens of seconds, and a cold queue can be minutes.
  const deadline = Date.now() + 8 * 60 * 1000;
  let status = queued.status;
  while (status !== 'COMPLETED') {
    if (Date.now() > deadline) throw new Error('fal did not finish within eight minutes');
    await new Promise((r) => setTimeout(r, 2500));
    const s = await fetch(statusUrl, { headers: falHeaders() });
    const body = await s.json().catch(() => ({}));
    status = body.status;
    if (status === 'FAILED' || body.error) {
      throw new Error(`fal failed: ${JSON.stringify(body.error || body).slice(0, 400)}`);
    }
    onStatus?.(status, body.queue_position);
  }

  const done = await fetch(responseUrl, { headers: falHeaders() });
  const result = await done.json().catch(() => ({}));
  if (!done.ok) throw new Error(`fal result unreadable (${done.status})`);
  const images = result.images || result.layers || [];
  if (!images.length) throw new Error('fal returned no layers');
  return images;
}

app.post('/api/orbs/:id/decompose', async (req, res) => {
  if (!FAL_KEY) {
    return res.status(503).json({
      error: 'no FAL_KEY set. Put your fal.ai key in a .env or export it before npm start, ' +
             'or use the manual route: run the image through the free Hugging Face Space and upload the layer PNGs.',
    });
  }
  const { sid, dataUrl, layers } = req.body || {};
  const n = Math.min(8, Math.max(2, Number(layers) || 4));
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return res.status(400).json({ error: 'expected a data: image URL' });
  }

  const orb = await readOrb(req.params.id);
  if (!orb) return res.status(404).json({ error: 'no such orb' });
  if (orb.sources[sid]?.kind !== 'image') return res.status(400).json({ error: 'no such image source' });

  let images;
  try {
    images = await falDecompose({ dataUrl, layers: n });
  } catch (err) {
    console.error('decompose failed', err);
    return res.status(502).json({ error: String(err.message || err) });
  }

  // Pull the layers down to sit beside the original. Layer order is the model's
  // own: index 0 is furthest back.
  const dir = path.join(UPLOADS, orb.id, 'qwen');
  await fsp.mkdir(dir, { recursive: true });
  const added = {};
  for (let i = 0; i < images.length; i++) {
    const url = images[i]?.url;
    if (!url) continue;
    const got = await fetch(url);
    if (!got.ok) continue;
    const name = `${sid}-${i}.png`;
    await fsp.writeFile(path.join(dir, name), Buffer.from(await got.arrayBuffer()));
    added[`${sid}::q${i}`] = {
      kind: 'imageLayer',
      src: sid,
      mode: 'rgba',
      set: 'semantic',
      url: `/files/${orb.id}/qwen/${name}`,
      z: i,
      name: i === 0 ? 'what was behind it all' : `a thing in it (${i})`,
      hint: 'normal',
    };
  }
  if (!Object.keys(added).length) return res.status(502).json({ error: 'no layers could be saved' });

  await withOrb(orb.id, async () => {
    const fresh = await readOrb(orb.id);
    if (!fresh) return res.status(404).json({ error: 'no such orb' });
    Object.assign(fresh.components, added);
    await writeOrb(fresh);
    res.json({ added: Object.keys(added).length, components: added });
  });
});

/**
 * The keyless route to the same place: run the photo through the free Hugging
 * Face Space yourself, then hand the layer PNGs over here. Order is filename
 * order, which is the order the Space exports them in -- back to front.
 */
const layerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 12 },
});

app.post('/api/orbs/:id/layers', layerUpload.array('files'), async (req, res) => {
  const orb = await readOrb(req.params.id);
  if (!orb) return res.status(404).json({ error: 'no such orb' });
  const sid = req.body?.sid;
  if (orb.sources[sid]?.kind !== 'image') return res.status(400).json({ error: 'no such image source' });
  const files = (req.files || []).filter((f) => /png|webp/i.test(f.mimetype));
  if (!files.length) return res.status(400).json({ error: 'expected transparent PNGs' });

  const dir = path.join(UPLOADS, orb.id, 'qwen');
  await fsp.mkdir(dir, { recursive: true });
  files.sort((a, b) => a.originalname.localeCompare(b.originalname, undefined, { numeric: true }));

  const added = {};
  // Offset by whatever is already there, so a second import extends rather
  // than silently overwriting the first.
  const base = Object.keys(orb.components).filter((k) => k.startsWith(`${sid}::q`)).length;
  for (let i = 0; i < files.length; i++) {
    const name = `${sid}-m${base + i}.png`;
    await fsp.writeFile(path.join(dir, name), files[i].buffer);
    added[`${sid}::q${base + i}`] = {
      kind: 'imageLayer', src: sid, mode: 'rgba', set: 'semantic',
      url: `/files/${orb.id}/qwen/${name}`,
      z: base + i,
      name: files[i].originalname.replace(/\.[^.]+$/, ''),
      hint: 'normal',
    };
  }

  await withOrb(orb.id, async () => {
    const fresh = await readOrb(orb.id);
    if (!fresh) return res.status(404).json({ error: 'no such orb' });
    Object.assign(fresh.components, added);
    await writeOrb(fresh);
    res.json({ added: Object.keys(added).length, components: added });
  });
});

// The garden is a shared wall, so a memory can only be pulled out of it with
// the moderation key -- not by whoever happens to be looking at it.
app.delete('/api/orbs/:id', async (req, res) => {
  const key = process.env.MODERATION_KEY;
  if (!key || req.get('x-moderation-key') !== key) {
    return res.status(403).json({ error: 'the garden is shared; memories are not removable from the page' });
  }
  const orb = await readOrb(req.params.id);
  if (!orb) return res.status(404).json({ error: 'no such orb' });
  await fsp.rm(orbFile(orb.id), { force: true });
  await fsp.rm(path.join(UPLOADS, orb.id), { recursive: true, force: true });
  res.json({ ok: true });
});

async function sweepPrep() {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const name of await fsp.readdir(PREP).catch(() => [])) {
    const f = path.join(PREP, name);
    const st = await fsp.stat(f).catch(() => null);
    if (st && st.mtimeMs < cutoff) await fsp.rm(f, { force: true });
  }
}
sweepPrep();

const PORT = process.env.PORT || 5173;
app.listen(PORT, () => {
  console.log(`\n  mariinsky  →  http://localhost:${PORT}`);
  console.log(`  wall storage: ${DATA_DIR}`);
  console.log(`  ffmpeg fallback: ${FFMPEG || 'not installed (undecodable files will be skipped)'}\n`);
});
