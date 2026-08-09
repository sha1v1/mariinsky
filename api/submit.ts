// Step 1.1 proved the plumbing (request -> DB -> response) with everything
// hardcoded. Step 1.2 replaced that with real Memory IR + symbol-candidate
// extraction (candidates also carry their own descriptive color/detail
// attributes, plus entityKind/placementRequirements for the world
// hierarchy — see lib/llm.ts). Step 1.3 added moderation as the first
// real work this handler does, before the IR call. Step 1.4 scores the 5
// candidates and picks the real winner by finalScore, persisting the
// scored array + summary embedding. Step 1.5 derives the rest of the
// visual spec deterministically (lib/visualspec.ts) — a rule-based
// function, not a second LLM call — run only after the winner is picked so
// it can only add render controls, never change the winning noun/label.
// Step 1.6's placement is now branched by lib/placementPipeline.ts: a
// standalone entity still gets the original global anchor-circle x/y; a
// supported_object or structure gets placed via lib/structures.ts instead
// (world hierarchy / architecture refactor). Flagged submissions still get
// random placement as a plain standalone — they're hidden from the world
// either way, so real placement would be wasted work.

import { supabase } from "../lib/supabase.ts";
import { extractMemoryIR, moderateText } from "../lib/llm.ts";
import { scoreCandidates } from "../lib/score.ts";
import { deriveVisualSpec } from "../lib/visualspec.ts";
import { resolvePlacement, markAnchorOccupied } from "../lib/placementPipeline.ts";

// Same placeholder object Step 1.1 hardcoded, reused for flagged rows so
// they still satisfy the NOT NULL symbol-identity columns without doing
// any real interpretation work on content we're hiding anyway. Always a
// plain standalone entity — no point running structure-selection logic on
// content that's being hidden regardless.
const FLAGGED_PLACEHOLDER = {
  category: "natural" as const,
  noun: "stone",
  label: "a plain grey stone",
  fallback_archetype: "stone",
  grounding_evidence: [],
  visual_spec: {
    material: "stone" as const,
    condition: "worn" as const,
    scale: "small" as const,
    animation: "still" as const,
    primaryColor: "grey",
    glow: 0,
    preferredPlacement: "generic" as const,
    explanation: ["Flagged submission — not interpreted."],
  },
  entity_kind: "standalone_object" as const,
  environment_tags: [] as string[],
  preferred_anchors: [] as string[],
  structure_id: null,
  anchor_id: null,
};

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const { input_type, raw_text } = (body ?? {}) as Record<string, unknown>;

  if (input_type !== "text" || typeof raw_text !== "string" || raw_text.length === 0) {
    return new Response(
      JSON.stringify({ error: "expected { input_type: 'text', raw_text: string }" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const { flagged } = await moderateText(raw_text);

  if (flagged) {
    console.log("[api/submit] moderation flagged submission");
    const flaggedRow = {
      input_type: "text" as const,
      raw_text,
      ir: {},
      epitaph: "",
      ...FLAGGED_PLACEHOLDER,
      generated_asset_url: null,
      render_status: "fallback" as const,
      x: Math.random() * 1000 - 500,
      y: Math.random() * 1000 - 500,
      flagged: true,
    };

    const { error: flaggedInsertError } = await supabase.from("memories").insert(flaggedRow);
    if (flaggedInsertError) {
      console.error("[api/submit] flagged insert failed:", flaggedInsertError);
      return new Response(JSON.stringify({ error: flaggedInsertError.message }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ flagged: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const { ir, source } = await extractMemoryIR(raw_text);
  console.log(`[api/submit] IR source: ${source}`);

  const { scored, summaryEmbedding } = await scoreCandidates(ir);
  console.table(
    scored.map((c) => ({
      noun: c.noun,
      fallbackArchetype: c.fallbackArchetype,
      semanticFit: c.semanticFit.toFixed(3),
      specificity: c.specificity.toFixed(3),
      emotionalFit: c.emotionalFit.toFixed(3),
      visualSuitability: c.visualSuitability.toFixed(3),
      novelty: c.novelty.toFixed(3),
      finalScore: c.finalScore.toFixed(3),
    }))
  );
  const winner = scored[0];

  const visualSpec = deriveVisualSpec(winner, ir);

  const placement = await resolvePlacement(winner, summaryEmbedding);
  console.log(
    `[api/submit] entityKind=${winner.entityKind} placed at (${placement.x.toFixed(1)}, ${placement.y.toFixed(1)})` +
      (placement.topAnchor ? `, top anchor: ${placement.topAnchor}` : "") +
      (placement.structure_id ? `, structure ${placement.structure_id} anchor ${placement.anchor_id}` : "")
  );

  const row = {
    input_type: "text" as const,
    raw_text,
    ir,
    epitaph: ir.epitaph,
    category: winner.category,
    noun: winner.noun,
    label: winner.label,
    fallback_archetype: winner.fallbackArchetype,
    grounding_evidence: winner.groundingEvidence,
    visual_spec: visualSpec,
    generated_asset_url: null,
    render_status: "fallback" as const, // Step 2.5 (generated asset pipeline) not implemented yet
    candidates: scored,
    embedding: summaryEmbedding,
    entity_kind: winner.entityKind,
    environment_tags: winner.placementRequirements.environmentTags,
    preferred_anchors: winner.placementRequirements.preferredAnchors,
    structure_id: placement.structure_id,
    anchor_id: placement.anchor_id,
    x: placement.x,
    y: placement.y,
  };

  const { data, error } = await supabase.from("memories").insert(row).select().single();

  if (error) {
    console.error("[api/submit] insert failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  // Only after the row has an id can the anchor it occupies actually
  // reference it (lib/placementPipeline.ts) — a supported_object placed
  // into an existing or newly-created structure gets its anchor marked
  // occupied here, one step after insert rather than as part of it.
  if (placement.structurePlacement) {
    await markAnchorOccupied(placement.structurePlacement, data.id);
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
