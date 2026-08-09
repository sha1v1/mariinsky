// Step 1.2 — Memory IR extraction + open-vocabulary symbol candidates
// (memory_world_symbol_grounding_render_pipeline.md §11, §16, §25), via
// Gemini structured output. Each candidate also carries its own
// primaryColor/secondaryColor/uniqueDetail — the free-text descriptive
// attributes that genuinely need a model's judgment — so that lib/
// visualspec.ts's later step can be pure rule-based derivation instead of
// a second LLM call; see that file for why. Validates the LLM's output
// server-side (snaps illegal enum values to the nearest legal one — never
// touches noun/label while doing so, per §26) and falls back to
// deterministic keyword matching if the call fails or returns something
// unparseable. Never throws — callers always get a usable MemoryIR back,
// with `source` telling them which path was taken.

import {
  SYMBOL_CATEGORIES, FALLBACK_ARCHETYPES, FALLBACK_ARCHETYPES_BY_CATEGORY,
  categoryForFallbackArchetype, ENTITY_KINDS, ANCHOR_TYPES, STRUCTURE_TEMPLATES,
} from "./ontology.ts";
import type { SymbolCategory, FallbackArchetype, EntityKind, AnchorType, StructureTemplateId } from "./ontology.ts";
import type { MemoryIR, SymbolCandidateDraft, PlacementRequirements, StructureSuggestion } from "./types.ts";
import { snapToNearest, clamp01, hashString, mulberry32, pick } from "./util.ts";

const MODEL = "gemini-3.5-flash"; // TEMP: gemini-3.5-flash-lite hit its daily free-tier quota; testing with the sibling model, which has a separate per-model quota bucket

const IR_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    epitaph: { type: "STRING" },
    literal_anchors: { type: "ARRAY", items: { type: "STRING" } },
    themes: { type: "ARRAY", items: { type: "STRING" } },
    emotion: {
      type: "OBJECT",
      properties: {
        valence: { type: "NUMBER" },
        arousal: { type: "NUMBER" },
        nostalgia: { type: "NUMBER" },
      },
      required: ["valence", "arousal", "nostalgia"],
    },
    setting: {
      type: "OBJECT",
      properties: {
        indoors: { type: "BOOLEAN" },
        season: { type: "STRING" },
        time_of_day: { type: "STRING" },
      },
      required: ["indoors", "season", "time_of_day"],
    },
    candidates: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING", enum: SYMBOL_CATEGORIES as unknown as string[] },
          noun: { type: "STRING" },
          label: { type: "STRING" },
          fallbackArchetype: { type: "STRING", enum: FALLBACK_ARCHETYPES },
          groundingEvidence: { type: "ARRAY", items: { type: "STRING" } },
          emotionalFit: { type: "NUMBER" },
          visualSuitability: { type: "NUMBER" },
          primaryColor: { type: "STRING" },
          secondaryColor: { type: "STRING" },
          uniqueDetail: { type: "STRING" },
          entityKind: { type: "STRING", enum: ENTITY_KINDS as unknown as string[] },
          placementRequirements: {
            type: "OBJECT",
            properties: {
              canExistStandalone: { type: "BOOLEAN" },
              environmentTags: { type: "ARRAY", items: { type: "STRING" } },
              preferredAnchors: { type: "ARRAY", items: { type: "STRING", enum: ANCHOR_TYPES as unknown as string[] } },
            },
            required: ["canExistStandalone", "environmentTags", "preferredAnchors"],
          },
          structureSuggestion: {
            type: "OBJECT",
            properties: {
              semanticType: { type: "STRING" },
              preferredTemplate: { type: "STRING", enum: STRUCTURE_TEMPLATES as unknown as string[] },
              featuredElements: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["semanticType"],
          },
        },
        required: [
          "category", "noun", "label", "fallbackArchetype",
          "groundingEvidence", "emotionalFit", "visualSuitability", "primaryColor",
          "entityKind", "placementRequirements",
        ],
      },
    },
  },
  required: [
    "summary", "epitaph", "literal_anchors", "themes",
    "emotion", "setting", "candidates",
  ],
};

