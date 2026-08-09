// Step 0.3 — reports which fallback archetypes from lib/ontology.ts are
// missing a PNG in public/sprites/. Run with: node scripts/check-sprites.ts
//
// These are only the renderer's fallback safety net (pipeline §4), kept
// flat in public/sprites/ (not split into category subfolders) since the
// category grouping is purely logical, in FALLBACK_ARCHETYPES_BY_CATEGORY.
//
// Matching rule: any file named "<archetype>.png" or "<archetype><sep><rest>.png"
// (sep = "-" or "_") counts as present, so variants like deer-1.png,
// deer_worn.png, deer2.png all satisfy "deer".

import { readdir } from "node:fs/promises";
import path from "node:path";
import { FALLBACK_ARCHETYPES } from "../lib/ontology.ts";

const SPRITES_DIR = path.join(import.meta.dirname, "..", "public", "sprites");

async function main() {
  let files: string[];
  try {
    files = await readdir(SPRITES_DIR);
  } catch {
    console.log(`No sprites directory found at ${SPRITES_DIR}`);
    console.log(`All ${FALLBACK_ARCHETYPES.length} fallback archetypes are missing.`);
    return;
  }

  const pngBasenames = files
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .map((f) => f.slice(0, -4).toLowerCase());

  const present: string[] = [];
  const missing: string[] = [];

  for (const archetype of FALLBACK_ARCHETYPES) {
    const hasMatch = pngBasenames.some(
      (base) => base === archetype || base.startsWith(`${archetype}-`) || base.startsWith(`${archetype}_`)
    );
    (hasMatch ? present : missing).push(archetype);
  }

  console.log(`Sprites present: ${present.length}/${FALLBACK_ARCHETYPES.length}`);
  if (missing.length === 0) {
    console.log("All fallback archetypes have at least one sprite. Nothing missing.");
    return;
  }

  console.log(`\nMissing (${missing.length}):`);
  for (const archetype of missing) {
    console.log(`  - ${archetype}`);
  }
}

main();
