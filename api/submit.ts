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
import { extractMemoryIR, moderateContribution } from "../lib/llm.ts";
import type { GeminiMediaRef } from "../lib/llm.ts";
import { scoreCandidates } from "../lib/score.ts";
import { deriveVisualSpec } from "../lib/visualspec.ts";
import { resolvePlacement, markAnchorOccupied } from "../lib/placementPipeline.ts";
import { retrieveAsset, SCALE_MULTIPLIERS } from "../lib/assetRegistry.ts";

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
  asset_search_terms: ["stone"],
  semantic_tags: ["stone", "fallback"],
  visual_spec: {
    material: "stone" as const,
    condition: "worn" as const,
    scale: "small" as const,
    animation: "still" as const,
    primaryColor: "grey",
    glow: 0,
    preferredPlacement: "generic" as const,
    explanation: ["Flagged submission — not interpreted."],
    assetId: "rock_01",
    assetPath: "/models/nature/rock.glb",
    finalScale: 0.56,
  },
  visual_representation: {
    assetId: "rock_01",
    assetPath: "/models/nature/rock.glb",
    retrievalTier: "keepsake" as const,
    retrievalScore: 0,
    scale: 0.56,
    colorFamily: "grey",
    condition: "worn" as const,
    materialStyle: "rough" as const,
    animation: "still" as const,
  },
  entity_kind: "standalone_object" as const,
  environment_tags: [] as string[],
  preferred_anchors: [] as string[],
  structure_id: null,
  anchor_id: null,
};

function legacyCompatibleRow(row: Record<string, unknown>): Record<string, unknown> {
  const legacy: Record<string, unknown> = { ...row, render_status: "fallback" };
  delete legacy.asset_search_terms;
  delete legacy.semantic_tags;
  delete legacy.visual_representation;
  return legacy;
}

function isPendingAssetMigration(message: string): boolean {
  return /asset_search_terms|semantic_tags|visual_representation|render_status/i.test(message);
}

function isPendingMultimodalMigration(message: string): boolean {
  return /media_metadata|memories_input_type_check/i.test(message);
}

type InputType = "text" | "photo" | "voice" | "video";
const INPUT_TYPES = new Set<InputType>(["text", "photo", "voice", "video"]);

function expectedMimePrefix(inputType: InputType): string | null {
  if (inputType === "photo") return "image/";
  if (inputType === "voice") return "audio/";
  if (inputType === "video") return "video/";
  return null;
}

function validStoragePath(path: string, inputType: InputType): boolean {
  if (inputType === "text") return false;
  return new RegExp(`^${inputType}/\\d{4}-\\d{2}-\\d{2}/[0-9a-f-]{36}\\.[a-z0-9]{1,5}$`).test(path);
}

