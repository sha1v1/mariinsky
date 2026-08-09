# Memory World — Implementation Plan

Companion to `memory_world_spec.md`. That document is the *what*. This is the *order*.

---

## WORKING AGREEMENT (read this first, Claude Code)

**Rules for this session:**

1. **You do not touch git.** No `git add`, `git commit`, `git checkout`, `git branch`, `git stash`, `git reset`. I handle all version control myself. If you think something should be committed, say so and stop.
2. **One step at a time.** Implement exactly the step I name, then stop and tell me: what you changed, which files, and the exact command or click I should use to verify it. Do not start the next step.
3. **Do not skip ahead or "helpfully" scaffold future steps.** If step 4 needs a stub, write the stub, not the feature.
4. **Talk to me when you hit a decision.** Ambiguity, a missing credential, a library that doesn't behave, a schema choice not covered here — stop and ask. Do not guess and proceed.
5. **Do not refactor code outside the current step.** If you spot something wrong elsewhere, mention it and leave it alone.
6. **Deps:** installing a package listed in this plan is fine. Installing anything *not* listed — ask first.
7. **No test framework.** Verification is manual: a curl command or a thing I look at in the browser. Every step below tells you which.
8. **Secrets live in `.env.local`.** Never inline a key, never print a key, never commit one (see rule 1).
9. **If a step's verification fails,** fix it within that step. Don't move on with something half-working and don't paper over it with a try/catch that swallows the error.

**Stack:** Vite + React (TypeScript) · Vercel serverless functions (`/api/*.ts`) · Supabase Postgres + pgvector · Canvas 2D · one multimodal LLM · `Xenova/bge-small-en-v1.5` (transformers.js, local, 384-dim) for embeddings.

**Target file layout:**

```
src/
  main.tsx                    Vite entry
  App.tsx                     world view
api/
  submit.ts
  world.ts
  memory/[id].ts
  memory/[id]/visit.ts
  tick.ts
lib/
  supabase.ts                 server client
  llm.ts                      IR extraction + moderation + symbol candidates + entity/placement classification
  embed.ts                    embedding calls
  score.ts                    candidate scoring
  visualspec.ts                VisualObjectSpec derivation (rule-based, separate step from symbol selection, no LLM call)
  imagegen.ts                  render prompt + generated asset pipeline
  place.ts                    anchor placement (standalone entities only — see placementPipeline.ts)
  structures.ts                 world hierarchy: structure selection/scoring/creation, anchor occupancy
  placementPipeline.ts          orchestrates standalone vs. supported_object vs. structure placement (§16 of the world-hierarchy addendum)
  consolidate.ts              clustering pass
  ontology.ts                  closed enums + FALLBACK_ARCHETYPES_BY_CATEGORY (renderer safety net) + EntityKind/AnchorType/StructureTemplateId/STRUCTURE_DEFS
  types.ts                    SymbolIdentity, SymbolCandidate, VisualObjectSpec, PlacementRequirements, StructureRow, MemoryIR, MemoryRow
components/
  World.tsx                   canvas + camera
  Sprite.ts                   generated asset (if present) or fallback archetype → draw, visual_spec → modifiers
  Structure.ts                   crude rectangle + anchor-dot rendering for structures (no cutaway art yet)
  SubmitPanel.tsx
  RevealPanel.tsx
data/
  anchors.json                generated in step 0
public/sprites/               fallback archetypes, by category (renderer safety net only)
scripts/
  gen-anchors.ts
  seed.ts
```

---

# PHASE 0 — PREP (before the clock starts)

## Step 0.1 — Project skeleton

Create the Vite + React TypeScript app (with a top-level `/api` directory for Vercel serverless functions), install `@supabase/supabase-js`. Everything stays local from here on — no deploy until Phase 5.

**Verify:** `npm run dev` loads the placeholder in a browser.

## Step 0.2 — Supabase schema

