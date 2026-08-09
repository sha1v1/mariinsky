// Renders one image-layer component into a canvas. Layers are static, so each
// one is built once and cached -- animation is only ever transform/opacity.
import { smoothstep } from './analyze.js';
<<<<<<< HEAD
import { applyShader, shaderKey } from './shaders.js';
=======
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8

const imgCache = new Map();
const layerCache = new Map();

export function loadImage(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
  imgCache.set(url, p);
  return p;
}

<<<<<<< HEAD
export function layerCanvas(orb, compId, maxPx = 880, shader = null) {
  const key = `${orb.id}:${compId}:${maxPx}:${shaderKey(shader)}`;
  if (layerCache.has(key)) return layerCache.get(key);
  const p = build(orb, compId, maxPx, shader).catch((err) => {
=======
export function layerCanvas(orb, compId, maxPx = 880) {
  const key = `${orb.id}:${compId}:${maxPx}`;
  if (layerCache.has(key)) return layerCache.get(key);
  const p = build(orb, compId, maxPx).catch((err) => {
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
    layerCache.delete(key);
    throw err;
  });
  layerCache.set(key, p);
  return p;
}

<<<<<<< HEAD
/**
 * The lab changes shader settings faster than the cache should keep up with, so
 * it prunes as it goes -- otherwise dragging one slider parks a few hundred
 * full-size canvases in memory.
 */
export function trimLayerCache(limit = 120) {
  while (layerCache.size > limit) layerCache.delete(layerCache.keys().next().value);
}

async function build(orb, compId, maxPx, shader) {
  const comp = orb.components[compId];
  const src = orb.sources[comp.src];

  // A semantic layer is already a finished cut-out with its own alpha -- there
  // is no mask to compute, only a picture to place. It is drawn at the parent's
  // aspect so it lines up with the derived layers of the same photo.
  if (comp.mode === 'rgba') {
    const layer = await loadImage(comp.url);
    const pw = src.w || layer.naturalWidth;
    const ph = src.h || layer.naturalHeight;
    const scale = Math.min(maxPx / pw, maxPx / ph, 1);
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(pw * scale));
    c.height = Math.max(2, Math.round(ph * scale));
    c.getContext('2d').drawImage(layer, 0, 0, c.width, c.height);
    return applyShader(c, shader);
  }

=======
async function build(orb, compId, maxPx) {
  const comp = orb.components[compId];
  const src = orb.sources[comp.src];
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
  const img = await loadImage(src.url);
  const scale = Math.min(maxPx / img.naturalWidth, maxPx / img.naturalHeight, 1);
  const w = Math.max(2, Math.round(img.naturalWidth * scale));
  const h = Math.max(2, Math.round(img.naturalHeight * scale));

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  if (comp.mode === 'shard') {
    maskShard(ctx, comp, w, h);
<<<<<<< HEAD
    return applyShader(c, shader);
=======
    return c;
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
  }

  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;

  if (comp.mode === 'tone') {
    const { lo, hi, feather, boost = 1 } = comp;
    for (let i = 0; i < d.length; i += 4) {
      const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      const a = smoothstep(lo - feather, lo + feather, L) * (1 - smoothstep(hi - feather, hi + feather, L));
      d[i + 3] = Math.round(d[i + 3] * a);
      if (boost !== 1 && a > 0) {
        d[i] = Math.min(255, d[i] * boost);
        d[i + 1] = Math.min(255, d[i + 1] * boost);
        d[i + 2] = Math.min(255, d[i + 2] * boost);
      }
    }
  } else if (comp.mode === 'chroma') {
    const [tr, tg, tb] = comp.target;
    const rad = comp.radius;
    for (let i = 0; i < d.length; i += 4) {
      const dist = Math.hypot(d[i] - tr, d[i + 1] - tg, d[i + 2] - tb);
      const a = 1 - smoothstep(rad * 0.5, rad, dist);
      d[i + 3] = Math.round(d[i + 3] * a);
    }
  } else if (comp.mode === 'edge') {
    const lum = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      lum[p] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    }
    const alpha = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        const gx = lum[p - 1 - w] + 2 * lum[p - 1] + lum[p - 1 + w] - lum[p + 1 - w] - 2 * lum[p + 1] - lum[p + 1 + w];
        const gy = lum[p - w - 1] + 2 * lum[p - w] + lum[p - w + 1] - lum[p + w - 1] - 2 * lum[p + w] - lum[p + w + 1];
        const g = Math.hypot(gx, gy) / 4;
        alpha[p] = Math.max(0, Math.min(1, (g * comp.gain - comp.thresh) / (1 - comp.thresh)));
      }
    }
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      d[i + 3] = Math.round(d[i + 3] * alpha[p]);
      d[i] = Math.min(255, d[i] * 1.35 + 30);
      d[i + 1] = Math.min(255, d[i + 1] * 1.35 + 30);
      d[i + 2] = Math.min(255, d[i + 2] * 1.35 + 30);
    }
  }

  ctx.putImageData(image, 0, 0);
<<<<<<< HEAD
  return applyShader(c, shader);
=======
  return c;
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
}

function maskShard(ctx, comp, w, h) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  const blur = Math.max(2, Math.min(w, h) * 0.02);
  try { ctx.filter = `blur(${blur}px)`; } catch { /* hard edges are an acceptable fallback */ }
  ctx.beginPath();
  const pts = comp.poly;
  ctx.moveTo(pts[0][0] * w, pts[0][1] * h);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * w, pts[i][1] * h);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();
}