const PROMPT_INSTRUCTIONS = `You turn a short personal memory into a structured interpretation (a "Memory IR") for a symbolic-object generator.

RULES:
- The symbolic object's noun and label are OPEN VOCABULARY. You may choose any concrete object, creature, plant, architectural element, or natural entity that best represents the memory — you are NOT restricted to any fixed list. Prefer a specific object grounded in a distinctive detail from the memory (e.g. "a slightly melted purple crayon") over a generic emotional metaphor (e.g. never default love->heart, sadness->wilted flower, nostalgia->candle).
- noun/label are chosen by MEANING, not by literal sentiment. Ask: what concrete, specific thing does this memory actually evoke?
- Produce exactly 5 candidates, ranked by fit, each with a genuinely different noun.
- Every candidate must ALSO include a "category" (one of: ${SYMBOL_CATEGORIES.join(", ")}) and a "fallbackArchetype" chosen from this fixed list, grouped by category:
${Object.entries(FALLBACK_ARCHETYPES_BY_CATEGORY)
  .map(([cat, list]) => `  ${cat}: ${list.join(", ")}`)
  .join("\n")}
  The fallbackArchetype is ONLY a rendering safety net used if custom art generation fails — it is never the actual meaning of the memory. Pick whichever fallback archetype is visually closest to your chosen noun, even if it's a loose match.
- groundingEvidence: 1-2 short quotes/paraphrases from the memory that justify this candidate.
- emotionalFit (0-1): how well this object's *form* could carry the memory's emotional character.
- visualSuitability (0-1): how clearly this object could exist as a standalone rendered world object.
- primaryColor (required) and secondaryColor (optional): free-text descriptive color phrases for THIS specific object (e.g. "muted burgundy", "aged brass"), not hex codes. These are the one part of how the object looks that only you can invent — material/condition/scale/animation are decided separately afterward by a fixed rule, so don't worry about those here.
- uniqueDetail (optional): one short, specific visual detail that makes this exact object distinctive (e.g. "one ear is slightly folded").
- entityKind (one of: ${ENTITY_KINDS.join(", ")}) and placementRequirements classify how this thing exists in physical space — a SEPARATE question from what it means:
  - "creature" / "plant": animals, plants. Almost always canExistStandalone: true.
  - "environment_feature": ponds, rocks, streams, paths. Almost always canExistStandalone: true.
  - "standalone_object": a complete object that makes sense on its own with no support needed (a house key, a crayon, a cassette tape). canExistStandalone: true.
  - "supported_object": an object that needs a surface or container to make physical sense (a lamp needs a table, a toy needs a shelf/windowsill, a framed photo needs a wall). canExistStandalone: false. Set preferredAnchors to 1-3 values from: ${ANCHOR_TYPES.join(", ")} (ordered by preference), and environmentTags to a few open descriptive words for what kind of place fits (e.g. "interior", "domestic", "work", "academic", "outdoor").
  - "structure": the memory is fundamentally ABOUT a place/room/building itself, not an object within it (e.g. the memory is about a whole classroom, a childhood bedroom, an office). canExistStandalone: true. Include structureSuggestion.
  - CRITICAL RULE — architectural fragments (a window, a door, a shelf, a staircase, a desk-as-part-of-a-room) must NOT normally become the noun of a standalone entity, because they are structurally incoherent floating alone (a window with no wall isn't "a window out of context," it's not a coherent object at all). When a memory strongly evokes one of these, prefer ONE of:
    (a) treat it as a "supported_object" whose noun is still the specific thing (e.g. noun: "the windowsill decoration", or noun the actual small object sitting there) with an appropriate preferredAnchor (e.g. "windowsill" for a window-adjacent memory), letting it attach to a larger place rather than float alone, or
    (b) if the memory is really about the ROOM or PLACE itself, promote it to entityKind "structure" with a noun describing the whole place (e.g. "childhood bedroom" instead of "window"), and list the fragment in structureSuggestion.featuredElements (e.g. ["window"]).
    Do not over-apply this — a genuinely complete, self-supporting piece of furniture (a chair, a bookcase, a desk as an object, a bench) is still fine as a standalone/supported_object noun.
- structureSuggestion (only when entityKind is "structure", or optionally to hint at a supported_object's ideal container): semanticType is an open-text description of the place (e.g. "a small late-night university computer lab"); preferredTemplate is your best-fit guess from this FIXED list: ${STRUCTURE_TEMPLATES.join(", ")} (application code maps this to actual room geometry — pick the closest even if imperfect); featuredElements lists notable fragments/details visible in the place (e.g. ["window", "bookshelf"]).
- emotion values (valence, arousal, nostalgia) are each a number from 0 to 1.
- literal_anchors are concrete nouns/phrases pulled directly from the memory text.
- epitaph is a short, evocative phrase naming the object (e.g. "a reindeer on the window ledge").

Return only the structured JSON, no other text.

MEMORY:
`;

