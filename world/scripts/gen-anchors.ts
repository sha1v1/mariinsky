// Step 0.4 — embeds the 10 anchor phrases (spec §11), lays them evenly on a
// circle of radius 1200 centred at the origin, writes data/anchors.json.
// Run with: node scripts/gen-anchors.ts

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "@huggingface/transformers";

const RADIUS = 1200;

const ANCHOR_NAMES = [
  "home & belonging",
  "absence & loss",
  "first times",
  "motion & travel",
  "night & sleeplessness",
  "food & kitchens",
  "fear & failure",
  "someone else",
  "water & weather",
  "work & making",
];

const OUT_PATH = path.join(import.meta.dirname, "..", "data", "anchors.json");

async function main() {
  console.log("Loading Xenova/bge-small-en-v1.5...");
  const extractor = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5");

  const anchors = [];

  for (let i = 0; i < ANCHOR_NAMES.length; i++) {
    const name = ANCHOR_NAMES[i];
    const output = await extractor(name, { pooling: "mean", normalize: true });
    const embedding = Array.from(output.data as Float32Array);

    const angle = (2 * Math.PI * i) / ANCHOR_NAMES.length;
    const x = RADIUS * Math.cos(angle);
    const y = RADIUS * Math.sin(angle);

    anchors.push({ name, embedding, x, y });
    console.log(`  ${name} -> (${x.toFixed(1)}, ${y.toFixed(1)}), dim=${embedding.length}`);
  }

  await writeFile(OUT_PATH, JSON.stringify(anchors, null, 2));
  console.log(`\nWrote ${anchors.length} anchors to ${OUT_PATH}`);
}

main();
