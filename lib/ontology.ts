// Closed enums for the symbol-grounding pipeline (see
// memory_world_symbol_grounding_render_pipeline.md). Two different kinds of
// vocabulary live in this file and must not be confused:
//
//   - SYMBOL_CATEGORIES / FALLBACK_ARCHETYPES_BY_CATEGORY are CLOSED. They
//     exist for organization and as the renderer's fallback safety net —
//     never as the actual semantic ontology. The real object identity
//     (`noun`, `label` in lib/types.ts) is open vocabulary, chosen by the
//     LLM per-memory, and is NOT drawn from FALLBACK_ARCHETYPES.
//   - MATERIALS / CONDITIONS / SCALES / ANIMATIONS / PLACEMENT_TYPES are
//     closed because every value must map to real renderer behavior
//     (pipeline §2, §8, §9).

export const SYMBOL_CATEGORIES = [
  "creature",
  "plant",
  "object",
  "architecture",
  "natural",
] as const;

export type SymbolCategory = (typeof SYMBOL_CATEGORIES)[number];

export const FALLBACK_ARCHETYPES_BY_CATEGORY: Record<SymbolCategory, readonly string[]> = {
  creature: [
    "bird", "cat", "fox", "deer", "butterfly",
    "fish", "firefly", "rabbit", "moth", "snail",
  ],
  plant: [
    "flower", "tree", "vine", "mushroom",
    "grass", "moss", "fern", "reed",
  ],
  object: [
    "toy", "lamp", "book", "chair", "umbrella",
    "clock", "camera", "cup", "shell", "backpack",
    "bell", "musicbox", "lantern", "kettle", "radio",
  ],
  // "window", "door", "stairs", "shelf" were removed from here — they're
  // structural attachments, not freestanding objects (a window with no
  // wall isn't a decontextualized window, it's structurally incoherent).
  // See EntityKind/StructureTemplateId below: those now live as anchor
  // types and structure-interior features instead of top-level fallback
  // archetypes. Everything still listed here is genuinely self-supporting.
  architecture: [
    "bench", "bridge", "mailbox", "fence",
  ],
  natural: [
    "pond", "stone",
  ],
} as const;

export const FALLBACK_ARCHETYPES = Object.values(FALLBACK_ARCHETYPES_BY_CATEGORY).flat();

export type FallbackArchetype = (typeof FALLBACK_ARCHETYPES)[number];

// Only used for repairing an LLM output whose `category` doesn't match the
// `fallbackArchetype` it picked — not part of the main validation path.
export function categoryForFallbackArchetype(archetype: string): SymbolCategory | null {
  for (const category of SYMBOL_CATEGORIES) {
    if ((FALLBACK_ARCHETYPES_BY_CATEGORY[category] as readonly string[]).includes(archetype)) {
      return category;
    }
  }
  return null;
}

export const MATERIALS = [
  "felt", "wood", "ceramic", "glass", "paper",
  "metal", "fabric", "stone", "clay", "leather",
  "plastic", "other",
] as const;

export const CONDITIONS = [
  "worn", "new", "faded", "weathered", "pristine", "cracked", "polished", "aged",
] as const;

export const SCALES = [
  "tiny", "miniature", "small", "medium", "large",
] as const;

export const ANIMATIONS = [
  "still", "slow_breathing", "gentle_sway",
  "flicker", "drift", "pulse", "bob", "asymmetric_wobble",
] as const;

export const PLACEMENT_TYPES = [
  "ground", "shelf", "window", "water", "tree", "air", "path", "generic",
] as const;

export type Material = (typeof MATERIALS)[number];
export type Condition = (typeof CONDITIONS)[number];
export type Scale = (typeof SCALES)[number];
export type Animation = (typeof ANIMATIONS)[number];
export type PlacementType = (typeof PLACEMENT_TYPES)[number];

// ---------------------------------------------------------------------------
// World hierarchy — structures, anchors, and what needs one.
//
// A SECOND, orthogonal axis from SYMBOL_CATEGORY above. Category groups
// fallback sprites; EntityKind governs the placement pipeline (does this
// thing need a container to make sense, or is it its own container?). A
// "reindeer toy" is category="object" AND entityKind="supported_object"; a
// "deer" is category="creature" AND entityKind="creature". Orthogonal by
// design — don't try to merge these into one enum.

