// Architecture refactor §16 — replaces "every memory gets a global (x,y)"
// with a branch on EntityKind:
//
//   entityKind === "structure"           -> create a new structure entity
//   placementRequirements.canExistStandalone -> existing global anchor-circle
//                                                placement (lib/place.ts, unchanged)
//   otherwise (supported_object)         -> find-or-create a container
//                                            structure and occupy an anchor
//                                            (lib/structures.ts)
//
// Anchor occupancy can't be marked here: the memory row doesn't have an id
// until it's inserted. Callers get back `structurePlacement` when relevant
// and must call markAnchorOccupied(structurePlacement, insertedRow.id)
// once the insert returns an id — see api/submit.ts.

import { placeMemory, repelFromFootprints, POINT_OBJECT_CLEARANCE } from "./place.ts";
import { createStructureEntity, placeSupportedObject, markAnchorOccupied } from "./structures.ts";
import type { StructurePlacement } from "./structures.ts";
import type { ScoredCandidate, StructureRow } from "./types.ts";

export { markAnchorOccupied };

export interface PlacementResult {
  x: number;
  y: number;
  structure_id: string | null;
  anchor_id: string | null;
  topAnchor?: string;
  createdStructure?: StructureRow;
  structurePlacement?: StructurePlacement;
}

export async function resolvePlacement(winner: ScoredCandidate, summaryEmbedding: number[]): Promise<PlacementResult> {
  if (winner.entityKind === "structure") {
    const structure = await createStructureEntity(
      winner.noun,
      winner.label,
      winner.structureSuggestion,
      winner.placementRequirements.environmentTags,
      summaryEmbedding
    );
    return { x: structure.x, y: structure.y, structure_id: structure.id, anchor_id: null, createdStructure: structure };
  }

  if (winner.placementRequirements.canExistStandalone) {
    const anchorCircle = await placeMemory(summaryEmbedding);
    // Symmetric with the structure branch above: placeMemory()'s 60px
    // point-repulsion doesn't know a nearby structure is ~420x320, so a
    // plain object could otherwise land visually inside someone else's
    // house/office. Nudge it clear using the same footprint math.
    const { x, y } = await repelFromFootprints(anchorCircle.x, anchorCircle.y, POINT_OBJECT_CLEARANCE);
    return { x, y, structure_id: null, anchor_id: null, topAnchor: anchorCircle.topAnchor };
  }

  const placement = await placeSupportedObject(winner.placementRequirements, winner.structureSuggestion, summaryEmbedding);
  return {
    x: placement.x,
    y: placement.y,
    structure_id: placement.structureId,
    anchor_id: placement.anchorId,
    structurePlacement: placement,
  };
}
