// World hierarchy — structure selection, scoring, and creation
// (architecture refactor §5, §11, §12). Structures are shared, long-lived
// containers: many unrelated contributors' `supported_object` memories can
// end up occupying anchors in the same structure over time (§13). This
// module owns that lifecycle; lib/placementPipeline.ts decides *when* to
// call it.
//
// Scoring simplification for the hackathon (§11 explicitly allows this):
// score = semanticCompatibility + anchorRankBonus - overcrowdingPenalty.
// The spec's `localMemorySimilarity` term (embedding similarity against a
// structure's existing occupants) is skipped — it would need an extra
// per-structure embedding fetch+compare on every placement, and tag
// overlap already captures most of the same signal cheaply. Revisit if
// structures start feeling thematically incoherent in practice.

import {
  STRUCTURE_DEFS, STRUCTURE_TEMPLATE_FALLBACK_MAP, IMPLEMENTED_STRUCTURE_TEMPLATES,
} from "./ontology.ts";
import type { AnchorType, ImplementedStructureTemplateId } from "./ontology.ts";
import { supabase } from "./supabase.ts";
import { placeMemory, repelFromFootprints, structureRadius } from "./place.ts";
import type { PlacementRequirements, StructureSuggestion, StructureRow, StructureAnchorState } from "./types.ts";

const SEMANTIC_COMPAT_WEIGHT = 1;
const ANCHOR_RANK_BONUS = 0.4; // for matching the *first* preferred anchor type, decaying per rank
const OVERCROWDING_WEIGHT = 0.6;

export function structureAnchorWorldPos(structure: StructureRow, anchor: StructureAnchorState): { x: number; y: number } {
  const def = STRUCTURE_DEFS[structure.template_id];
  return {
    x: structure.x - def.width / 2 + anchor.localX,
    y: structure.y - def.height / 2 + anchor.localY,
  };
}

function tagOverlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b.map((t) => t.toLowerCase()));
  const intersection = a.filter((t) => setB.has(t.toLowerCase())).length;
  const union = new Set([...a.map((t) => t.toLowerCase()), ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// Which of a structure's anchors best satisfies `preferredAnchors`, and is
// currently free? Earlier entries in preferredAnchors are preferred.
function bestFreeAnchor(
  anchors: StructureAnchorState[],
  preferredAnchors: AnchorType[]
): { anchor: StructureAnchorState; rank: number } | null {
  for (let rank = 0; rank < preferredAnchors.length; rank++) {
    const type = preferredAnchors[rank];
    const anchor = anchors.find((a) => a.type === type && !a.occupiedByMemoryId);
    if (anchor) return { anchor, rank };
  }
  return null;
}

function resolveTemplate(suggestion: StructureSuggestion | undefined, environmentTags: string[]): ImplementedStructureTemplateId {
  if (suggestion?.preferredTemplate) {
    return STRUCTURE_TEMPLATE_FALLBACK_MAP[suggestion.preferredTemplate];
  }
  // No suggestion — score environmentTags against each implemented
  // template's own semanticTags and take the best match (same overlap
  // heuristic as structure selection below), defaulting to small_house on
  // a tie since domestic/nostalgic memories are the more common case.
  let best: ImplementedStructureTemplateId = "small_house";
  let bestScore = -1;
  for (const templateId of IMPLEMENTED_STRUCTURE_TEMPLATES) {
    const score = tagOverlapScore(environmentTags, STRUCTURE_DEFS[templateId].semanticTags);
    if (score > bestScore) {
      bestScore = score;
      best = templateId;
    }
  }
  return best;
}

async function fetchAllStructures(): Promise<StructureRow[]> {
  const { data, error } = await supabase.from("structures").select("*");
  if (error) {
    console.error("[structures] fetch failed, treating as no existing structures:", error);
    return [];
  }
  return (data ?? []) as StructureRow[];
}

async function insertStructure(
  templateId: ImplementedStructureTemplateId,
  noun: string,
  label: string,
  semanticTags: string[],
  x: number,
  y: number
): Promise<StructureRow> {
  const def = STRUCTURE_DEFS[templateId];
  const anchors: StructureAnchorState[] = def.anchors.map((a) => ({ ...a }));

  const { data, error } = await supabase
    .from("structures")
    .insert({
      template_id: templateId,
      noun,
      label,
      semantic_tags: semanticTags,
      x,
      y,
      anchors,
    })
    .select()
    .single();

  if (error) throw new Error(`[structures] insert failed: ${error.message}`);
  console.log(`[structures] created new "${templateId}" structure "${label}" at (${x.toFixed(0)}, ${y.toFixed(0)})`);
  return data as StructureRow;
}

async function occupyAnchor(structureId: string, anchorId: string, memoryId: string): Promise<void> {
  // Re-fetch immediately before writing rather than reusing the copy used
  // for scoring — narrows (doesn't eliminate) the race window between two
  // concurrent submissions picking the same anchor. Fine for a hackathon
  // demo's traffic; a real deployment would want a DB-level constraint or
  // transaction here instead.
  const { data, error } = await supabase.from("structures").select("anchors").eq("id", structureId).single();
  if (error || !data) {
    console.error("[structures] re-fetch before anchor assignment failed:", error);
    return;
  }
  const anchors = (data.anchors as StructureAnchorState[]).map((a) =>
    a.id === anchorId ? { ...a, occupiedByMemoryId: memoryId } : a
  );
  const { error: updateError } = await supabase.from("structures").update({ anchors }).eq("id", structureId);
  if (updateError) console.error("[structures] anchor assignment failed:", updateError);
}

export interface StructurePlacement {
  structureId: string;
  anchorId: string;
  x: number;
  y: number;
}

// §11 — find-or-create a structure for a `supported_object` and occupy one
// of its anchors. `summaryEmbedding` is the triggering memory's own
// embedding, reused as a stand-in for "where should a brand-new structure
// go" when one has to be created (§12) — it's already computed, and a
// structure created in direct response to a memory belongs near that
// memory's own semantic placement anyway.
export async function placeSupportedObject(
  requirements: PlacementRequirements,
  structureSuggestion: StructureSuggestion | undefined,
  summaryEmbedding: number[]
): Promise<StructurePlacement> {
  const structures = await fetchAllStructures();

  let best: { structure: StructureRow; anchor: StructureAnchorState; score: number } | null = null;
  for (const structure of structures) {
    const match = bestFreeAnchor(structure.anchors, requirements.preferredAnchors);
    if (!match) continue; // no compatible free anchor — disqualified (§11 step 4)

    const semanticCompatibility = tagOverlapScore(requirements.environmentTags, structure.semantic_tags);
    const anchorRankBonus = ANCHOR_RANK_BONUS / (match.rank + 1);
    const occupied = structure.anchors.filter((a) => a.occupiedByMemoryId).length;
    const overcrowdingPenalty = OVERCROWDING_WEIGHT * (occupied / structure.anchors.length);

    const score = SEMANTIC_COMPAT_WEIGHT * semanticCompatibility + anchorRankBonus - overcrowdingPenalty;
    if (!best || score > best.score) best = { structure, anchor: match.anchor, score };
  }

  if (best) {
    console.log(
      `[structures] placing in existing structure "${best.structure.label}" ` +
        `(anchor ${best.anchor.id}, score ${best.score.toFixed(3)})`
    );
    const pos = structureAnchorWorldPos(best.structure, best.anchor);
    return { structureId: best.structure.id, anchorId: best.anchor.id, ...pos };
  }

  // §12 — nothing compatible exists, create a new structure.
  const templateId = resolveTemplate(structureSuggestion, requirements.environmentTags);
  const label = structureSuggestion?.semanticType ?? `a quiet ${templateId.replace(/_/g, " ")}`;
  const { x, y } = await placeMemory(summaryEmbedding);
  const structure = await insertStructure(templateId, structureSuggestion?.semanticType ?? templateId, label, requirements.environmentTags, x, y);

  const match = bestFreeAnchor(structure.anchors, requirements.preferredAnchors);
  // A freshly created structure not exposing any anchor the object wants
  // means requirements.preferredAnchors named something P0's two templates
  // don't have (e.g. "water", "tree_branch") — fall back to any free
  // anchor rather than losing the object.
  const anchor = match?.anchor ?? structure.anchors.find((a) => !a.occupiedByMemoryId) ?? structure.anchors[0];
  const pos = structureAnchorWorldPos(structure, anchor);
  return { structureId: structure.id, anchorId: anchor.id, ...pos };
}

// §5/§14 — the memory itself describes a whole place, not an object
// needing one. Always creates a fresh structure instance (see
// lib/placementPipeline.ts for why: reuse would silently merge unrelated
// contributors' distinct "this is my memory of a place" entities).
export async function createStructureEntity(
  noun: string,
  label: string,
  structureSuggestion: StructureSuggestion | undefined,
  environmentTags: string[],
  summaryEmbedding: number[]
): Promise<StructureRow> {
  const templateId = resolveTemplate(structureSuggestion, environmentTags);
  const anchorCircle = await placeMemory(summaryEmbedding);
  // placeMemory()'s own repulsion is sized for point-sprites (60px) — a
  // structure's ~420x320 footprint needs a second pass that actually knows
  // its own size, or it can still land on top of whatever's nearby (see
  // lib/place.ts's repelFromFootprints doc comment).
  const { x, y } = await repelFromFootprints(anchorCircle.x, anchorCircle.y, structureRadius(templateId));
  return insertStructure(templateId, noun, label, environmentTags, x, y);
}

export async function markAnchorOccupied(placement: StructurePlacement, memoryId: string): Promise<void> {
  await occupyAnchor(placement.structureId, placement.anchorId, memoryId);
}
