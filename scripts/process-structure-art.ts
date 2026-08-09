// Processes a raw cutaway/dollhouse-style structure interior image into
// what public/structures/ needs: cropped to the exact aspect ratio of the
// template's STRUCTURE_DEFS width/height (so it maps onto the structure's
// world-space box with no stretching), capped at a sane resolution.
//
// Unlike scripts/process-sprite.ts, there's no background removal here —
// a structure interior is a full opaque scene, not a subject on a flat
// background. The only real requirement is matching the template's
// aspect ratio exactly, since components/Structure.ts draws this image
// stretched to fill (def.width * zoom) x (def.height * zoom) precisely.
//
// Usage: node scripts/process-structure-art.ts <input.png> <template-id>
//   e.g. node scripts/process-structure-art.ts ~/Downloads/bedroom-raw.png small_house
// Writes to public/structures/<template-id>.png

import sharp from "sharp";
import path from "node:path";
import { STRUCTURE_DEFS, IMPLEMENTED_STRUCTURE_TEMPLATES } from "../lib/ontology.ts";
import type { ImplementedStructureTemplateId } from "../lib/ontology.ts";

const MAX_WIDTH = 1024;

async function main() {
  const [, , inputPath, templateIdArg] = process.argv;
  if (!inputPath || !templateIdArg) {
    console.error("Usage: node scripts/process-structure-art.ts <input.png> <template-id>");
    console.error(`Valid template ids: ${IMPLEMENTED_STRUCTURE_TEMPLATES.join(", ")}`);
    process.exit(1);
  }
  if (!(IMPLEMENTED_STRUCTURE_TEMPLATES as readonly string[]).includes(templateIdArg)) {
    console.error(`Unknown template id "${templateIdArg}". Valid: ${IMPLEMENTED_STRUCTURE_TEMPLATES.join(", ")}`);
    process.exit(1);
  }
  const templateId = templateIdArg as ImplementedStructureTemplateId;

  const def = STRUCTURE_DEFS[templateId];
  const targetWidth = MAX_WIDTH;
  const targetHeight = Math.round((MAX_WIDTH * def.height) / def.width);

  const outputPath = path.join(import.meta.dirname, "..", "public", "structures", `${templateId}.png`);

  await sharp(inputPath)
    // "cover" crops to fill the exact target aspect ratio (center-cropped)
    // rather than letterboxing or stretching — the anchor coordinates in
    // STRUCTURE_DEFS assume the delivered image fills the box exactly.
    .resize({ width: targetWidth, height: targetHeight, fit: "cover", position: "centre" })
    .png()
    .toFile(outputPath);

  console.log(
    `Wrote ${outputPath} (${targetWidth}x${targetHeight}, matches ${templateId}'s ${def.width}x${def.height} aspect ratio)`
  );
  console.log(
    `Reminder: check that the anchors still make visual sense against this art — ` +
      `localX/localY in STRUCTURE_DEFS (lib/ontology.ts) were placed for a schematic box, ` +
      `not this specific image, and may need recalibrating.`
  );
}

main();
