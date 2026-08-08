// Renders one image-layer component into a canvas. Layers are static, so each
// one is built once and cached -- animation is only ever transform/opacity.
import { smoothstep } from './analyze.js';

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

export function layerCanvas(orb, compId, maxPx = 880) {
  const key = `${orb.id}:${compId}:${maxPx}`;
  if (layerCache.has(key)) return layerCache.get(key);
  const p = build(orb, compId, maxPx).catch((err) => {
    layerCache.delete(key);
    throw err;
  });
  layerCache.set(key, p);
  return p;
}

async function build(orb, compId, maxPx) {
  const comp = orb.components[compId];
  const src = orb.sources[comp.src];
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
    return c;
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
  return c;
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