function buildPrompt(rawText: string): string {
  return PROMPT_INSTRUCTIONS + rawText;
}

// --- server-side validation / enum-repair -----------------------------------
//
// Per pipeline §26: repair category/fallbackArchetype against the closed
// enums, but noun/label/groundingEvidence are never touched here — an
// empty one is a hard failure that falls through to the deterministic path
// below, not something to silently paper over.

// A "supported_object" with no usable preferred anchor would silently dead-
// end lib/structures.ts's compatibility search — default to
// ["generic_surface"] rather than let that happen (repair, not reject: the
// LLM already correctly identified this needs support, it just didn't name
// a usable anchor).
function validatePlacementRequirements(raw: unknown, entityKind: EntityKind): PlacementRequirements {
  const r = (raw ?? {}) as Record<string, unknown>;
  const environmentTags = Array.isArray(r.environmentTags) ? r.environmentTags.map(String).filter((s) => s.length > 0) : [];
  const preferredAnchors = (Array.isArray(r.preferredAnchors) ? r.preferredAnchors.map(String) : []).filter((a): a is AnchorType =>
    (ANCHOR_TYPES as readonly string[]).includes(a)
  );
  const canExistStandalone = typeof r.canExistStandalone === "boolean" ? r.canExistStandalone : entityKind !== "supported_object";

  return {
    canExistStandalone,
    environmentTags,
    preferredAnchors: !canExistStandalone && preferredAnchors.length === 0 ? ["generic_surface"] : preferredAnchors,
  };
}

function validateStructureSuggestion(raw: unknown): StructureSuggestion | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const semanticType = String(r.semanticType ?? "").trim();
  if (!semanticType) return undefined;

  const rawTemplate = r.preferredTemplate ? String(r.preferredTemplate) : "";
  const preferredTemplate = rawTemplate
    ? (snapToNearest(rawTemplate, STRUCTURE_TEMPLATES) as StructureTemplateId)
    : undefined;

  return {
    semanticType,
    ...(preferredTemplate ? { preferredTemplate } : {}),
    ...(Array.isArray(r.featuredElements) ? { featuredElements: r.featuredElements.map(String) } : {}),
  };
}

