// Turn the photographic asset library into page-sized cut-outs.
//
// The originals are 4096x4096 RGB photographs on white, 1.5-22 MB each -- 660 MB
// for the set, which is not something a wall can serve. Each one comes out of
// here as a trimmed RGBA cut-out at ITEM_PX, a few tens of kilobytes, with the
// white keyed out so it sits *on* the paper instead of in a white box on it.
//
// No image dependency on purpose: `sips` (macOS, already there) does the only
// expensive part -- decoding a 16-megapixel PNG -- and the keying, trimming and
// box-downsampling are done here against `zlib`, which node ships. Adding sharp
// to a project whose whole dependency list is express and multer, for a script
// that runs once, is not a trade worth making.
//
//   node scripts/items.mjs            # only what is missing
//   node scripts/items.mjs --force    # all of it again
//
// Writes public/images/items/<slug>.png and public/images/items/index.json.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const SRC_DIRS = [
  process.env.ITEM_SRC,
  path.resolve(ROOT, '../assets'),
  path.resolve(ROOT, 'assets'),
].filter(Boolean);

const OUT_DIR = path.join(ROOT, 'public/images/items');

const WORK_PX = 1024;   // what sips decodes down to before we key it
const ITEM_PX = 256;    // the long edge of a finished cut-out
const PAD = 2;          // transparent pixels kept around the trimmed object
const WHITE = 245;      // at or above this on every channel is paper, not object

// ---------------------------------------------------------------- png in ---

/** Decode a non-interlaced 8-bit PNG (grey/RGB/grey+A/RGBA) to flat RGBA. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let o = 8;
  let w = 0, h = 0, color = 0, depth = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const body = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      depth = body[8];
      color = body[9];
      if (depth !== 8) throw new Error(`bit depth ${depth} unsupported`);
      if (body[12] !== 0) throw new Error('interlaced png unsupported');
      if (![0, 2, 4, 6].includes(color)) throw new Error(`colour type ${color} unsupported`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    o += 12 + len;
  }

  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(h * stride);

  // undo the per-scanline filters
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? out[i - ch] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = v & 255;
    }
  }

  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    const s = i * ch, d = i * 4;
    if (ch === 1) { rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]; rgba[d + 3] = 255; }
    else if (ch === 2) { rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]; rgba[d + 3] = px[s + 1]; }
    else if (ch === 3) { rgba[d] = px[s]; rgba[d + 1] = px[s + 1]; rgba[d + 2] = px[s + 2]; rgba[d + 3] = 255; }
    else { rgba.set(px.subarray(s, s + 4), d); }
  }
  return { w, h, rgba };
}

// --------------------------------------------------------------- png out ---

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 1;                       // Sub: cheap and good on photos
    const src = rgba.subarray(y * stride, (y + 1) * stride);
    const dst = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) dst[i] = (src[i] - (i >= 4 ? src[i - 4] : 0)) & 255;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------- the work ---

/**
 * Key the white out. Only background *connected to the edge of the frame* is
 * removed, by flood fill -- a threshold applied to every pixel would punch
 * holes through the white of a sand dollar or a daisy.
 */
function keyWhite(w, h, rgba) {
  const bg = new Uint8Array(w * h);
  const isPaper = (i) => rgba[i * 4] >= WHITE && rgba[i * 4 + 1] >= WHITE && rgba[i * 4 + 2] >= WHITE;
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    if (bg[i] || !isPaper(i)) continue;
    bg[i] = 1;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  for (let i = 0; i < w * h; i++) if (bg[i]) rgba[i * 4 + 3] = 0;
  return rgba;
}

/** The box the object actually occupies, plus a hair of padding. */
function alphaBox(w, h, rgba) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  x0 = Math.max(0, x0 - PAD); y0 = Math.max(0, y0 - PAD);
  x1 = Math.min(w - 1, x1 + PAD); y1 = Math.min(h - 1, y1 + PAD);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Box filter down to the finished size, averaging in premultiplied alpha.
 * Averaging straight RGBA would drag the colour of fully transparent pixels
 * into the edge, which on a white-keyed photograph means a white fringe.
 */
function resample(src, sw, sh, box, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy0 = box.y + Math.floor((y * box.h) / dh);
    const sy1 = Math.max(sy0 + 1, box.y + Math.floor(((y + 1) * box.h) / dh));
    for (let x = 0; x < dw; x++) {
      const sx0 = box.x + Math.floor((x * box.w) / dw);
      const sx1 = Math.max(sx0 + 1, box.x + Math.floor(((x + 1) * box.w) / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = sy0; yy < sy1; yy++) {
        for (let xx = sx0; xx < sx1; xx++) {
          const i = (yy * sw + xx) * 4;
          const al = src[i + 3] / 255;
          r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += src[i + 3];
          n++;
        }
      }
      const d = (y * dw + x) * 4;
      const am = a / n;
      out[d + 3] = Math.round(am);
      if (am > 0.5) {
        const k = n * (am / 255);
        out[d] = Math.min(255, Math.round(r / k));
        out[d + 1] = Math.min(255, Math.round(g / k));
        out[d + 2] = Math.min(255, Math.round(b / k));
      }
    }
  }
  return out;
}

const slug = (name) => name.replace(/\.png$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function main() {
  const force = process.argv.includes('--force');
  const src = SRC_DIRS.find((d) => fs.existsSync(d));
  if (!src) {
    console.error(`no asset directory found. looked in:\n  ${SRC_DIRS.join('\n  ')}`);
    console.error('set ITEM_SRC=/path/to/assets and run again.');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mariinsky-items-'));
  const files = fs.readdirSync(src).filter((f) => /\.png$/i.test(f) && !f.startsWith('.')).sort();

  const index = [];
  for (const file of files) {
    const id = slug(file);
    const out = path.join(OUT_DIR, `${id}.png`);
    const label = file.replace(/\.png$/i, '');

    if (!force && fs.existsSync(out)) {
      const { w, h } = decodePng(fs.readFileSync(out));
      index.push({ id, label, w, h });
      process.stdout.write(`  = ${id}\n`);
      continue;
    }

    const work = path.join(tmp, `${id}.png`);
    execFileSync('sips', ['-s', 'format', 'png', '-Z', String(WORK_PX), '--out', work, path.join(src, file)], { stdio: 'ignore' });

    const { w, h, rgba } = decodePng(fs.readFileSync(work));
    keyWhite(w, h, rgba);
    const box = alphaBox(w, h, rgba);
    const k = ITEM_PX / Math.max(box.w, box.h);
    const dw = Math.max(1, Math.round(box.w * k));
    const dh = Math.max(1, Math.round(box.h * k));
    fs.writeFileSync(out, encodePng(dw, dh, resample(rgba, w, h, box, dw, dh)));
    fs.rmSync(work, { force: true });

    index.push({ id, label, w: dw, h: dh });
    process.stdout.write(`  + ${id}  ${dw}x${dh}  ${(fs.statSync(out).size / 1024).toFixed(0)}kb\n`);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const total = index.reduce((s, it) => s + fs.statSync(path.join(OUT_DIR, `${it.id}.png`)).size, 0);
  console.log(`\n${index.length} items, ${(total / 1024 / 1024).toFixed(1)} MB total -> public/images/items/`);
}

main();
