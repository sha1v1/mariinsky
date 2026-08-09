import { STRUCTURE_DEFS } from "./ontology.ts";
import type { ImplementedStructureTemplateId } from "./ontology.ts";
import type { StructureAnchorState } from "./types.ts";

// The semantic anchor circle is ~1200 legacy placement units in radius.
// Compress it into a ~6.7m miniature settlement so rooms remain legible.
export const WORLD_TO_SCENE = 1 / 180;

export function anchorPosition(
  anchor: StructureAnchorState,
  templateId?: ImplementedStructureTemplateId,
): [number, number, number] {
  // Structure rows created before the 3D refactor persisted only localX/Y.
  // Anchor ids are stable, so resolve them against today's canonical 3D
  // template first. This restores correct table/shelf/windowsill heights.
  const canonical = templateId ? STRUCTURE_DEFS[templateId]?.anchors.find((candidate) => candidate.id === anchor.id) : undefined;
  if (canonical?.position) return [canonical.position.x, canonical.position.y, canonical.position.z];
  if (anchor.position) return [anchor.position.x, anchor.position.y, anchor.position.z];
  // Unknown legacy ids still get a type-aware height instead of silently
  // becoming floor anchors.
  const height = anchor.type === "table" || anchor.type === "desk" ? 1.02
    : anchor.type === "shelf" || anchor.type === "windowsill" ? 1.32
    : anchor.type === "chair" ? 0.52
    : 0.01;
  return [((anchor.localX ?? 210) - 210) / 84, height, ((anchor.localY ?? 160) - 160) / 80];
}