Create the Supabase project manually (I'll do this and give you the keys). Then write `supabase/schema.sql` with the `memories` table per spec §14, **extended** per `memory_world_symbol_grounding_render_pipeline.md` §24 to store the symbol-grounding layers separately:

- `category` (text, closed enum), `noun` (text, open), `label` (text, open), `fallback_archetype` (text, closed enum), `grounding_evidence` (jsonb array)
- `visual_spec` (jsonb: `material`, `custom_material`, `condition`, `scale`, `animation`, `primary_color`, `secondary_color`, `glow`, `unique_detail`, `preferred_placement`, `explanation[]`)
- `generated_asset_url` (text, nullable), `render_status` (text: `pending`|`generated`|`fallback`|`failed`, default `pending`)

Do not collapse these into one `attributes` blob — the semantic identity (`category`/`noun`/`label`/`fallback_archetype`) and the render controls (`visual_spec`) are separate layers and must stay separately editable/queryable.

**World hierarchy addition** (added later, `supabase/migrations/004_structures.sql`): a `structures` table (`template_id, noun, label, semantic_tags, x, y, anchors jsonb`, created before `memories` since it's an FK target) plus five new `memories` columns — `entity_kind`, `environment_tags`, `preferred_anchors`, `structure_id` (references `structures`), `anchor_id`. Purely additive when applied to an existing table; on a fresh `schema.sql` run, `entity_kind` is `not null` since every row the current pipeline writes sets it. `structures.anchors` is application-owned geometry (deep-copied from `STRUCTURE_DEFS` in `lib/ontology.ts` at creation time) — the LLM never sees or invents anchor coordinates.

> Embedding model is `Xenova/bge-small-en-v1.5` (transformers.js, local, no API key) — 384 dimensions, so `vector(384)`, not the OpenAI-default `vector(1536)`.

**Verify:** `select * from memories;` returns zero rows and no error. `\d memories` shows all three indexes. `select * from structures;` returns zero rows and no error.

## Step 0.3 — Fallback sprite assets

I generate the fallback archetype sprites — one per entry in `FALLBACK_ARCHETYPES_BY_CATEGORY` (pipeline §4: creature, plant, object, architecture, natural — ~39 total; `architecture` shrank from 8 to 4 in the world-hierarchy refactor, see Phase 1's header note — `window`/`door`/`shelf`/`stairs` are no longer top-level fallback archetypes), saved under `public/sprites/<category>/`. These are **not** the semantic ontology; they're only the renderer's safety net for when custom asset generation fails or hasn't finished yet (§21–22). You write `scripts/check-sprites.ts` that reads `FALLBACK_ARCHETYPES_BY_CATEGORY` from `lib/ontology.ts` and reports which fallback archetypes are missing a PNG.

**Verify:** script lists exactly the archetypes I haven't made yet.

## Step 0.4 — Anchors

Write `scripts/gen-anchors.ts`: embed the 10 anchor phrases from spec §11, assign each a position on a circle of radius 1200 centred at origin, write `data/anchors.json` as `[{name, embedding, x, y}]`.

**Verify:** `anchors.json` exists, has 10 entries, each embedding has the right dimension, and the 10 (x,y) points are evenly spaced on the circle.

---

# PHASE 1 — PIPELINE (hours 0–2)

Backend only. Nothing renders yet. Resist the urge.

**Symbol-grounding rule for this phase** (`memory_world_symbol_grounding_render_pipeline.md` §0–2, §31): object identity — `category` + `noun` + `label` — is open-vocabulary and, once selected, immutable by every later stage. Only renderer-facing controls (`material`, `condition`, `scale`, `animation`, `glow`, `preferredPlacement`, `fallbackArchetype`) are closed enums. The fallback archetype list is a rendering safety net, never the actual ontology — don't let any prompt or validation step treat it as one.

**World-hierarchy rule, added on top of that (architecture refactor):** a memory should not only determine *what* enters the world — it should also determine *what that thing needs in order to meaningfully exist there*. Not every symbol can stand alone: a lamp needs a table, a window needs a wall. `entityKind`/`placementRequirements` (closed enum + structured support requirements, decided in the same Step 1.2 call) drive a branch in placement (Step 1.6): standalone entities still get the plain anchor-circle `(x,y)`; anything that needs support finds or creates a shared **structure** and occupies one of its **anchors** instead. Architectural fragments (window, door, shelf, stairs) are retired as top-level nouns for exactly this reason — see the `architecture` category's shrunk fallback list below.

## Step 1.1 — Submit skeleton, no intelligence

`POST /api/submit` accepting `{ input_type: "text", raw_text: string }`. Hardcode everything downstream: `category: "natural"`, `noun: "stone"`, `label: "a plain grey stone"`, `fallback_archetype: "stone"`, empty `visual_spec`, `render_status: "fallback"`, random x/y in ±500, `epitaph = raw_text.slice(0,40)`. Insert and return the row.

**Verify:**
```bash
curl -X POST localhost:3000/api/submit \
  -H 'content-type: application/json' \
  -d '{"input_type":"text","raw_text":"my dad teaching me to ride a bike"}'
```
Returns a row with an id. The row is visible in the Supabase table editor.

**This step exists to prove the plumbing works before any AI is involved.** Do not combine it with step 1.2.

## Step 1.2 — Memory IR extraction + symbol candidates

`lib/ontology.ts`: closed enums only — `SYMBOL_CATEGORIES` (`creature`/`plant`/`object`/`architecture`/`natural`), `MATERIALS`, `CONDITIONS`, `SCALES`, `ANIMATIONS`, `PLACEMENT_TYPES`, and `FALLBACK_ARCHETYPES_BY_CATEGORY` (the old 40-item list, kept only as the renderer's fallback safety net — pipeline §2–4). `lib/types.ts`: `SymbolIdentity` and `SymbolCandidate` (§11, §16) — `category` and `fallbackArchetype` are closed, `noun` and `label` are **open vocabulary**. `lib/llm.ts`: one call producing the IR JSON from spec §8 plus 5 symbol candidates, with structured output enforced.

**Call-reduction decision:** each candidate also carries its own `primaryColor`/`secondaryColor`/`uniqueDetail` in this *same* call — the free-text descriptive attributes that genuinely need a model's judgment. Step 1.5's `material`/`condition`/`scale`/`animation`/`glow`/`preferredPlacement` are all closed enums instead, derivable by rule from the emotion scores this call already produces — so they don't need a model call at all (see Step 1.5). This keeps total Gemini calls per submission at 2 (moderate + this call) instead of 3, without weakening anything: the hard-to-derive bits still come from the model, and nothing enum-shaped depends on it.

The candidate-generation prompt must state the rule from pipeline §25 explicitly: the object noun is open vocabulary, not restricted to the fallback archetype list, and a concrete object grounded in specific memory detail should outrank a generic emotional metaphor (§17 — no defaulting `love → heart`, `nostalgia → candle`). Every candidate still needs a valid `category` and `fallbackArchetype` — those are validated against the closed enums.

Then **validate server-side** per §26: reject/repair if `category` isn't a valid enum value, `fallbackArchetype` isn't a valid enum value, or `noun`/`label`/`groundingEvidence` is empty. If `category` or `fallbackArchetype` is invalid, snap to the closest legal value by string similarity — never touch `noun` or `label` during that repair. If the whole call fails or returns unparseable JSON, fall back to keyword→archetype matching (for `category`/`fallbackArchetype` only) with `noun`/`label` set from a truncated slice of the raw text, and colors/detail seeded from `hash(raw_text)`. Log which path was taken.

**World hierarchy addition:** each candidate also carries `entityKind` (`standalone_object` / `supported_object` / `creature` / `plant` / `environment_feature` / `structure`, closed) and `placementRequirements` (`canExistStandalone: boolean`, `environmentTags: string[]`, `preferredAnchors: AnchorType[]`), plus an optional `structureSuggestion` (`semanticType`, `preferredTemplate`, `featuredElements[]`) when the candidate is or wants a structure. The prompt explicitly forbids emitting a bare architectural fragment (window/door/shelf/stairs) as a standalone noun — the model should either mark it `supported_object` with an appropriate anchor, or promote it to a `structure` candidate describing the whole place, folding the fragment into `structureSuggestion.featuredElements`. Validate: `entityKind` snapped to the closest enum value; `preferredAnchors` entries not in the closed `AnchorType` list are dropped (not snapped — a wrong anchor guess is worse than a missing one); a `supported_object` left with zero preferred anchors after that gets a safe `["generic_surface"]` default rather than dead-ending placement.

Wire it into `/api/submit` replacing the hardcoded values.

**Verify:** submit the Christmas reindeer memory from the spec. Response contains a plausible IR with 5 candidates, each with an open-vocabulary `noun`/`label` (e.g. "tiny felt reindeer toy", not just "deer") plus a valid closed `fallbackArchetype`, a descriptive `primaryColor`, an `entityKind`, `literal_anchors` including "reindeer", and emotion values that aren't all 0.5. Then temporarily point the LLM at a bad model name and confirm the fallback still returns a usable row instead of a 500.

## Step 1.3 — Moderation

Moderation check as the **first** thing in `/api/submit`, before any other call. On failure, still insert the row but set `flagged = true`, and return `{ flagged: true }` without the object details.

**Verify:** submit something obviously abusive. Row exists with `flagged = true`. Submit the reindeer memory. `flagged = false`.

**Do this now, not later.** It's 15 minutes and it's the difference between a demo and an incident.

## Step 1.4 — Embeddings and candidate scoring

`lib/embed.ts`: batched embedding call. `lib/score.ts`: the five-term score from pipeline §18 — `finalScore = 0.45·semanticFit + 0.20·specificity + 0.15·emotionalFit + 0.10·visualSuitability + 0.10·novelty`, all terms in `[0,1]`.

One batched call embeds `ir.summary` plus all 5 `candidate.label` strings. Compute `semanticFit`, `specificity`, `emotionalFit`, `visualSuitability`, and `novelty` (novelty needs `select count(*) from memories where fallback_archetype = $1` — grouped by the closed `fallbackArchetype`, since `noun` is open vocabulary and unbounded). Pick the winner by `finalScore`. Persist the full candidate array *with scores and groundingEvidence* into `candidates`, the winning `SymbolIdentity` (`category`, `noun`, `label`, `fallback_archetype`, `grounding_evidence`) into its own columns, and the summary embedding into `embedding`.

**Verify:** submit the reindeer memory and print the scored candidate table to the console. The reindeer-shaped candidate should win on `finalScore`, and its `noun`/`label` should stay specific ("tiny felt reindeer toy", not generic "deer") even though `fallback_archetype` is `deer`. Then submit five more beach memories in a row and confirm the sixth one's `shell`-fallback-archetype novelty score has visibly dropped.

That last check is the one worth actually doing — it's the proof that world state feeds back into interpretation.

## Step 1.5 — Visual specification generation (rule-based, no LLM call)

`lib/visualspec.ts`: a **separate** step, run only after the winning `SymbolIdentity` is picked (pipeline §19) — but a deterministic function, not a third Gemini call (see the call-reduction decision under Step 1.2). Input is the winning candidate (including its `primaryColor`/`secondaryColor`/`uniqueDetail` from Step 1.2) plus the Memory IR; output is `VisualObjectSpec` (§12) — `material`/`condition`/`scale`/`animation`/`glow` (`0–1`)/`preferredPlacement` derived by rule from `ir.emotion` (valence/arousal/nostalgia) and `ir.setting`, following pipeline §6's tendencies (nostalgia → worn/faded/aged, fragility → cracked, freshness → new/pristine, outdoor exposure → weathered) as literal thresholds; `explanation[]` built from a small set of templated sentences referencing the actual emotion values and the winning candidate's `groundingEvidence`. Seeded off the winning `noun`/`label` (same `hashString`/`mulberry32` approach as `lib/llm.ts`'s fallback path) so a given memory always derives the same look. This step must never change `noun` or `label` — it doesn't even receive them as writable fields.

Validate per §26: every enum field is drawn directly from the closed lists in `lib/ontology.ts`, so nothing here can produce an invalid value to repair. `material` is picked from a category-appropriate subset and never resolves to `"other"` in this path, so `customMaterial` isn't needed here. Persist into `visual_spec` (jsonb) alongside `symbol_identity` — per §24, keep these two layers distinct rather than merging them.

**Verify:** submit the reindeer memory. `symbol_identity.noun` stays `"reindeer"` while `visual_spec` independently derives `material`, `scale`, `animation`, etc. from the IR's emotion scores. Submit the same memory text twice and confirm `visual_spec` comes out identical both times (deterministic, not re-rolled). Submit a low-valence/low-arousal memory and a high-valence/high-arousal one back to back and confirm `condition`/`animation` visibly differ between them.

## Step 1.6 — Placement (anchor circle, or structure + anchor)

`lib/place.ts` implements the anchor-circle algorithm from spec §11 exactly: cosine against all 10 anchors → z-score → softmax at T=0.35 → keep top-3, renormalize → weighted centroid → jitter ±40 → 3 iterations of repulsion against neighbours within 60px (query by bounding box, not by embedding). **The z-score step is load-bearing.** Without it every memory lands near the origin.

**World hierarchy branch:** `lib/placementPipeline.ts` decides *which* placement a winning candidate gets, based on its `entityKind`/`placementRequirements` from Step 1.2 — this is now the thing `/api/submit` actually calls, not `place.ts` directly:

- `entityKind === "structure"` → the memory describes a whole place, not an object needing one. Always creates a **new** `structures` row (never reuses an existing one — see rationale in `lib/structures.ts`'s comment; reuse would silently merge unrelated contributors' distinct "this is my memory of a place" entities). Template comes from `structureSuggestion.preferredTemplate`, mapped down via `STRUCTURE_TEMPLATE_FALLBACK_MAP` to whichever of the P0-implemented templates (`small_house`, `office`) it's closest to; global position via the same anchor-circle algorithm, embedding the structure's own tags.
- `placementRequirements.canExistStandalone === true` (covers `standalone_object`/`creature`/`plant`/`environment_feature`) → the plain anchor-circle `(x,y)` above, unchanged.
- otherwise (`supported_object`) → `lib/structures.ts` searches existing `structures` for one exposing a free anchor matching `preferredAnchors`, scored by `tagOverlap(environmentTags, structure.semantic_tags) + anchorRankBonus − overcrowdingPenalty` (the spec's simplified P0 formula — `localMemorySimilarity` is skipped, see the file's own comment for why). Picks the best; if none qualify, creates a new structure the same way a `structure`-kind memory does, then occupies whichever anchor is free. The final `(x,y)` is precomputed as `structure.x/y ± anchor.localX/Y`, so `/api/world`'s bbox query never needs to know about structures to find memory rows — only to also fetch the structures themselves for rendering (Step 2.1).

Anchor occupancy can't be marked until the memory row has an id — `markAnchorOccupied` runs as a follow-up call right after insert, not as part of it.

**Verify:** submit 6 deliberately varied *standalone* memories (a home one, a loss one, a travel one, a food one, a fear one, a work one) and print their coordinates plus their top anchor. Each should land near a *different* anchor, and no two should be within 60px. Then submit a memory that clearly needs support (e.g. "a small desk lamp I did homework under") and confirm: a `structures` row gets created (or reused, on a second similar submission) with a real `template_id`, the object's `structure_id`/`anchor_id` are set, and its `(x,y)` lands inside that structure's footprint, not out on the anchor circle.

## Step 1.7 — Seeder

`scripts/seed.ts`: 200 synthetic memories through the real pipeline. Write the source memories as a hand-written list in the script — varied, realistic, ordinary. Include deliberate clusters: ~15 that are clearly about Christmas/winter/family, ~15 about school, ~15 about grandparents. Consolidation later needs something to bite on.

Add a `--dry-run` flag that prints without inserting.

**Verify:** run with 20 first, check the table, then run the full 200. Then plot: dump all x/y to a CSV and eyeball a scatter (any quick tool). **If it's one blob, stop and tell me — placement is wrong and everything downstream depends on it.** You should see roughly 10 lobes.

---

# PHASE 2 — WORLD (hours 2–5) — CRITICAL PATH

If this phase isn't done by hour 5, we cut features, not quality.

## Step 2.1 — World endpoint

`GET /api/world?x0&y0&x1&y1` returning visible objects (`parent_id is null and flagged = false`) in the viewport bbox, with only the fields the renderer needs: `id, x, y, category, fallback_archetype, generated_asset_url, render_status, visual_spec, label, epitaph, is_composite, child_count`. Cap at 800 rows.

**World hierarchy addition:** the response shape is `{ objects: [...], structures: [...] }`, not a flat array — a breaking change from the original single-array contract, since the renderer needs `structures` (`id, template_id, noun, label, x, y, anchors`) in the same viewport to draw underneath the objects sitting at their anchors. Query both tables in parallel (`Promise.all`), capped separately (800 objects / 200 structures).

**Verify:** `curl 'localhost:3000/api/world?x0=-2000&y0=-2000&x1=2000&y1=2000'` returns `{objects: [...], structures: [...]}`, no embeddings, `grounding_evidence`, or `candidates` on the objects (huge and reveal-panel-only — make sure they're excluded).

## Step 2.2 — Crude canvas

`components/World.tsx`: full-screen canvas, fetch `/api/world` once on mount, draw each object as a **coloured circle** — colour from `visual_spec.primaryColor`, radius from `visual_spec.scale`. No sprites, no camera, fixed view fitting the whole world.

**Verify:** open the page. See ~200 dots in roughly 10 lobes. This should look like the scatter plot from step 1.7.

Deliberately ugly. We're proving data flows to pixels.

## Step 2.3 — Camera

Pan by drag, zoom by wheel/pinch, clamped to sane bounds. Refetch `/api/world` with the new viewport bbox on pan/zoom end (debounced 300ms). Screen↔world coordinate helpers in one place, used by everything after this.

**Verify:** drag around, zoom in and out on a phone and a laptop. Objects stay pinned to their world coordinates. Network tab shows debounced refetches, not one per frame.

## Step 2.4 — Fallback sprite rendering

`components/Sprite.ts`: given `{fallback_archetype, visual_spec}`, draw the fallback PNG with `visual_spec` modifiers applied — colour multiply from `primaryColor`, scale from `scale`, alpha/desaturation from `condition`, a glow pass from `glow`, and the `animation` value driving a slow sine on y-offset or rotation. Implement each of the 8 closed animation values explicitly per pipeline §9 (`still`, `slow_breathing`, `gentle_sway`, `flicker`, `drift`, `pulse`, `bob`, `asymmetric_wobble`) — no free-text motion strings.

Preload all fallback sprites once into an image cache. Missing sprite → draw the step 2.2 circle, don't crash.

**Verify:** the reindeer memory — still `render_status: "fallback"` at this point, since there's no image-gen pipeline yet — renders as a visibly *worn, burgundy, miniature* deer sprite, not a default deer. Zoom out to 200 objects: it should read as a world, and the frame rate should hold.

## Step 2.5 — Structure rendering (world hierarchy) ✅ mechanism implemented, art pending

`components/Structure.ts`: given a structure (`template_id, label, x, y, anchors`), draw real cutaway/dollhouse art (`public/structures/<template_id>.png`, see `scripts/process-structure-art.ts`) sized to `STRUCTURE_DEFS[template_id]`'s `width`/`height` when it exists; otherwise fall back to the original labeled, tinted rectangle. Same "missing sprite → circle, don't crash" pattern as `Sprite.ts`, one level up — art can land per-template independently and is picked up automatically on next preload, no code change needed. Anchor dots (dim if `occupiedByMemoryId` is set, brighter if free) draw on top either way, so occupancy stays legible over real art too.

Wire into `World.tsx`: `preloadStructureArt(IMPLEMENTED_STRUCTURE_TEMPLATES)` alongside `preloadSprites`; draw all structures in the viewport *before* the memory-object loop, so occupants render on top; skip drawing a structure-kind memory's *own* row through the normal sprite path (its render is the structure box, not some `fallback_archetype` icon sitting at the same x/y — `FALLBACK_ARCHETYPES_BY_CATEGORY` has nothing meaningful for "a whole room" and would otherwise render something arbitrary and wrong there, e.g. a "bench" icon inside a bedroom).

Real art requires the anchor `localX`/`localY` coordinates in `STRUCTURE_DEFS` to be recalibrated per delivered image (they were placed for a schematic box, not any specific artwork) — expect a manual pass once art lands, eyeballing where the window/desk/shelf/etc. actually sit in the image.

**Verify:** submit a memory needing support (e.g. a desk lamp). A structure (rectangle placeholder, or real art once supplied) appears with a glowing dot at the matching anchor position, and the object's own sprite renders right on top of that dot. Submit a second, thematically similar memory and confirm it joins the *same* structure (a second occupied anchor, not a second rectangle) rather than always creating a new one. Submitting a structure-kind memory (e.g. "a nostalgic childhood bedroom") near existing objects/structures must not visually overlap them — placement runs `repelFromFootprints` (`lib/place.ts`), a second repulsion pass aware of each structure's real footprint, on top of the base 60px point-repulsion spec formula (which only knows point-sprites, not ~420×320 boxes).

## Step 2.6 — Generated asset pipeline

`lib/imagegen.ts`: build the render prompt from `VisualObjectSpec` per pipeline §20 — subject is the `label`, plus material/condition/colors/uniqueDetail and a fixed storybook-miniature style block. **Never** send the raw memory text to the image model; the semantic layer has already decided what the object means. Call the image generator, remove the background, upload the result to Supabase Storage, and set `generated_asset_url` + `render_status: "generated"`.

On any failure, leave `generated_asset_url` null and set `render_status: "fallback"` — per §22/§28, a failed generation must never lose the contribution, and it must never change `noun`/`label`, only which pixels get drawn. Run this async, after the row is already inserted and visible with its fallback sprite — never block `/api/submit` on it (§21).

Update `Sprite.ts`: if `generated_asset_url` is present, draw that texture instead of the fallback PNG, with the same `visual_spec` scale/animation/glow applied on top (§23 `RenderableMemoryObject` contract — renderer always prefers the generated asset when available, falls back otherwise).

**Verify:** submit a memory, watch it render immediately with its fallback sprite, then swap to the generated image within a few polls once `render_status` flips to `generated`. Kill the image-gen call (bad key) and confirm the row stays on the fallback sprite indefinitely instead of erroring or disappearing.

---

# PHASE 3 — INTERACTION (hours 5–7)

## Step 3.1 — Submit UI ✅ implemented

`components/SubmitPanel.tsx`: a fixed bottom-center form over the canvas — textarea, character counter, submit button, loading state. POSTs `{input_type: "text", raw_text}` to `/api/submit`; on `flagged: true` shows an inline notice instead of inserting anything; on a real row it clears the textarea and hands the row up via an `onSubmitted` callback. It doesn't touch World's state itself — just reports what came back.

`World.tsx` owns the reaction: `handleSubmitted` appends the row to local `objects` state immediately (optimistic — visible before any refetch), then `flyCameraTo(x, y)` starts a `CameraFlight` (new in `lib/camera.ts`: `stepCameraFlight`/`easeOutCubic`, pure functions, no timers) that the existing `draw()` render loop steps every frame — zooming in to at least 0.6 if the camera was further out than that. The flight calls the same `scheduleRefetch()` pan/zoom already use each frame, so once it settles the debounced `/api/world` refetch fires once and reconciles the optimistic insert against the server's row (no dupe — same id) and picks up a newly-created `structures` row if the submitted memory was `entity_kind: "structure"`.

**Verify:** submit from the browser. Object appears and the camera moves to it in under 3 seconds — confirmed via Playwright: textarea clears, no console errors, screenshots show the camera zoomed into the submission's neighborhood with real sprite art (not blobs) and the underlying structure rectangle where applicable.

## Step 3.2 — Polling

Poll `/api/world` every 3s for the current viewport. New objects fade in. Do not re-fetch or re-create sprites for objects already on screen.

**Verify:** two browser windows. Submit in A, object appears in B within 3 seconds, without B's camera jumping or flickering.

## Step 3.3 — Reveal panel

`GET /api/memory/:id` returning the full record, its children if composite, and 5 nearest neighbours by pgvector cosine (excluding itself and anything flagged). `POST /api/memory/:id/visit` incrementing `visits` and bumping `last_visit`, fired on open.

`components/RevealPanel.tsx` laid out as spec §16: epitaph, raw memory, "this memory became: `<label>`" (pipeline §22 — always the open-vocabulary `noun`/`label`, never the `fallback_archetype`, regardless of `render_status`), "why this object" derived from `grounding_evidence` + `literal_anchors` + emotion, "also considered" showing the other `SymbolCandidate`s with their own open `noun`/`label` and real scores, "nearby by meaning" with clickable neighbours.

**Verify:** click any seeded object. Panel shows a real memory, the specific `label` (not the generic fallback archetype name) even for rows still on `render_status: "fallback"`, real candidate scores, and 5 neighbours that are *actually thematically related*. Clicking a neighbour flies the camera there and opens its panel.

**This is the highest-value four seconds of the demo.** Make it look good.

## Step 3.4 — Local end-to-end check

Confirm the full pipeline works end to end against the local dev server, reachable from a phone on the same wifi via the machine's LAN IP. Deploy is deferred to Phase 5 — no public URL or QR code yet.

**Verify:** I submit from my phone (over LAN) and the object appears on the laptop.

Real venue submissions and threshold-tuning against them now happen after deploy, in Phase 5. Phase 4's consolidation tuning uses the seeded data instead (see Step 4.1).

---

# PHASE 4 — EVOLUTION (hours 7–10.5)

This phase is the project. Step 4.1 is never cut.

## Step 4.1 — Consolidation

`lib/consolidate.ts` implementing spec §12.1: for each visible non-composite memory, find peers within 90px with cosine > 0.72; if ≥5, create a composite row (centroid embedding, centroid position, modal `fallback_archetype` — closed, safe to aggregate — plus a fresh LLM-written composite `label`/`noun` naming what they share, kept open-vocabulary rather than just repeating the fallback archetype; `scale = 1 + 0.15·n`; LLM-written epitaph), set the children's `parent_id`. Cap nesting at depth 2.

Call it from `/api/submit` when `count % 8 == 0`, **and** expose `POST /api/tick` to trigger it manually.

Render composites larger with a subtle ring or halo. Clicking one opens a panel listing all children; an "open" action explodes them outward around the composite for inspection.

**Verify:** run `/api/tick` against the seeded world. The ~15 Christmas memories should merge into one composite with a sensible generated epitaph. Click it and get eleven strangers' Christmases. Then submit a new Christmas memory and confirm it joins on the next tick.

Tune the two thresholds (90px, 0.72) against the seeded data (step 1.7) — real venue submissions aren't available until deploy in Phase 5, so re-tune against those then if time allows. If nothing merges, loosen. If everything merges into one blob, tighten.

## Step 4.2 — Decay

Computed at read time in `/api/world` per spec §12.2 — no cron, no column. `decay = clamp(1 - age/48h + 0.15·visits, 0.15, 1.0)`. Renderer maps it to alpha, saturation, and a downward y-offset. Below 0.25, draw into a static background terrain layer and make it non-interactive.

**Nothing is ever deleted.**

**Verify:** manually backdate `last_visit` on 20 rows in Supabase to 3 days ago. They should render faded and sunken. Click one that's still interactive; it should visibly brighten on the next poll.

## Step 4.3 — Biome bleed

Grid the world into 200px cells. `/api/world` also returns per-cell mean `valence`, `arousal`, `nostalgia` for cells in the viewport. Renderer draws a soft-interpolated ground colour and fog underneath the sprite layer.

**Verify:** the warm/domestic lobe and the loss/absence lobe are visibly different colours. Zooming out, the world should have *regions* rather than a flat background.

## Step 4.4 — Photo modality

`/api/submit` accepts `input_type: "photo"` with a base64 image, prepended as an image part to the **same** LLM call. Upload the original to Supabase Storage, store the URL in `input_url`. Reveal panel shows the photo alongside the memory. Submit UI gets a camera/file input.

**Verify:** photograph something on a phone, get a sensible object. The photo shows in the reveal panel.

## Step 4.5 — Rate limit

5 submissions per IP per 10 minutes, in-memory map is fine. Return 429 with a friendly message.

**Verify:** submit 6 times quickly. The sixth is refused. Wait and it works again.

## Step 4.6 — Reve backdrops (STRETCH — only if the API has been reliable all day)

Every 25 submissions, pick the densest region, aggregate its epitaphs, generate one backdrop, store the URL, render it behind that region. Fully async — must never block or fail a submission.

**Verify:** trigger manually, confirm a backdrop appears and that killing the API mid-generation leaves everything else working.

---

# PHASE 5 — FREEZE (hour 10.5 onward)

**No new features after this point.** Steps only:

1. **Deploy to Vercel** — the first deploy of the project. Confirm the production URL works end to end from a phone on cellular. Generate a QR code to the URL.
2. Reseed to ~300 total so the world is dense on stage. If real venue submissions get gathered now that there's a public URL, keep them and top up with seeded data.
3. Run `/api/tick` until several composites exist and are visible near the default camera position. Re-tune the consolidation thresholds (step 4.1) against real submissions now that they exist.
4. Set the default camera to open on a *good* view — dense, colourful, with a composite in frame.
5. Full run-through of the spec §19 demo on the production URL, from my phone, on venue wifi.
6. Record a 40-second screen capture of that exact sequence as the wifi-failure fallback.
7. Check: does an empty-ish region of the map look broken? Does a 1000px-wide phone viewport look right? Does the submit button work with an empty textarea (it shouldn't)?

**Cut order if behind:** Reve backdrops → photo → biome bleed → decay. **Consolidation is never cut.**

---

## Checkpoints where you should stop and get my sign-off

- **After 1.7** — is the scatter 10 lobes or one blob?
- **After 2.4** — does it look like a world?
- **After 3.3** — is the reveal panel demo-quality?
- **After 4.1** — do the merges make emotional sense to a human reading them?

Those four are where backtracking is cheap. Everywhere else, keep going.