export const ENTITY_KINDS = [
  "standalone_object",   // can plausibly exist independently in the world
  "supported_object",    // requires a container/surface to make sense
  "creature",
  "plant",
  "environment_feature", // ponds, rocks, streams, paths
  "structure",           // a complete architectural space (house, office, ...)
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ANCHOR_TYPES = [
  "ground", "floor", "table", "desk", "shelf", "windowsill",
  "wall", "chair", "tree_branch", "garden_bed", "water", "path",
  "generic_surface",
] as const;

export type AnchorType = (typeof ANCHOR_TYPES)[number];

// The full closed vocabulary a structure's semantic type can be described
// as — but only IMPLEMENTED_STRUCTURE_TEMPLATES below have real anchor
// geometry (pipeline P0). Application code owns the mapping from the
// unimplemented ones down to an implemented template (§6) — the LLM is
// never asked to invent geometry.
export const STRUCTURE_TEMPLATES = [
  "small_house", "bedroom", "kitchen", "office", "classroom",
  "workshop", "greenhouse", "hut",
] as const;

export type StructureTemplateId = (typeof STRUCTURE_TEMPLATES)[number];

export const IMPLEMENTED_STRUCTURE_TEMPLATES = ["small_house", "office"] as const satisfies readonly StructureTemplateId[];

export type ImplementedStructureTemplateId = (typeof IMPLEMENTED_STRUCTURE_TEMPLATES)[number];

// P0 has only two real templates — every other semantic type collapses
// down to whichever of the two it's closer to, domestic vs. work/study.
// This table is the whole of that mapping; extend it as P1/P2 templates
// get real geometry instead of widening the guesswork here.
export const STRUCTURE_TEMPLATE_FALLBACK_MAP: Record<StructureTemplateId, ImplementedStructureTemplateId> = {
  small_house: "small_house",
  bedroom: "small_house",
  kitchen: "small_house",
  hut: "small_house",
  greenhouse: "small_house",
  office: "office",
  classroom: "office",
  workshop: "office",
};

export interface StructureAnchorDef {
  id: string;
  type: AnchorType;
  // Local coordinates relative to the structure's own top-left corner,
  // in world units — application-owned geometry (pipeline §8), never
  // inferred from a generated image.
  localX: number;
  localY: number;
}

export interface StructureTemplateDef {
  semanticTags: string[];
  width: number;
  height: number;
  anchors: StructureAnchorDef[];
}

// P0 (pipeline §18): small_house + office only, with functional anchors
// covering ground/table/shelf/windowsill/floor (+desk/chair for office).
// P1/P2 templates stay in STRUCTURE_TEMPLATES as valid semantic vocabulary
// (so the LLM can still say "greenhouse") but fall back to one of these
// two for actual geometry via STRUCTURE_TEMPLATE_FALLBACK_MAP until they
// get their own entries here.
export const STRUCTURE_DEFS: Record<ImplementedStructureTemplateId, StructureTemplateDef> = {
  small_house: {
    semanticTags: ["home", "family", "childhood", "domestic", "interior", "warmth", "nostalgia"],
    width: 420,
    height: 320,
    anchors: [
      { id: "window-left", type: "windowsill", localX: 60, localY: 90 },
      { id: "table-main", type: "table", localX: 220, localY: 210 },
      { id: "shelf-upper", type: "shelf", localX: 340, localY: 100 },
      { id: "floor-left", type: "floor", localX: 100, localY: 260 },
      { id: "floor-right", type: "floor", localX: 320, localY: 260 },
    ],
  },
  office: {
    semanticTags: ["work", "study", "academic", "office", "interior", "focus", "late-night"],
    width: 420,
    height: 320,
    anchors: [
      { id: "desk-main", type: "desk", localX: 210, localY: 200 },
      { id: "chair-main", type: "chair", localX: 210, localY: 240 },
      { id: "shelf-side", type: "shelf", localX: 60, localY: 100 },
      { id: "window-back", type: "windowsill", localX: 340, localY: 80 },
      { id: "floor-front", type: "floor", localX: 210, localY: 280 },
    ],
  },
};