function validateAndFixIR(raw: unknown): MemoryIR {
  const r = raw as Record<string, unknown>;
  const rawCandidates = Array.isArray(r.candidates) ? r.candidates : [];

  const candidates: SymbolCandidateDraft[] = rawCandidates.slice(0, 5).map((c) => {
    const cand = c as Record<string, unknown>;
    const noun = String(cand.noun ?? "").trim();
    const label = String(cand.label ?? "").trim();
    const groundingEvidence = Array.isArray(cand.groundingEvidence)
      ? cand.groundingEvidence.map(String).filter((s) => s.length > 0)
      : [];
    if (!noun || !label || groundingEvidence.length === 0) {
      throw new Error("candidate missing required open-vocabulary fields (noun/label/groundingEvidence)");
    }

    const fallbackArchetype = snapToNearest(String(cand.fallbackArchetype ?? ""), FALLBACK_ARCHETYPES);
    // category is repaired against fallbackArchetype's real category if it
    // doesn't line up — this is a renderer-bookkeeping repair, not a change
    // to noun/label.
    const claimedCategory = String(cand.category ?? "");
    const category: SymbolCategory = (SYMBOL_CATEGORIES as readonly string[]).includes(claimedCategory)
      ? (claimedCategory as SymbolCategory)
      : (categoryForFallbackArchetype(fallbackArchetype) ?? "object");

    const entityKind = snapToNearest(String(cand.entityKind ?? ""), ENTITY_KINDS) as EntityKind;
    const placementRequirements = validatePlacementRequirements(cand.placementRequirements, entityKind);
    const structureSuggestion = validateStructureSuggestion(cand.structureSuggestion);

    return {
      category,
      noun,
      label,
      fallbackArchetype: fallbackArchetype as FallbackArchetype,
      groundingEvidence,
      emotionalFit: clamp01(cand.emotionalFit),
      visualSuitability: clamp01(cand.visualSuitability),
      primaryColor: String(cand.primaryColor ?? "").trim() || "grey",
      secondaryColor: cand.secondaryColor ? String(cand.secondaryColor).trim() || undefined : undefined,
      uniqueDetail: cand.uniqueDetail ? String(cand.uniqueDetail).trim() || undefined : undefined,
      entityKind,
      placementRequirements,
      ...(structureSuggestion ? { structureSuggestion } : {}),
    };
  });

  if (candidates.length === 0) {
    throw new Error("IR had zero usable candidates");
  }

  const emotion = (r.emotion ?? {}) as Record<string, unknown>;
  const setting = (r.setting ?? {}) as Record<string, unknown>;

  return {
    summary: String(r.summary ?? ""),
    epitaph: String(r.epitaph ?? ""),
    literal_anchors: Array.isArray(r.literal_anchors) ? r.literal_anchors.map(String) : [],
    themes: Array.isArray(r.themes) ? r.themes.map(String) : [],
    emotion: {
      valence: clamp01(emotion.valence),
      arousal: clamp01(emotion.arousal),
      nostalgia: clamp01(emotion.nostalgia),
    },
    setting: {
      indoors: Boolean(setting.indoors),
      season: String(setting.season ?? "unknown"),
      time_of_day: String(setting.time_of_day ?? "unknown"),
    },
    candidates,
  };
}

// --- Gemini call -----------------------------------------------------------

// Free-tier Gemini has both a daily cap and a requests-per-minute cap; the
// per-minute one is the one a seeding run actually hits. On 429, Gemini's
// error body includes a RetryInfo.retryDelay hint (e.g. "54s") — wait that
// long plus a small buffer and retry once, rather than immediately falling
// back/flagging good content just because of a transient burst. If the
// retry also 429s, this gives up and lets the caller's existing fallback
// logic handle it as before.
async function fetchGeminiWithRetry(url: string, body: unknown): Promise<Response> {
  const doFetch = () =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  let res = await doFetch();
  if (res.status === 429) {
    const errorText = await res.text();
    let retrySeconds = 5;
    try {
      const parsed = JSON.parse(errorText);
      const retryInfo = (parsed?.error?.details ?? []).find(
        (d: { "@type"?: string }) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
      );
      const match = /^(\d+(?:\.\d+)?)s$/.exec(retryInfo?.retryDelay ?? "");
      if (match) retrySeconds = Math.min(parseFloat(match[1]), 60);
    } catch {
      // unparseable body — use the default above
    }
    console.warn(`[llm] 429 rate limited, waiting ${retrySeconds}s before one retry`);
    await new Promise((r) => setTimeout(r, (retrySeconds + 1) * 1000));
    res = await doFetch();
  }
  return res;
}

