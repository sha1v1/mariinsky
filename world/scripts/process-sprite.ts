// Post-processes a raw AI-generated sprite PNG (opaque flat-color
// background, typically oversized) into what public/sprites/ actually
// needs: transparent background, capped at a sane resolution.
//
// Uses border flood-fill (not a global color threshold) to remove the
// background — only background-colored pixels CONNECTED to the image edge
// become transparent, so isolated matching-colored details inside the
// subject (a dark eye against a black background, a cream highlight
// against white) are never touched. The background color itself is
// auto-detected from the image's own corners rather than assumed to be
// white — found the hard way processing a batch that turned out to be flat
// black instead: hardcoding white silently left those three fully opaque
// (see memory_world_symbol_grounding_render_pipeline.md's spirit of
// failing loud, not silently, on a renderer-facing assumption that doesn't
// hold). Works well on hard-edged art styles like pixel art; for future
// sprites, generating with native transparency avoids any
// background-removal step (and its edge-fringing risk) entirely — this is
// a workaround, not the preferred path.
//
// Usage: node scripts/process-sprite.ts <input.png> <archetype-name>
//   e.g. node scripts/process-sprite.ts ~/Downloads/deer-raw.png deer
// Writes to public/sprites/<archetype-name>.png

import sharp from "sharp";
import path from "node:path";

const MAX_DIMENSION = 512;
const CHANNEL_TOLERANCE = 24; // max per-channel distance from the detected background color
const ALPHA_THRESHOLD = 10; // pixel counts as "content" once alpha exceeds this
const CONTENT_PADDING_FRACTION = 0.06; // padding added around the content bbox, as a fraction of its larger side

interface RGB {
  r: number;
  g: number;
  b: number;
}

function pixelAt(data: Buffer, channels: number, width: number, x: number, y: number): RGB {
  const idx = (y * width + x) * channels;
  return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
}

// Sample all four corners; if they don't roughly agree, the image probably
// doesn't have a clean flat background (subject touching a corner, a
// gradient, ...) — warn rather than silently guessing wrong, and fall back
// to the top-left corner alone.
function detectBackgroundColor(data: Buffer, channels: number, width: number, height: number): RGB {
  const corners = [
    pixelAt(data, channels, width, 0, 0),
    pixelAt(data, channels, width, width - 1, 0),
    pixelAt(data, channels, width, 0, height - 1),
    pixelAt(data, channels, width, width - 1, height - 1),
  ];
  const [topLeft, ...rest] = corners;
  const agree = rest.every(
    (c) =>
      Math.abs(c.r - topLeft.r) <= CHANNEL_TOLERANCE &&
      Math.abs(c.g - topLeft.g) <= CHANNEL_TOLERANCE &&
      Math.abs(c.b - topLeft.b) <= CHANNEL_TOLERANCE
  );
  if (!agree) {
    console.warn(
      `[process-sprite] corners disagree on background color (${JSON.stringify(corners)}) — ` +
        `using top-left, but check the output for a subject that touches a corner or a non-flat background.`
    );
  }
  return topLeft;
}

async function removeBackground(inputPath: string): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const bg = detectBackgroundColor(data, channels, width, height);
  console.log(`[process-sprite] detected background color: rgb(${bg.r}, ${bg.g}, ${bg.b})`);

  const isBackground = (i: number) => {
    const idx = i * channels;
    return (
      Math.abs(data[idx] - bg.r) <= CHANNEL_TOLERANCE &&
      Math.abs(data[idx + 1] - bg.g) <= CHANNEL_TOLERANCE &&
      Math.abs(data[idx + 2] - bg.b) <= CHANNEL_TOLERANCE
    );
  };

  const visited = new Uint8Array(width * height);
  const queue: number[] = [];

  // seed the flood-fill from every background-colored border pixel
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const i = y * width + x;
      if (isBackground(i) && !visited[i]) {
        visited[i] = 1;
        queue.push(i);
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (const x of [0, width - 1]) {
      const i = y * width + x;
      if (isBackground(i) && !visited[i]) {
        visited[i] = 1;
        queue.push(i);
      }
    }
  }

  // BFS across 4-connected background-colored pixels
  while (queue.length > 0) {
    const i = queue.pop()!;
    const x = i % width;
    const y = Math.floor(i / width);
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1,
    ];
    for (const n of neighbors) {
      if (n >= 0 && !visited[n] && isBackground(n)) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }

  for (let i = 0; i < width * height; i++) {
    if (visited[i]) data[i * channels + 3] = 0;
  }

  return { data, width, height };
}

// Different raw sprites arrive with wildly different amounts of empty
// margin around the actual subject (a tightly-framed clock vs. a lamp with
// half the canvas as headroom). Left as-is, every sprite gets scaled by
// its full (mostly empty) canvas at render time, so two "medium"-scale
// objects end up visually very different sizes depending on how the
// source image happened to be framed — found by auditing bbox-fill % across
// the current sprite set (as low as ~38% of canvas width for some, ~90%+
// for others). Crop to the opaque content's bounding box (plus a little
// breathing room) so every sprite fills a consistent fraction of its own
// canvas, and visual_spec.scale actually means the same thing across
// archetypes.
function cropToContentBBox(
  data: Buffer,
  channels: number,
  width: number,
  height: number
): { left: number; top: number; width: number; height: number } {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * channels + 3];
      if (alpha > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) {
    // fully transparent (shouldn't happen for real sprite art) — keep the
    // whole canvas rather than crop to a zero-size region.
    return { left: 0, top: 0, width, height };
  }

  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const padding = Math.round(Math.max(bboxW, bboxH) * CONTENT_PADDING_FRACTION);

  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(width, maxX + 1 + padding);
  const bottom = Math.min(height, maxY + 1 + padding);

  return { left, top, width: right - left, height: bottom - top };
}

async function main() {
  const [, , inputPath, name] = process.argv;
  if (!inputPath || !name) {
    console.error("Usage: node scripts/process-sprite.ts <input.png> <archetype-name>");
    process.exit(1);
  }

  const { data, width, height } = await removeBackground(inputPath);
  const bbox = cropToContentBBox(data, 4, width, height);
  console.log(
    `[process-sprite] content bbox: ${bbox.width}x${bbox.height} of ${width}x${height} canvas ` +
      `(${((bbox.width / width) * 100).toFixed(0)}% x ${((bbox.height / height) * 100).toFixed(0)}%)`
  );

  const outputPath = path.join(import.meta.dirname, "..", "public", "sprites", `${name}.png`);

  await sharp(data, { raw: { width, height, channels: 4 } })
    .extract({ left: bbox.left, top: bbox.top, width: bbox.width, height: bbox.height })
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .png()
    .toFile(outputPath);

  console.log(`Wrote ${outputPath}`);
}

main();
