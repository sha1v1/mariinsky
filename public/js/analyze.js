// Everything here runs in the browser at upload time. No native deps, no API
// calls -- just canvas pixel work that turns a file into a small analysis blob.

export function fileKind(file) {
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

/** Accepts a File or a URL (a converted file already sitting on the server). */
export function loadImageFile(source) {
  return new Promise((resolve, reject) => {
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode image'));
    img.src = url;
  });
}

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
};

/**
 * Image analysis: luminance histogram, dominant colour clusters, and a coarse
 * edge-energy grid. This is what the layer recipes are derived from, so it has
 * to behave on landscapes, faces and total nonsense alike -- which is why it
 * only measures distributions, never tries to recognise anything.
 */
export function analyzeImage(img) {
  const N = 320;
  const scale = Math.min(N / img.naturalWidth, N / img.naturalHeight, 1);
  const w = Math.max(2, Math.round(img.naturalWidth * scale));
  const h = Math.max(2, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  const hist = new Array(64).fill(0);
  const lum = new Float32Array(w * h);
  const samples = [];
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    lum[p] = L;
    hist[Math.min(63, Math.floor(L * 64))]++;
    if (p % 3 === 0 && d[i + 3] > 24) samples.push([d[i], d[i + 1], d[i + 2]]);
  }

  const palette = kmeans(samples, 5, 12);

  const G = 16;
  const edges = new Array(G * G).fill(0);
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const x0 = Math.floor((gx * w) / G), x1 = Math.floor(((gx + 1) * w) / G);
      const y0 = Math.floor((gy * h) / G), y1 = Math.floor(((gy + 1) * h) / G);
      let acc = 0, n = 0;
      for (let yy = y0 + 1; yy < y1 - 1; yy++) {
        for (let xx = x0 + 1; xx < x1 - 1; xx++) {
          const i = yy * w + xx;
          acc += Math.hypot(lum[i + 1] - lum[i - 1], lum[i + w] - lum[i - w]);
          n++;
        }
      }
      edges[gy * G + gx] = n ? Math.round((acc / n) * 1000) / 1000 : 0;
    }
  }

  const total = w * h;
  return {
    w: img.naturalWidth,
    h: img.naturalHeight,
    hist: hist.map((v) => Math.round((v / total) * 10000) / 10000),
    palette,
    edges,
    glow: glowFromPalette(palette),
  };
}

function kmeans(samples, k, iters) {
  if (!samples.length) return [];
  const cents = [];
  for (let i = 0; i < k; i++) cents.push(samples[Math.floor((i + 0.5) * samples.length / k)].slice());
  const assign = new Int8Array(samples.length);
  for (let it = 0; it < iters; it++) {
    for (let s = 0; s < samples.length; s++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < cents.length; c++) {
        const dr = samples[s][0] - cents[c][0];
        const dg = samples[s][1] - cents[c][1];
        const db = samples[s][2] - cents[c][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bd) { bd = dist; best = c; }
      }
      assign[s] = best;
    }
    const sums = cents.map(() => [0, 0, 0, 0]);
    for (let s = 0; s < samples.length; s++) {
      const a = sums[assign[s]];
      a[0] += samples[s][0]; a[1] += samples[s][1]; a[2] += samples[s][2]; a[3]++;
    }
    for (let c = 0; c < cents.length; c++) {
      if (sums[c][3] > 0) {
        cents[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
      }
    }
  }
  const counts = cents.map(() => 0);
  for (let s = 0; s < samples.length; s++) counts[assign[s]]++;
  // Spread tells us how tight a cluster is; the layer mask radius follows it.
  const spread = cents.map(() => 0);
  for (let s = 0; s < samples.length; s++) {
    const c = assign[s];
    spread[c] += Math.hypot(samples[s][0] - cents[c][0], samples[s][1] - cents[c][1], samples[s][2] - cents[c][2]);
  }
  return cents
    .map((c, i) => ({
      r: Math.round(c[0]),
      g: Math.round(c[1]),
      b: Math.round(c[2]),
      w: Math.round((counts[i] / samples.length) * 1000) / 1000,
      s: counts[i] ? Math.round(spread[i] / counts[i]) : 40,
    }))
    .filter((c) => c.w > 0.04)
    .sort((a, b) => b.w - a.w);
}

function glowFromPalette(palette) {
  if (!palette.length) return '#8fa9ff';
  // Favour the most saturated cluster over the most common one -- averages of
  // whole photographs are always mud.
  const scored = palette.map((c) => {
    const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    return { c, score: sat * 1.4 + c.w * 0.6 };
  });
  scored.sort((a, b) => b.score - a.score);
  const { r, g, b } = scored[0].c;
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToHex(h, Math.min(0.85, Math.max(0.35, s * 1.35)), Math.min(0.72, Math.max(0.5, l * 1.25 + 0.12)));
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}

export function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Duration (and dimensions, for video) straight off a media element. A zero
 * duration is how we find out the browser cannot decode this container at all,
 * which is what sends the file down the ffmpeg path.
 */
export function mediaMeta(source, kind) {
  return new Promise((resolve) => {
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    let settled = false;
    const done = (meta) => { if (!settled) { settled = true; resolve(meta); } };
    el.preload = 'metadata';
    el.muted = true;
    el.onloadedmetadata = () => {
      const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
      done({ duration: dur, w: el.videoWidth || 0, h: el.videoHeight || 0 });
    };
    el.onerror = () => done({ duration: 0, w: 0, h: 0 });
    setTimeout(() => done({ duration: el.duration > 0 ? el.duration : 0, w: el.videoWidth || 0, h: el.videoHeight || 0 }), 6000);
    el.src = url;
  });
}

/**
 * Does this file actually carry a decodable audio track? Videos frequently
 * don't, and an orb whose only sound source is silent is a sad orb. Files over
 * the size cap are assumed to have audio rather than decoded on the spot.
 */
export async function probeAudio(file) {
  if (file.size > 90 * 1024 * 1024) return { hasAudio: true, probed: false };
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const dur = buf.duration;
    // Reject tracks that are digital silence.
    const ch = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < ch.length; i += 997) peak = Math.max(peak, Math.abs(ch[i]));
    ctx.close();
    return { hasAudio: peak > 0.002, probed: true, duration: dur };
  } catch {
    return { hasAudio: false, probed: true };
  }
}

/**
 * Phrase-level shredding: split at sentence ends first, then at internal
 * punctuation, then merge the scraps back up so nothing is a lone conjunction.
 * Target is 4-12 words -- long enough to still mean something on its own.
 */
export function splitText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const out = [];
  for (const sentence of clean.split(/(?<=[.!?…])\s+/)) {
    const parts = sentence.split(/(?<=[,;:—–])\s+/).filter(Boolean);
    let buf = '';
    for (const p of parts) {
      const words = (buf ? buf + ' ' + p : p).trim().split(' ').length;
      if (buf && words > 12) { out.push(buf.trim()); buf = p; }
      else buf = buf ? buf + ' ' + p : p;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  const merged = [];
  for (const frag of out) {
    if (merged.length && frag.split(' ').length < 3) merged[merged.length - 1] += ' ' + frag;
    else merged.push(frag);
  }
  return merged.map((f) => f.trim()).filter(Boolean);
}

export { smoothstep };
