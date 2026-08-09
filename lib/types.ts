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

export type AppearanceCondition = "new" | "worn" | "aged" | "faded" | "weathered" | "pristine";
export type MaterialStyle = "matte" | "rough" | "glossy" | "soft" | "metallic" | "neutral";
export type BehaviorAnimation = "still" | "gentle_sway" | "slow_breathing" | "bob" | "pulse" | "flicker" | "drift";

/** High-level, semantic art direction. Numeric renderer values never come from the model. */
export interface AppearanceSpec {
  colorFamily?: string;
  scale: Scale;
  condition: AppearanceCondition;
  materialStyle?: MaterialStyle;
}

export interface BehaviorSpec {
  animation: BehaviorAnimation;
}

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
  // Open retrieval vocabulary. The model describes what to search for;
  // application code chooses the actual local asset id.
  assetSearchTerms: string[];
  semanticTags: string[];
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
  appearance: AppearanceSpec;
  behavior: BehaviorSpec;
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
  timeContext: "past" | "present" | "ongoing" | "future" | "timeless";
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
  groundingPenalty: number;
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
  // The semantic appearance and chosen reusable 3D representation remain
  // explicit even for legacy clients that only read visual_spec.
  materialStyle?: MaterialStyle;
  assetId?: string;
  assetPath?: string;
  finalScale?: number;
}

export interface VisualRepresentation {
  assetId: string;
  assetPath: string;
  retrievalTier: "exact" | "related" | "family" | "keepsake";
  retrievalScore: number;
  scale: number;
  colorFamily?: string;
  condition: AppearanceCondition;
  materialStyle?: MaterialStyle;
  animation: BehaviorAnimation;
}

export type RenderStatus = "local_3d" | "pending" | "generated" | "fallback" | "failed";

export interface MemoryRow {
  input_type: "text" | "photo" | "voice" | "video";
  raw_text: string | null;
  input_url: string | null;
  media_metadata?: {
    mimeType: string;
    fileName: string;
    size: number;
    storagePath: string;
    geminiFileName: string;
  } | null;
  ir: MemoryIR;
  epitaph: string;

  category: SymbolCategory;
  noun: string;
  label: string;
  fallback_archetype: FallbackArchetype;
  grounding_evidence: string[];
  asset_search_terms: string[];
  semantic_tags: string[];

  visual_spec: VisualObjectSpec;
  visual_representation: VisualRepresentation;

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