export async function callGeminiJSON(prompt: string, schema: object, safetySettings?: unknown): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const res = await fetchGeminiWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
      ...(safetySettings ? { safetySettings } : {}),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("Gemini response missing text part");
  }
  return JSON.parse(text);
}

async function callGemini(rawText: string): Promise<MemoryIR> {
  const raw = await callGeminiJSON(buildPrompt(rawText), IR_SCHEMA);
  return validateAndFixIR(raw);
}

// --- deterministic fallback --------------------------------------------------

// Not exhaustive — covers the more literal, common cases. Anything else
// falls through to the seeded-random archetype pick below.
const KEYWORD_SYNONYMS: Partial<Record<FallbackArchetype, string[]>> = {
  deer: ["deer", "reindeer"],
  cat: ["cat", "kitten", "kitty"],
  bird: ["bird", "sparrow", "robin"],
  fish: ["fish", "goldfish"],
  tree: ["tree", "oak", "pine"],
  flower: ["flower", "rose", "daisy"],
  book: ["book", "novel", "story"],
  bridge: ["bridge"],
  kettle: ["kettle", "teapot"],
};

function keywordMatchArchetype(rawText: string): FallbackArchetype | null {
  const lower = rawText.toLowerCase();
  for (const archetype of FALLBACK_ARCHETYPES) {
    const words = KEYWORD_SYNONYMS[archetype] ?? [archetype];
    if (words.some((w) => lower.includes(w))) return archetype;
  }
  return null;
}

const SEASONS = ["winter", "spring", "summer", "autumn"];
const TIMES_OF_DAY = ["morning", "afternoon", "evening", "night"];
const FALLBACK_COLORS = ["burgundy", "cream", "moss", "ochre", "slate", "dusty-rose", "ivory", "charcoal", "sage", "amber"];
const FALLBACK_DETAILS = [
  "a small chip on one edge",
  "a faint scratch along the side",
  "slightly uneven stitching",
  "a corner worn smooth",
];

// The deterministic fallback can't invent a specific open-vocabulary noun
// the way the LLM can — it honestly falls back to the fallback archetype
// itself as the noun/label, rather than fabricating false specificity.
function fallbackIR(rawText: string): MemoryIR {
  const rand = mulberry32(hashString(rawText));
  const winner = keywordMatchArchetype(rawText) ?? pick(FALLBACK_ARCHETYPES, rand);

  const others: FallbackArchetype[] = [];
  while (others.length < 4) {
    const candidate = pick(FALLBACK_ARCHETYPES, rand);
    if (candidate !== winner && !others.includes(candidate)) others.push(candidate);
  }

  // Same honesty principle as the noun/label fallback above: this path
  // can't meaningfully judge whether something needs support, so it always
  // defaults to standalone/canExistStandalone — the safe, always-
  // renderable choice — rather than guessing at placement requirements it
  // has no basis for.
  const candidates: SymbolCandidateDraft[] = [winner, ...others].map((archetype, i) => ({
    category: categoryForFallbackArchetype(archetype) ?? "object",
    noun: archetype,
    label: `a ${archetype}`,
    fallbackArchetype: archetype,
    groundingEvidence: i === 0 ? ["fallback keyword match against the raw memory text"] : ["fallback candidate — no LLM available"],
    emotionalFit: rand(),
    visualSuitability: rand(),
    primaryColor: pick(FALLBACK_COLORS, rand),
    secondaryColor: pick(FALLBACK_COLORS, rand),
    uniqueDetail: pick(FALLBACK_DETAILS, rand),
    entityKind: "standalone_object" as const,
    placementRequirements: { canExistStandalone: true, environmentTags: [], preferredAnchors: [] },
  }));

  return {
    summary: rawText,
    epitaph: rawText.slice(0, 40),
    literal_anchors: [],
    themes: [],
    emotion: { valence: rand(), arousal: rand(), nostalgia: rand() },
    setting: {
      indoors: rand() > 0.5,
      season: pick(SEASONS, rand),
      time_of_day: pick(TIMES_OF_DAY, rand),
    },
    candidates,
  };
}

