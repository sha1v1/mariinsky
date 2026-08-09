// Step 1.4 — candidate scoring (memory_world_symbol_grounding_render_pipeline.md §18).
//
//   finalScore = 0.45 · semanticFit + 0.20 · specificity + 0.15 · emotionalFit
//              + 0.10 · visualSuitability + 0.10 · novelty
//
// semanticFit = cosine(embed(candidate.label), embed(ir.summary)) — one
//   batched embedding call for the summary plus all 5 candidate labels.
//   Computed here (not trusted from the LLM) for the same reason the old
//   three-term score did: it's the one term worth being objective about.
// specificity = 1.0 when the candidate's actual head noun appears in the
//   literal memory anchors/summary, else 0.3. Labels are deliberately not
//   used: an invented "zoo token" used to get full credit just because its
//   adjective repeated "zoo", while the witnessed deer lost.
// emotionalFit / visualSuitability = carried through from the LLM's own
//   per-candidate self-estimate (lib/llm.ts) — not deterministically
//   computable without a lot more machinery, and the pipeline frames these
//   as judgments made at candidate-generation time (§16).
// novelty = 1 − min(1, count(fallback_archetype in world) / 25) — a single
//   SQL count per candidate's *fallback archetype* (closed, so countable;
//   `noun` is open vocabulary and unbounded so it can't be grouped on),
//   restricted to non-flagged rows — novelty is about what's actually
//   visible in the world, same filter /api/world uses later.

import { cosineSimilarity, embedBatch } from "./embed.ts";
import { supabase } from "./supabase.ts";
import type { MemoryIR, ScoredCandidate } from "./types.ts";
import { inventedArtifactPenalty, specificityFor } from "./grounding.ts";

export { inventedArtifactPenalty, specificityFor } from "./grounding.ts";

const SEMANTIC_FIT_WEIGHT = 0.45;
const SPECIFICITY_WEIGHT = 0.2;
const EMOTIONAL_FIT_WEIGHT = 0.15;
const VISUAL_SUITABILITY_WEIGHT = 0.1;
const NOVELTY_WEIGHT = 0.1;

async function countFallbackArchetype(fallbackArchetype: string): Promise<number> {
  const { count, error } = await supabase
    .from("memories")
    .select("*", { count: "exact", head: true })
    .eq("fallback_archetype", fallbackArchetype)
    .eq("flagged", false);

  if (error) {
    console.error(`[score] fallback_archetype count failed for "${fallbackArchetype}", treating as 0:`, error);
    return 0;
  }
  return count ?? 0;
}

export async function scoreCandidates(
  ir: MemoryIR,
  sourceText = "",
): Promise<{ scored: ScoredCandidate[]; summaryEmbedding: number[] }> {
  const texts = [ir.summary, ...ir.candidates.map((c) => c.label)];
  const [summaryEmbedding, ...candidateEmbeddings] = await embedBatch(texts);

  const counts = await Promise.all(
    ir.candidates.map((c) => countFallbackArchetype(c.fallbackArchetype))
  );

  const scored: ScoredCandidate[] = ir.candidates.map((candidate, i) => {
    const semanticFit = cosineSimilarity(candidateEmbeddings[i], summaryEmbedding);
    const literalSource = [sourceText, ir.summary, ...ir.literal_anchors].join(" ");
    const specificity = specificityFor(candidate.noun, ir.literal_anchors, `${sourceText} ${ir.summary}`);
    const novelty = 1 - Math.min(1, counts[i] / 25);
    const groundingPenalty = inventedArtifactPenalty(candidate.noun, literalSource, ir.timeContext);
    const finalScore = Math.max(0,
      SEMANTIC_FIT_WEIGHT * semanticFit +
      SPECIFICITY_WEIGHT * specificity +
      EMOTIONAL_FIT_WEIGHT * candidate.emotionalFit +
      VISUAL_SUITABILITY_WEIGHT * candidate.visualSuitability +
      NOVELTY_WEIGHT * novelty -
      groundingPenalty
    );
    return { ...candidate, semanticFit, specificity, novelty, groundingPenalty, finalScore };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);
  return { scored, summaryEmbedding };
}
