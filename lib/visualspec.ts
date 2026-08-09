// Step 1.5 — visual specification generation
// (memory_world_symbol_grounding_render_pipeline.md §19). Run only AFTER a
// SymbolCandidate has already won (see lib/score.ts).
//
// This is deliberately RULE-BASED, not a third Gemini call. material/
// condition/scale/animation/glow/preferredPlacement are all closed enums,
// and the pipeline doc's own §6 "interpretation tendencies" (nostalgia ->
// worn/faded/aged, fragility -> cracked, freshness/excitement ->
// new/pristine, long outdoor exposure -> weathered) are exactly the kind
// of thing a deterministic function can encode from data Step 1.2 already
// extracted (emotion valence/arousal/nostalgia, setting.indoors) — there's
// no need to spend a Gemini call picking from a fixed list a second time.
//
// The genuinely hard-to-derive free-text bits (primaryColor/secondaryColor/
// uniqueDetail) were instead generated PER CANDIDATE as part of the Step
// 1.2 call itself (see SymbolCandidateDraft in lib/types.ts) and are just
// carried through here from whichever candidate won. So nothing about the
// object's appearance depends on any call made after selection — this
// module can't even change noun/label, since it never receives them as
// writable fields.
//
// Deterministic and seeded off the winning noun/label, so the same memory
// always renders the same way rather than re-rolling on every reload —
// same approach as the fallback paths in lib/llm.ts.

import { CONDITIONS } from "./ontology.ts";
import type {
  SymbolCategory,
  Material,
  Condition,
  Scale,
  Animation,
  PlacementType,
  EntityKind,
  FallbackArchetype,
} from "./ontology.ts";
import type { MemoryIR, VisualObjectSpec } from "./types.ts";
import { clamp01, hashString, mulberry32, pick } from "./util.ts";

interface WinningIdentity {
  category: SymbolCategory;
  entityKind: EntityKind;
  fallbackArchetype: FallbackArchetype;
  noun: string;
  label: string;
  primaryColor: string;
  secondaryColor?: string;
  uniqueDetail?: string;
  groundingEvidence: string[];
}

// --- material: seeded pick from a category-appropriate subset -------------

const MATERIALS_BY_CATEGORY: Record<SymbolCategory, readonly Material[]> = {
  creature: ["felt", "fabric", "ceramic", "clay"],
  plant: ["wood", "paper", "clay", "fabric"],
  object: ["wood", "ceramic", "glass", "metal", "paper", "fabric", "leather", "plastic"],
  architecture: ["wood", "metal", "stone", "glass"],
  natural: ["stone", "clay", "glass"],
};

// --- condition: pipeline §6 tendencies, as priority-ordered thresholds ----

function deriveCondition(emotion: MemoryIR["emotion"], indoors: boolean, rand: () => number): Condition {
  if (emotion.valence < 0.35 && emotion.arousal < 0.4) return "cracked"; // fragility
  if (emotion.nostalgia >= 0.6) return pick(["worn", "faded", "aged"] as const, rand);
  if (emotion.valence >= 0.65 && emotion.nostalgia < 0.4) return pick(["new", "pristine", "polished"] as const, rand);
  if (!indoors) return "weathered"; // long outdoor exposure
  return pick(CONDITIONS, rand);
}

// --- scale: arousal-driven (calmer memories read as smaller/quieter) ------

function deriveScale(emotion: MemoryIR["emotion"], rand: () => number): Scale {
  if (emotion.arousal < 0.3) return pick(["tiny", "miniature"] as const, rand);
  if (emotion.arousal >= 0.7) return pick(["medium", "large"] as const, rand);
  return pick(["small", "medium"] as const, rand);
}

// --- animation: valence x arousal quadrants, then gated by physical
// plausibility -------------------------------------------------------------
//
// The quadrant logic below picks purely from the memory's *emotion* — it
// has no idea whether the winning candidate is a fox or a bench. Left
// ungated, that meant furniture and buildings could get assigned "bob" or
// "gentle_sway" just because the memory itself was warm/nostalgic, which
// reads as a bench swaying in place with no wind, no rider, no reason.
// Nothing should visibly move unless something plausibly moves it: a
// creature by its own choice, a plant by wind — or, for anything else
// (furniture/architecture/structures/most objects), not at all. "flicker"
// is reserved further still, for archetypes that are actually light
// sources — a lamp or lantern flickering makes sense; a bench "flickering"
// doesn't, even though the animation itself is just an alpha oscillation
// with no position change (see FLICKER_PLAUSIBLE_ARCHETYPES below).

function rawAnimationFromEmotion(emotion: MemoryIR["emotion"], rand: () => number): Animation {
  const { valence, arousal, nostalgia } = emotion;
  if (valence >= 0.6 && arousal >= 0.6) return pick(["pulse", "bob"] as const, rand);
  if (nostalgia >= 0.6 && arousal < 0.45) return pick(["slow_breathing", "gentle_sway"] as const, rand);
  if (valence < 0.4 && arousal < 0.4) return pick(["flicker", "still"] as const, rand);
  if (arousal >= 0.65 && valence < 0.45) return "asymmetric_wobble"; // chaotic/fearful
  return pick(["drift", "gentle_sway"] as const, rand);
}