async function removeRejectedMedia(storagePath: string, geminiFileName: string): Promise<void> {
  const removals: Promise<unknown>[] = [
    supabase.storage.from("contributions").remove([storagePath]),
  ];
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    removals.push(fetch(`https://generativelanguage.googleapis.com/v1beta/${geminiFileName}`, {
      method: "DELETE",
      headers: { "x-goog-api-key": apiKey },
    }));
  }
  const results = await Promise.allSettled(removals);
  if (results.some((result) => result.status === "rejected")) {
    console.warn("[api/submit] one or more rejected-media cleanup operations failed");
  }
}

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

  const payload = (body ?? {}) as Record<string, unknown>;
  const inputType = String(payload.input_type ?? "") as InputType;
  const rawText = typeof payload.raw_text === "string" ? payload.raw_text.trim().slice(0, 500) : "";
  const rawMedia = payload.media as Record<string, unknown> | undefined;
  const media: GeminiMediaRef | undefined = rawMedia ? {
    fileUri: String(rawMedia.file_uri ?? ""),
    mimeType: String(rawMedia.mime_type ?? "").toLowerCase(),
    fileName: String(rawMedia.original_name ?? "media contribution").slice(0, 180),
  } : undefined;
  const prefix = INPUT_TYPES.has(inputType) ? expectedMimePrefix(inputType) : null;
  const validMedia = inputType !== "text" && media
    && media.fileUri.startsWith("https://generativelanguage.googleapis.com/")
    && media.mimeType.startsWith(prefix ?? "__invalid__")
    && /^files\/[a-z0-9-]+$/.test(String(rawMedia?.gemini_file_name ?? ""));

  if (!INPUT_TYPES.has(inputType) || (inputType === "text" ? !rawText : !validMedia)) {
    return new Response(
      JSON.stringify({ error: "expected text, or a completed image/audio/video media upload" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const storagePath = inputType === "text" ? "" : String(rawMedia?.storage_path ?? "");
  if (inputType !== "text" && !validStoragePath(storagePath, inputType)) {
    return Response.json({ error: "invalid media storage path" }, { status: 400 });
  }
  const inputUrl = inputType === "text"
    ? null
    : supabase.storage.from("contributions").getPublicUrl(storagePath).data.publicUrl;
  const mediaMetadata = inputType === "text" ? null : {
    mimeType: media!.mimeType,
    fileName: media!.fileName ?? "media contribution",
    size: Number(rawMedia?.size ?? 0),
    storagePath,
    geminiFileName: String(rawMedia?.gemini_file_name ?? ""),
  };

  const { flagged } = await moderateContribution(rawText, media);

  if (flagged) {
    console.log("[api/submit] moderation flagged submission");
    if (mediaMetadata) {
      await removeRejectedMedia(mediaMetadata.storagePath, mediaMetadata.geminiFileName);
    }
    const flaggedRow = {
      input_type: inputType,
      raw_text: rawText || null,
      input_url: mediaMetadata ? null : inputUrl,
      ir: {},
      epitaph: "",
      ...FLAGGED_PLACEHOLDER,
      generated_asset_url: null,
      render_status: "local_3d" as const,
      x: Math.random() * 1000 - 500,
      y: Math.random() * 1000 - 500,
      flagged: true,
    };

    let { error: flaggedInsertError } = await supabase.from("memories").insert(flaggedRow);
    if (flaggedInsertError && isPendingAssetMigration(flaggedInsertError.message)) {
      ({ error: flaggedInsertError } = await supabase.from("memories").insert(legacyCompatibleRow(flaggedRow)));
    }
    if (flaggedInsertError && inputType !== "text" && isPendingMultimodalMigration(flaggedInsertError.message)) {
      return Response.json({ error: "Apply Supabase migration 006 before placing media." }, { status: 503 });
    }
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

  const { ir, source } = await extractMemoryIR(rawText, media);
  console.log(`[api/submit] IR source: ${source}`);

  const { scored, summaryEmbedding } = await scoreCandidates(ir, rawText);
  console.table(
    scored.map((c) => ({
      noun: c.noun,
      fallbackArchetype: c.fallbackArchetype,
      semanticFit: c.semanticFit.toFixed(3),
      specificity: c.specificity.toFixed(3),
      emotionalFit: c.emotionalFit.toFixed(3),
      visualSuitability: c.visualSuitability.toFixed(3),
      novelty: c.novelty.toFixed(3),
      groundingPenalty: c.groundingPenalty.toFixed(3),
      finalScore: c.finalScore.toFixed(3),
    }))
  );
  const winner = scored[0];

  const visualSpec = deriveVisualSpec(winner, ir);
  const retrieval = retrieveAsset({
    entityKind: winner.entityKind,
    noun: winner.noun,
    label: winner.label,
    assetSearchTerms: winner.assetSearchTerms,
    semanticTags: winner.semanticTags,
    groundingEvidence: winner.groundingEvidence,
    placementRequirements: winner.placementRequirements,
    appearance: winner.appearance,
    behavior: winner.behavior,
  });
  const finalScale = retrieval.asset.defaultScale * SCALE_MULTIPLIERS[winner.appearance.scale];
  const visualRepresentation = {
    assetId: retrieval.asset.id,
    assetPath: retrieval.asset.path,
    retrievalTier: retrieval.tier,
    retrievalScore: retrieval.score,
    scale: finalScale,
    colorFamily: winner.appearance.colorFamily,
    condition: winner.appearance.condition,
    materialStyle: winner.appearance.materialStyle,
    animation: winner.behavior.animation,
  };
  Object.assign(visualSpec, { assetId: retrieval.asset.id, assetPath: retrieval.asset.path, finalScale });
  console.log(`[api/submit] asset=${retrieval.asset.id} tier=${retrieval.tier} score=${retrieval.score.toFixed(3)}`);

  const placement = await resolvePlacement(winner, summaryEmbedding);
  console.log(
    `[api/submit] entityKind=${winner.entityKind} placed at (${placement.x.toFixed(1)}, ${placement.y.toFixed(1)})` +
      (placement.topAnchor ? `, top anchor: ${placement.topAnchor}` : "") +
      (placement.structure_id ? `, structure ${placement.structure_id} anchor ${placement.anchor_id}` : "")
  );

  const row = {
    input_type: inputType,
    raw_text: rawText || null,
    input_url: inputUrl,
    ...(mediaMetadata ? { media_metadata: mediaMetadata } : {}),
    ir,
    epitaph: ir.epitaph,
    category: winner.category,
    noun: winner.noun,
    label: winner.label,
    fallback_archetype: winner.fallbackArchetype,
    grounding_evidence: winner.groundingEvidence,
    asset_search_terms: winner.assetSearchTerms,
    semantic_tags: winner.semanticTags,
    visual_spec: visualSpec,
    visual_representation: visualRepresentation,
    generated_asset_url: null,
    render_status: "local_3d" as const,
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

  let { data, error } = await supabase.from("memories").insert(row).select().single();
  if (error && isPendingAssetMigration(error.message)) {
    console.warn("[api/submit] migration 005 pending; persisting 3D selection inside visual_spec compatibility fields");
    ({ data, error } = await supabase.from("memories").insert(legacyCompatibleRow(row)).select().single());
  }

  if (error && inputType !== "text" && isPendingMultimodalMigration(error.message)) {
    return Response.json({ error: "Apply Supabase migration 006 before placing media." }, { status: 503 });
  }

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