// --- public entry point ------------------------------------------------------

export async function extractMemoryIR(
  rawText: string
): Promise<{ ir: MemoryIR; source: "llm" | "fallback" }> {
  try {
    const ir = await callGemini(rawText);
    console.log("[llm] IR extraction: llm");
    return { ir, source: "llm" };
  } catch (err) {
    console.error("[llm] Gemini call failed, using fallback:", err);
    return { ir: fallbackIR(rawText), source: "fallback" };
  }
}

// --- Step 1.3 — moderation --------------------------------------------------
//
// Gemini has no dedicated free moderation endpoint like OpenAI's. First
// attempt repurposed generateContent's safety filtering (checking
// promptFeedback.blockReason with maxOutputTokens=1) — that FAILED
// verification: safetyRatings/blockReason score the model's generated
// OUTPUT, not the input prompt, so requesting ~0 output means ~nothing to
// rate as harmful regardless of how bad the input is. Confirmed directly
// against the API: a blunt violent threat came back NEGLIGIBLE across every
// category.
//
// This instead runs a real classification call — same structured-output
// pattern as IR extraction, just asking the model to judge the text and
// return {flagged, reason}. safetySettings are set to BLOCK_NONE on this
// call specifically, so the classifier doesn't refuse to even look at
// content it's supposed to be judging. Explicitly instructed not to flag
// dark/sad memories (grief, loss, fear) — those are core content this app
// wants, not something to moderate away.
//
// Fails CLOSED: if the call itself errors (bad key, network, unparseable
// response, or the model refusing to respond at all), this returns
// flagged=true rather than letting unmoderated content through. For a
// public, unauthenticated demo, hiding a real submission until someone
// checks is a much cheaper mistake than letting something vile go live
// because the moderation call hiccuped.

const MODERATION_SCHEMA = {
  type: "OBJECT",
  properties: {
    flagged: { type: "BOOLEAN" },
    reason: { type: "STRING" },
  },
  required: ["flagged", "reason"],
};

const MODERATION_PROMPT = `You are a content moderation classifier for a public, unauthenticated art installation where strangers submit short personal memories, which get turned into symbolic objects in a shared world.

Flag (flagged: true) content that is itself: a direct threat of violence, harassment or targeted abuse, hate speech, sexual content involving minors, or otherwise clearly inappropriate for public display.

Do NOT flag content just because it is sad, dark, or difficult — memories of grief, loss, fear, surviving abuse, or mental health struggles are exactly what this installation is for. Only flag content that is itself abusive, hateful, or threatening — not a memory that describes having experienced something bad.

Respond with structured JSON only: {"flagged": boolean, "reason": string}.

TEXT:
`;

const MODERATION_SAFETY_SETTINGS = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_NONE" }));

export async function moderateText(rawText: string): Promise<{ flagged: boolean }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[moderate] GEMINI_API_KEY not set — failing closed (flagged=true)");
    return { flagged: true };
  }

  try {
    const parsed = (await callGeminiJSON(
      MODERATION_PROMPT + rawText,
      MODERATION_SCHEMA,
      MODERATION_SAFETY_SETTINGS
    )) as { flagged?: unknown; reason?: unknown };

    const flagged = Boolean(parsed.flagged);
    console.log(`[moderate] flagged=${flagged} reason=${parsed.reason ?? "n/a"}`);
    return { flagged };
  } catch (err) {
    console.error("[moderate] call failed, failing closed (flagged=true):", err);
    return { flagged: true };
  }
}