// Plants can plausibly be moved by wind, but not the sharper/jerkier
// animations that read as deliberate motion — remap those to their nearest
// wind-plausible equivalent instead of just forcing "still" (a flower
// swaying gently still reads as "alive-ish" rather than an inert prop).
function toPlantSafeAnimation(raw: Animation): Animation {
  if (raw === "bob" || raw === "pulse") return "slow_breathing";
  if (raw === "asymmetric_wobble") return "gentle_sway";
  return raw; // still / slow_breathing / gentle_sway / drift / flicker all fine
}

// Only fallback archetypes that are plausibly a light source or something
// that visibly catches/throws light get "flicker" — everything else in
// object/architecture/natural just holds still. Deliberately a short,
// conservative allowlist rather than a guess from material (a metal
// bench and a metal lamp shouldn't behave the same way).
const FLICKER_PLAUSIBLE_ARCHETYPES: readonly string[] = ["lamp", "lantern"];

function deriveAnimation(
  category: SymbolCategory,
  entityKind: EntityKind,
  fallbackArchetype: FallbackArchetype,
  emotion: MemoryIR["emotion"],
  rand: () => number
): Animation {
  // A structure is a house/office — it never moves, full stop, regardless
  // of the emotion attached to the memory that created it.
  if (entityKind === "structure") return "still";

  const raw = rawAnimationFromEmotion(emotion, rand);

  if (category === "creature") return raw; // moves by its own choice — full range
  if (category === "plant") return toPlantSafeAnimation(raw); // moves by wind only

  // object / architecture / natural (furniture, buildings, stones, ...):
  // no self-directed or wind-plausible motion, and "flicker" only for the
  // handful of archetypes that are actually a light source.
  if (raw === "still") return "still";
  return FLICKER_PLAUSIBLE_ARCHETYPES.includes(fallbackArchetype) ? "flicker" : "still";
}

// --- placement: category default, overridden by literal keywords ----------

const PLACEMENT_BY_CATEGORY: Record<SymbolCategory, PlacementType> = {
  creature: "ground",
  plant: "ground",
  object: "shelf",
  architecture: "path",
  natural: "water",
};

function keywordPlacement(ir: MemoryIR): PlacementType | null {
  const text = [ir.summary, ...ir.literal_anchors, ...ir.themes].join(" ").toLowerCase();
  if (/\bwindow|windowsill\b/.test(text)) return "window";
  if (/\bpond|lake|river|ocean|sea|water|tide|rain\b/.test(text)) return "water";
  if (/\btree|branch|forest|orchard\b/.test(text)) return "tree";
  if (/\bsky|flew|flying|flight\b/.test(text)) return "air";
  if (/\bpath|trail|road|sidewalk\b/.test(text)) return "path";
  return null;
}

// --- explanation: templated, referencing the actual emotion/evidence ------

function describeIntensity(value: number, low: string, mid: string, high: string): string {
  if (value < 0.35) return low;
  if (value < 0.65) return mid;
  return high;
}

function buildExplanation(
  winner: WinningIdentity,
  emotion: MemoryIR["emotion"],
  material: Material,
  condition: Condition,
  scale: Scale,
  animation: Animation,
  glow: number
): string[] {
  const nostalgiaWord = describeIntensity(emotion.nostalgia, "little nostalgic pull", "some nostalgic pull", "strong nostalgic pull");
  const valenceWord = describeIntensity(emotion.valence, "a heavier, harder feeling", "a mixed feeling", "a warm, positive feeling");
  const arousalWord = describeIntensity(emotion.arousal, "calm, quiet", "moderate", "high, energetic");

  const motionLine =
    animation === "still"
      ? `Its ${scale} scale stays still — nothing here would plausibly move on its own.`
      : `Its ${scale} scale and "${animation.replace(/_/g, " ")}" motion follow from the memory's ${arousalWord} energy.`;

  const lines = [
    `The ${condition} ${material} finish reflects the memory's ${nostalgiaWord} and ${valenceWord}.`,
    motionLine,
    `A glow of ${glow.toFixed(2)} echoes how strongly this memory still resonates.`,
  ];
  if (winner.groundingEvidence.length > 0) {
    lines.push(`Grounded directly in the memory: "${winner.groundingEvidence[0]}".`);
  }
  return lines;
}

// --- public entry point ------------------------------------------------------

export function deriveVisualSpec(winner: WinningIdentity, ir: MemoryIR): VisualObjectSpec {
  const rand = mulberry32(hashString(`${winner.noun}|${winner.label}`));

  const condition = deriveCondition(ir.emotion, ir.setting.indoors, rand);
  const scale = deriveScale(ir.emotion, rand);
  const animation = deriveAnimation(winner.category, winner.entityKind, winner.fallbackArchetype, ir.emotion, rand);
  const material = pick(MATERIALS_BY_CATEGORY[winner.category] ?? MATERIALS_BY_CATEGORY.object, rand);
  const preferredPlacement = keywordPlacement(ir) ?? PLACEMENT_BY_CATEGORY[winner.category] ?? "generic";
  const glow = clamp01(0.35 * ir.emotion.nostalgia + 0.25 * ir.emotion.valence + (rand() - 0.5) * 0.1);

  return {
    material,
    condition,
    scale,
    animation,
    primaryColor: winner.primaryColor,
    secondaryColor: winner.secondaryColor,
    glow,
    uniqueDetail: winner.uniqueDetail,
    preferredPlacement,
    explanation: buildExplanation(winner, ir.emotion, material, condition, scale, animation, glow),
  };
}
