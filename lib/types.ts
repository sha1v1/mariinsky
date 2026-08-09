// Shared types for the symbol-grounding pipeline
// (memory_world_symbol_grounding_render_pipeline.md) and the DB row it
// feeds into. Three layers, kept separate per pipeline §24:
//
//   MemoryIR.candidates[i]   open noun/label, closed category/fallback,
//                            PLUS per-candidate descriptive attributes
//                            (color/uniqueDetail) — all one LLM call (§11, §16)
//   ScoredCandidate          the above + the five §18 scores
//   VisualObjectSpec         render controls, assembled in a SEPARATE step
//                            (§19) after a candidate wins — deterministic/
//                            rule-based (lib/visualspec.ts), not a second
//                            LLM call; this layer can never change noun/label.

import type {
  SymbolCategory, FallbackArchetype, Material, Condition, Scale, Animation, PlacementType,
  EntityKind, AnchorType, StructureTemplateId, ImplementedStructureTemplateId, StructureAnchorDef,
} from "./ontology.ts";

// Whether/how this entity needs a container to make physical sense (world
// hierarchy §3). Required whenever entityKind is "supported_object";
// present-but-trivial (canExistStandalone: true, no preferred anchors) for
// everything else.
export interface PlacementRequirements {
  canExistStandalone: boolean;
  environmentTags: string[];
  preferredAnchors: AnchorType[];
}

// Only meaningful when entityKind === "structure" — the memory itself
// describes a whole place rather than an object needing one (§14).
// preferredTemplate is open vocabulary from the LLM's point of view (any
// STRUCTURE_TEMPLATES value); application code maps it down to an
// IMPLEMENTED_STRUCTURE_TEMPLATES id via STRUCTURE_TEMPLATE_FALLBACK_MAP —
// the richer semanticType string is preserved either way (§6).
export interface StructureSuggestion {
  semanticType: string;
  preferredTemplate?: StructureTemplateId;
  featuredElements?: string[];
}

export interface SymbolCandidateDraft {
  category: SymbolCategory;
  // Open vocabulary — the core semantic output. Never restricted to
  // FALLBACK_ARCHETYPES.
  noun: string;
  // Open vocabulary — human-readable symbolic interpretation of `noun`.
  label: string;
  // Closed — renderer safety net only, not the semantic identity.
  fallbackArchetype: FallbackArchetype;
  // Concrete evidence from the source memory (pipeline §11).
  groundingEvidence: string[];
  // Self-estimated by the LLM at candidate-generation time (pipeline §18);
  // semanticFit, specificity, and novelty are instead computed
  // deterministically by lib/score.ts.
  emotionalFit: number;
  visualSuitability: number;
  // Open vocabulary, generated per-candidate in the SAME call as the rest
  // of this draft (see lib/llm.ts) rather than in a separate visual-spec
  // call — these are the genuinely hard-to-derive descriptive bits that a
  // rule-based function can't invent. lib/visualspec.ts just carries
  // whichever candidate wins' values through into VisualObjectSpec; it
  // never generates new ones.
  primaryColor: string;
  secondaryColor?: string;
  uniqueDetail?: string;
  // World-hierarchy fields (architecture refactor) — closed EntityKind
  // classification plus the support requirements that drive
  // lib/placementPipeline.ts. Architectural fragments (window, door,
  // shelf, stairs) must never appear as noun/label directly — see the
  // prompt rule in lib/llm.ts; instead they show up as
  // structureSuggestion.featuredElements on a "structure" candidate.
  entityKind: EntityKind;
  placementRequirements: PlacementRequirements;
  structureSuggestion?: StructureSuggestion;
}

export interface MemoryIR {
  summary: string;
  epitaph: string;
  literal_anchors: string[];
  themes: string[];
  emotion: {
    valence: number;
    arousal: number;
    nostalgia: number;
  };
  setting: {
    indoors: boolean;
    season: string;
    time_of_day: string;
  };
  candidates: SymbolCandidateDraft[];
}

export interface ScoredCandidate extends SymbolCandidateDraft {
  semanticFit: number;
  specificity: number;
  novelty: number;
  finalScore: number;
}

export interface VisualObjectSpec {
  material: Material;
  customMaterial?: string;
  condition: Condition;
  scale: Scale;
  animation: Animation;
  primaryColor: string;
  secondaryColor?: string;
  glow: number;
  uniqueDetail?: string;
  preferredPlacement: PlacementType;
  explanation: string[];
}

export type RenderStatus = "pending" | "generated" | "fallback" | "failed";

export interface MemoryRow {
  input_type: "text" | "photo" | "voice";
  raw_text: string | null;
  input_url: string | null;
  ir: MemoryIR;
  epitaph: string;

  category: SymbolCategory;
  noun: string;
  label: string;
  fallback_archetype: FallbackArchetype;
  grounding_evidence: string[];

  visual_spec: VisualObjectSpec;

  generated_asset_url: string | null;
  render_status: RenderStatus;

  // World hierarchy. entity_kind is nullable at the type level only because
  // legacy pre-refactor rows have it NULL by design (left as legacy, see
  // migration 004) — every row written by the current pipeline always sets
  // it. x/y remain the authoritative world position either way: for a
  // structure-owned object they're precomputed as
  // structure.x/y + anchor.localX/Y at placement time (see
  // lib/structures.ts), so every existing bbox/viewport query keeps
  // working unmodified.
  entity_kind: EntityKind | null;
  environment_tags: string[];
  preferred_anchors: AnchorType[];
  structure_id: string | null;
  anchor_id: string | null;

  x: number;
  y: number;
}

// --- structures table row shapes -------------------------------------------

export interface StructureAnchorState extends StructureAnchorDef {
  occupiedByMemoryId?: string;
}

export interface StructureRow {
  id: string;
  // Always one of IMPLEMENTED_STRUCTURE_TEMPLATES — this is what
  // determines the row's actual anchor geometry (§6). The richer,
  // possibly-unimplemented semantic flavor (e.g. "computer lab") lives in
  // `noun`/`label` instead, via StructureSuggestion.semanticType at
  // creation time.
  template_id: ImplementedStructureTemplateId;
  noun: string;
  label: string;
  semantic_tags: string[];
  x: number;
  y: number;
  anchors: StructureAnchorState[];
}
