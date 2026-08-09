# Memory World — Build Spec

**Pitch:** Memory World turns human memories into symbolic objects, places them by semantic meaning, and lets clusters of strangers' memories merge into landmarks — so the world doesn't just grow, it reorganizes itself.

**Deadline:** ship publicly by 1:00 PM. ~12 working hours plus a prep block.

This document has two parts. **Part I** is the concept (why the project is what it is). **Part II** is the build (what to type). If you are reading this at 3 AM, skip to Part II.

---

# PART I — CONCEPT

## 1. What it is

A participant contributes one short memory — typed, spoken, or photographed — in under 60 seconds. The system interprets it and transforms it into a **symbolic world object**: a creature, plant, toy, or piece of furniture that represents what the memory *means*, not what it literally depicts.

> "Every Christmas I used to sit beside the window waiting for my cousins to arrive. My mom kept a tiny reindeer decoration there."

becomes

> **a small, worn felt reindeer with a soft amber glow**

The object is placed in a single global world at a position determined by its meaning. Anyone can click it to reveal the memory underneath.

The core technical claim is not `input → AI image`. It is:

```
human memory → structured meaning → symbolic object → position among strangers → self-reorganizing world
```

## 2. The problem

Most systems store memories as isolated content: photos in galleries, posts in timelines, pins on maps. Even with thousands of contributors, the result is a *collection* — one contribution never affects another.

Humans don't remember like that. A childhood home is remembered through a chair, a window, a mug, a staircase. Objects carry meaning far beyond their function.

Memory World asks: **if this memory had to exist as one thing in a shared world, what would it become — and what happens when thousands of those things end up in the same place?**

## 3. The central design rule

This is the idea that makes the project not-a-mood-board. Do not compromise it.

**Semantic meaning determines *what* the object is.**

| Memory | Object |
|---|---|
| Christmas beside a childhood window | reindeer toy |
| grandfather's garden | watering can |
| first day of school | small backpack |
| late-night coding | desk lamp |
| learning to ride a bike | bent bicycle bell |

**Emotion determines *how it looks*.**

| Feeling | Expression |
|---|---|
| nostalgic | worn, faded, soft glow |
| joyful | livelier animation, richer saturation |
| lonely | isolated placement, dim, slow |
| tender | miniature scale, warm rim light |
| chaotic | asymmetric form, irregular motion |

**Context influences placement.** Domestic memories drift toward shelves and windows; natural ones toward soil and water; solitary ones toward the periphery.

**Support determines *where and how it can exist*, not just its coordinates.** Not every symbol can float alone. A lamp needs a table. A window needs a wall — a window with no wall isn't "a window out of context," it's not a coherent object at all. The system decides not only what a memory becomes, but what that thing needs in order to meaningfully exist in the world: an object that needs support finds — or causes the creation of — a shared **structure** (a house, an office, a room) and takes a place inside it, alongside other strangers' objects that belong there too. A memory can also be fundamentally *about* a place rather than an object within one; those become structures directly. Architectural fragments (a window, a door, a shelf, a staircase) are never generated as free-floating entities — they're either attached to a structure's anchor or promoted into the whole place they imply.

Explicitly banned: `happy → flower`, `sad → wilted flower`, `love → heart`. That is a sentiment board and the doc's own §17 forbids it.

## 4. The emotional target

> A person contributes something private and discovers a stranger's memory, submitted independently, sitting right next to theirs — because they mean the same thing.

Similarity is expressed **spatially**, never as a label or a percentage. Two memories rhyme by being neighbours.

## 5. What this is not

Not a photo wall, sentiment board, AI art gallery, map of submissions, message wall, time capsule, collage, or "upload something and AI tags it."

The visible object is not the product. **The evolving system of relationships between symbolic memories is the product.**

---

# PART II — BUILD

## 6. Architecture

```
┌─ CLIENT ────────────────────────────────────────┐
│  Submit panel        World canvas (2D, zoom/pan) │
│  text / photo / mic  sprite + structure layer     │
└──────────┬──────────────────────┬────────────────┘
           │ POST /api/submit     │ GET /api/world
           ▼                      ▼
┌─ SERVER (Vercel serverless functions) ──────────┐
│  1. moderate                                     │
│  2. normalize input → text                       │
│  3. LLM → Memory IR + 5 candidates, each with     │
│     entityKind + placementRequirements            │
│  4. embed summary + candidate labels (local)      │
│  5. score candidates → pick winner                │
│  6. derive VisualObjectSpec (rule-based, local)   │
│  7. placement branch on winner.entityKind:        │
│       standalone  → anchor-circle (x, y)          │
│       structure   → create a new structure        │
│       supported   → find/create structure,        │
│                      occupy a matching anchor      │
│  8. insert (+ mark anchor occupied, if any)       │
│  9. every 8th insert → consolidation pass         │
└──────────┬───────────────────────────────────────┘
           ▼
┌─ SUPABASE ──────────────────────────────────────┐
│  postgres + pgvector  |  storage (photos/audio)  │
│  memories  |  structures (shared containers)      │
└──────────────────────────────────────────────────┘
```

**Stack:** Vite + React (TypeScript) on Vercel · Vercel serverless functions (`/api/*.ts`) for the backend · Supabase Postgres + pgvector · Canvas 2D for rendering · one multimodal LLM (text + vision on the same endpoint) · `Xenova/bge-small-en-v1.5` (transformers.js, local, 384-dim) for embeddings.

**Do not use:** three.js, a physics engine, auth, websockets. Polling every 3s is indistinguishable from realtime here and costs zero hours.

## 7. Step 1 — Input normalization

All modalities converge to plain text before anything else touches them.

| Modality | Method | Cost | Priority |
|---|---|---|---|
| **Text** | direct | — | **Required** |
| **Photo** | same multimodal call, image part prepended | ~0 extra | **Required** — reuses the entire pipeline |
| **Voice** | Whisper transcription | ~30 min | If ahead |
| Handwriting / drawing | identical to photo path | ~15 min UI | Free once photo works |

Photo is the correct second modality precisely because it costs almost nothing: same endpoint, same schema, same downstream code. Ship two modalities and one great world, not five modalities and a broken one.

## 8. Step 2 — Memory IR

One LLM call, structured output enforced. This intermediate layer is what stops the project being a one-step generative app — and it's what you show judges. As built, each candidate carries more than a bare archetype: an open-vocabulary noun/label, a closed fallback sprite, its own descriptive colors, *and* how it needs to exist in the world.

```json
{
  "summary": "Waiting beside the window for family to arrive at Christmas",
  "epitaph": "a reindeer on the window ledge",
  "literal_anchors": ["christmas", "window", "reindeer", "cousins"],
  "themes": ["family", "anticipation", "childhood", "tradition"],
  "emotion": { "valence": 0.81, "arousal": 0.31, "nostalgia": 0.92 },
  "setting": { "indoors": true, "season": "winter", "time_of_day": "evening" },
  "candidates": [
    {
      "noun": "tiny felt reindeer toy",
      "label": "a tiny worn felt reindeer toy, one ear slightly folded",
      "category": "creature",
      "fallbackArchetype": "deer",
      "groundingEvidence": ["a tiny reindeer decoration"],
      "emotionalFit": 0.95, "visualSuitability": 0.9,
      "primaryColor": "muted burgundy", "secondaryColor": "warm cream",
      "uniqueDetail": "one ear slightly folded",
      "entityKind": "supported_object",
      "placementRequirements": {
        "canExistStandalone": false,
        "environmentTags": ["domestic", "interior", "home"],
        "preferredAnchors": ["windowsill", "shelf", "table"]
      }
    },
    {
      "noun": "childhood living room at Christmas",
      "label": "the quiet room where the waiting happened",
      "category": "architecture",
      "fallbackArchetype": "bench",
      "groundingEvidence": ["sit beside the window waiting"],
      "emotionalFit": 0.85, "visualSuitability": 0.8,
      "primaryColor": "warm amber",
      "entityKind": "structure",
      "placementRequirements": { "canExistStandalone": true, "environmentTags": ["home", "domestic"], "preferredAnchors": ["floor"] },
      "structureSuggestion": {
        "semanticType": "a childhood living room at Christmas",
        "preferredTemplate": "small_house",
        "featuredElements": ["window", "reindeer decoration"]
      }
    }
  ]
}
```

(5 candidates total, ranked by fit — 2 shown above.) `category`/`fallbackArchetype`/`entityKind` **must** be from their fixed enums (§9). `noun`/`label` are open vocabulary — never coerced onto the fixed list. `material`/`condition`/`scale`/`animation`/`glow`/`preferredPlacement` (the old `attributes` block) are **not** part of this call at all: they're derived afterward by a deterministic rule from `emotion`/`setting`, once a candidate has already won — a second model call was tried and then deliberately cut once it was clear a fixed threshold table could do the same job for free. Constrain every enum field in the prompt *and* validate server-side with a fallback to the nearest legal value — a hallucinated enum value at 12:50 PM must not 500. `noun`/`label`/`groundingEvidence` have no legal fallback value to snap to; if they're missing, the whole call is treated as failed and the deterministic keyword path takes over instead.

**Seed the RNG with a hash of the winning noun/label.** Same memory always derives the same look, and you can rebuild the entire visual world from the `memories` table if the database gets wrecked — no image assets are load-bearing state.

## 9. Fallback archetypes are not the ontology

This section originally described a *closed* 40-word ontology that every object's identity was drawn from. **That's no longer how it works, and the distinction matters.** The object's real identity — `noun`/`label` — is open vocabulary, chosen fresh per memory (§3, §8). What's still closed is the small set of hand-drawn sprites the renderer falls back to if nothing more specific exists yet:

```
CREATURES     bird cat fox deer butterfly fish firefly rabbit moth snail
PLANTS        flower tree vine mushroom grass moss fern reed
OBJECTS       toy lamp book chair umbrella clock camera cup shell
              backpack bell musicbox lantern kettle radio
ARCHITECTURE  bench bridge mailbox fence
NATURAL       pond stone
```

(~39 total — down from an original 43-ish; `window`/`door`/`shelf`/`stairs` were removed as fallback *archetypes* specifically because they're structural attachments, not freestanding objects — a window with no wall isn't a decontextualized window, it's not a coherent object at all. See §11's structures for where they went instead.)

A memory whose noun is "an old brass house key" still gets the `key`-shaped meaning preserved in the database forever; it just borrows the `bell`-shaped sprite (tinted, scaled) until custom art exists for it, or until someone draws a `key` sprite. Never the reverse — the fallback sprite is never allowed to become what the UI claims the memory *means*.

A second, closed vocabulary governs **structures** instead (§11): `small_house`, `bedroom`, `kitchen`, `office`, `classroom`, `workshop`, `greenhouse`, `hut` — of which only `small_house` and `office` have real anchor geometry so far. This is a genuinely different kind of closed list than the fallback archetypes: structures need real application-owned geometry (where can something sit inside them), so the vocabulary has to stay small and deliberate rather than grow opportunistically.

Small closed sprite/template sets × continuous colour/scale/glow/wear modifiers is an enormous visual space from a small asset budget, with perfect style coherence and zero runtime latency. **Variation comes from attributes and composition, not from generation.**

## 10. Step 3 — Candidate scoring

Show five candidates, pick one.

```
finalScore = 0.45 · semanticFit
           + 0.20 · specificity
           + 0.15 · emotionalFit
           + 0.10 · visualSuitability
           + 0.10 · novelty
```

Three of the five terms are computed server-side, not asked of the model:

- **semanticFit** = `cosine(embed(candidate.label), embed(ir.summary))`. One batched local embedding call (`transformers.js`, no API) for all five candidate labels plus the summary.
- **specificity** = `1.0` if any `literal_anchor` string-matches the candidate's noun or label, else `0.3`. This is why *reindeer toy* beats *candle*.
- **novelty** = `1 − min(1, count(fallback_archetype in world) / 25)`. A single SQL count — grouped by the closed fallback archetype, since the real noun is open vocabulary and unbounded, so it can't be counted on directly.

The other two are self-estimated by the model per candidate, at generation time, and carried through unmodified:

- **emotionalFit** — how well this object's form could carry the memory's emotional character.
- **visualSuitability** — how clearly it could exist as a standalone rendered object.

These two aren't computable the honest way without meaningfully more machinery (a second judging pass, a learned scorer) — a straightforward "we asked an LLM to grade its own output" would be a fair criticism if it were *all five* terms. It's a disclosed simplification for two of them, not the whole formula; a judge can still verify the other three by hand from the console output.

That `novelty` term is worth stating out loud in the demo: **the current state of the world changes what your memory becomes.** The 500th person to submit a beach memory does not get another shell.

Persist all five candidates with their scores — the reveal panel (§16) displays them, and it is the single most legible proof that the transformation is real.

## 11. Step 4 — Placement (anchor model)

Relative "put it near its nearest neighbours" placement is undefined for memory #1 and unstable until roughly n=30 — which is exactly the state the world is in when a judge first walks up. Use fixed anchors instead.

**Prep step (before the clock starts):** embed 10 curated anchor phrases once, save to `anchors.json`, lay them on a circle of radius R.

```
home & belonging      absence & loss        first times
motion & travel       night & sleeplessness food & kitchens
fear & failure        someone else          water & weather
work & making
```

**At submit time:**

```
s[i]  = cosine(e, anchor[i])          for each of the 10 anchors
z[i]  = (s[i] − mean(s)) / std(s)     z-score, or everything lands dead centre
w     = softmax(z / T),  T = 0.35
keep top-3 weights, renormalize
pos   = Σ w[i] · anchorPos[i]
pos  += jitter(±40)
pos   = repel(pos, neighbours within 60px, 3 iterations)
```

The z-score step is load-bearing. Raw cosine similarities cluster around 0.3–0.5 and a naive softmax over them is near-uniform, which piles the entire world into a blob at the origin.

Anchors give you O(1) placement, stability from n=1, **and named districts for free**. "The Long Hall of Absences" is a better demo line than "we ran dimensionality reduction."

### 11.1 Structures — placement for things that need support

The anchor-circle algorithm above still runs exactly as described, but only for entities whose winning candidate says `canExistStandalone: true` (creatures, plants, environment features, standalone objects). Everything else branches:

```
winner.entityKind === "structure"?
  → the memory IS a place, not an object needing one.
    Always creates a NEW structure — reuse would silently merge two
    strangers' distinct memories of "a place" into one, which is a
    different (wrong) kind of merging than consolidation (§12.1) does.
    Template: LLM's best-guess semantic type (e.g. "university computer
    lab"), mapped down by application code to whichever of the small
    fixed template set it's geometrically closest to (only small_house
    and office have real anchor layouts so far — everything else in the
    8-name vocabulary collapses to one of those two for now).
    Placed on the anchor circle like anything else, using its own tags.

winner.placementRequirements.canExistStandalone === false?
  → search existing structures for one exposing a free anchor matching
    the winner's preferredAnchors (windowsill, shelf, desk, table, ...),
    scored by tag overlap with the structure's own semantic tags, minus
    a crowding penalty. Best match wins; if nothing qualifies, create a
    structure the same way a "structure"-kind memory would, then occupy
    whichever anchor is free in it.
```

A structure is a **shared, collective container** — not owned by whoever caused it to exist. One `office` created because of a late-night-coding memory can go on to collect a desk lamp, a coffee mug, and a stack of textbooks from three other strangers' entirely unrelated memories, as long as their tags and anchor needs line up. That's a second, more literal form of "strangers' memories ending up in the same place" than consolidation's proximity-based merging (§12.1) — this one is driven by *what the object needs*, not by *what it happens to be near*.

Every anchor's world position is computed once, from data the application owns (`structure.x/y + anchor.localX/Y` in a small fixed per-template layout) — never inferred from a generated image, and never handed to the LLM to invent. Rendering-wise, `components/Structure.ts` prefers real cutaway-style art (`public/structures/<template_id>.png`) when it exists and falls back to a plain labeled rectangle with visible anchor dots when it doesn't — per-template, so art can land for `small_house` without blocking `office`. `scripts/process-structure-art.ts` crops/resizes delivered art to the template's exact aspect ratio; the anchor coordinates themselves still need a manual recalibration pass once real art lands, since they were placed for a schematic box, not a specific image.

Placing a structure also has to account for its own size: the base anchor-circle placement formula (§11) was written for point-sized objects and repels only within 60px, which is nowhere near enough clearance for a ~420×320 box — a new structure could otherwise land visually on top of an existing object or another structure. A second repulsion pass (`repelFromFootprints`, `lib/place.ts`) runs on top of it for anything bigger than a point, aware of each structure's real half-diagonal, in both directions (new structures repel from existing objects/structures; new standalone objects repel from existing structures).

## 12. Evolution — this is the project

Placement alone produces a denser pile, not a different thing. Nothing so far causes an object submitted an hour ago to change. These mechanics are **required scope**, not stretch — they are the entire 20% community-value criterion.

Structures (§11.1) already deliver a version of this live, at submit time, without waiting for a batch tick: a shared `office` created by one person's late-night-coding memory can go on collecting an unrelated stranger's desk lamp, then someone else's coffee mug. It's a second, complementary form of "strangers' memories converging" — driven by *need* (an object requiring a desk) rather than by *proximity/similarity* (what consolidation below merges on). Both should be in the demo.

### 12.1 Consolidation (build first)

Every 8th submission, run one greedy pass:

```
for each visible memory m (parent_id is null, not composite):
    N = {peers within 90px AND cosine(m, peer) > 0.72}
    if |N| >= 5:
        create composite C:
            embedding  = centroid(N)
            position   = centroid of N positions
            archetype  = modal archetype of N
            scale      = 1 + 0.15·|N|
            epitaph    = LLM("one phrase naming what these N memories share")
        set parent_id = C.id for all of N
        cap nesting depth at 2
```

Ten Christmas memories stop being ten reindeer and become **one antlered shrine**. Clicking it explodes it back into eleven strangers' Christmases.

This one function solves clutter, delivers "richer and stranger with scale," and *is* your demo moment. If only one thing from §12 ships, ship this.

### 12.2 Decay by attention

Computed at **read time** — no cron job, no infrastructure:

```
age   = now − last_visit
decay = clamp(1 − age/48h + 0.15·visits, 0.15, 1.0)
```

Drives alpha, saturation, and y-offset. Neglected objects desaturate, sink, and moss over into the terrain layer (rendered as static background, not interactive). Visited objects brighten and grow. **Nothing is ever deleted** — decay is a render parameter over immutable rows.

Attention becomes the survival currency, and the world visibly edits itself overnight.

### 12.3 Biome bleed

Grid the world into 200px cells. Each cell's ground colour, fog density, and light temperature = mean `valence` / `arousal` / `nostalgia` of the memories inside it. Density stops reading as visual noise and starts reading as atmosphere. Cheapest possible way to make a crowded region look *better* than an empty one.

### 12.4 Hybrids (stretch)

Occasionally spawn a child from two adjacent-but-dissimilar objects, with a blended embedding and an LLM-written epitaph derived from both parents. The result is an object nobody submitted, described like a memory that never happened. This is the strangeness generator. Cut without regret if behind.

## 13. Rendering

**Generate the asset set offline, during the prep block.** The fallback archetype list is closed (§9 — it's a renderer safety net, not the object ontology), so produce all ~39 of them in one locked art direction, 2–3 variants each, transparent PNG, consistent lighting and scale.

Runtime applies material tint, colour multiply, scale, glow radius, wear overlay, and animation to those sprites. Result: instant placement, perfect style coherence, zero API dependency during judging.

**Reve's job is region backdrops, not objects.** Every N submissions, take a district's aggregated epitaphs and generate one painted backdrop for it. Async, never blocks, degrades gracefully if the API dies — and it *visualizes emergence*: the sky over a region changes as that region's collective meaning shifts. Far stronger than "AI drew my reindeer."

Per-object generation on the submit path costs 8–15s of latency, unreliable transparent backgrounds, rate limits, and 300 objects that look like they came from 300 different worlds. Do not put it there.

**Art direction:** storybook miniature, soft sculpted forms, muted desaturated palette, warm rim light, isolated on transparent background. Lock this in the prep block and never revisit it.

**Structures get their own, different art direction:** roofless/cutaway, three-quarter view, interior clearly readable (walls, floor, a few named anchors — windowsill, desk, shelf), sized to contain several object sprites at once. Nothing built for standalone objects reuses this — a structure is a small scene, not a tinted icon. The rendering path exists (`scripts/process-structure-art.ts` + `Structure.ts`'s art-or-rectangle fallback) but no art has been delivered for either implemented template (`small_house`, `office`) yet — they still render as a labeled rectangle with dots marking free/occupied anchors until it is.

## 14. Data model

As actually built (`supabase/schema.sql`) — this has moved twice from the original draft below: once to split the symbol-grounding layers (§3, §8) out of a flat `archetype`/`attributes` pair, once more to add the world hierarchy (§11.1). Both migrations were additive against the live table rather than requiring a wipe.

```sql
create extension if not exists vector;

-- Shared, long-lived containers (§11.1). Created before memories since
-- memories.structure_id references it.
create table structures (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz default now(),

  template_id   text not null,   -- one of the small closed set with real geometry
  noun          text not null,
  label         text not null,
  semantic_tags jsonb not null default '[]',

  x             real not null,
  y             real not null,

  -- [{id, type, localX, localY, occupiedByMemoryId?}] — application-owned
  -- geometry, deep-copied from a fixed template at creation time.
  anchors       jsonb not null
);

create table memories (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz default now(),

  input_type    text not null check (input_type in ('text','photo','voice')),
  raw_text      text,
  input_url     text,

  ir            jsonb not null,
  epitaph       text not null,
  embedding     vector(384),

  -- Symbol identity (§3, §8) — open noun/label, closed category/fallback.
  -- Immutable once selected.
  category            text not null,
  noun                text not null,
  label               text not null,
  fallback_archetype  text not null,
  grounding_evidence  jsonb not null default '[]',

  -- Render controls, derived separately (§8) from symbol identity.
  visual_spec   jsonb not null,

  generated_asset_url  text,
  render_status        text not null default 'fallback'
                        check (render_status in ('pending','generated','fallback','failed')),

  candidates    jsonb,

  -- World hierarchy (§11.1). x/y stay the authoritative position either
  -- way: for a structure-owned object they're precomputed as
  -- structure.x/y + anchor.localX/Y at placement time, so viewport bbox
  -- queries never need to know structures exist.
  entity_kind         text not null,
  environment_tags    jsonb not null default '[]',
  preferred_anchors   jsonb not null default '[]',
  structure_id        uuid references structures(id),
  anchor_id           text,

  x             real not null,
  y             real not null,

  parent_id     uuid references memories(id),
  is_composite  boolean default false,
  child_count   int default 0,

  visits        int default 0,
  last_visit    timestamptz default now(),

  flagged       boolean default false
);

create index on memories using ivfflat (embedding vector_cosine_ops) with (lists = 32);
create index on memories (x, y) where parent_id is null and flagged = false;
create index on memories (parent_id);
create index on memories (structure_id) where structure_id is not null;
create index on structures (x, y);
```

**Notes.** The `relationships` table from the previous draft is deleted — pairwise similarity is O(n²) rows that go stale immediately. Compute k-NN at query time with pgvector. `biomes` is deleted too; biomes are computed from a grid aggregate, not stored (still true — biome bleed, §12.3, isn't built yet). `decay` is not a column; it is derived at read time from `last_visit` and `visits`. Composites are ordinary rows with `is_composite = true`, so `parent_id` self-reference handles the whole hierarchy without a second table. `structures` *is* a second table, deliberately — unlike pairwise relationships or biomes, a structure's anchor occupancy is real mutable state that many unrelated rows reference, not something derivable at query time.

## 15. API

| Route | Does |
|---|---|
| `POST /api/submit` | moderate → normalize → IR + candidates (with entityKind/placementRequirements) → embed → score → derive visual spec → place (anchor circle, or find/create a structure + anchor) → insert → maybe consolidate. Returns the new row. |
| `GET /api/world?x0&y0&x1&y1` | `{ objects: [...], structures: [...] }` — both in viewport (`parent_id is null and not flagged` for objects), plus (once built) biome grid cells. Client polls every 3s. |
| `GET /api/memory/:id` | Full record, children if composite, 5 semantic neighbours via pgvector. |
| `POST /api/memory/:id/visit` | Increments `visits`, bumps `last_visit`. Fire-and-forget. |
| `POST /api/tick` | Manually trigger consolidation. Demo safety valve — lets you force a merge on stage. |

## 16. The reveal panel

Clicking an object opens the single most important UI in the project, because it makes an invisible transformation visible to a judge in four seconds.

```
   a small felt reindeer, one ear folded

   "Every Christmas I used to sit beside the
    window waiting for my cousins to arrive…"

   WHY THIS OBJECT
   reindeer decoration  → direct literal anchor    0.94
   christmas            → tradition, seasonal      0.71
   childhood            → miniature scale
   nostalgia            → faded felt, warm glow
   waiting by a window  → placed in Home & Belonging

   ALSO CONSIDERED
   snow globe 0.71 · paper star 0.66 · mantel clock 0.61

   NEARBY, BY MEANING
   → "the year we didn't go home"      (a stranger, 2h ago)
   → "grandma's kitchen at 6am"        (a stranger, 40m ago)
```

## 17. Non-negotiable safety and ops

- **Moderation.** Global public text input with no auth. Someone will submit something vile before judging. Run OpenAI's free moderation endpoint on every submission; set `flagged` and exclude from queries. **15 minutes. Do it in hour 1.**
- **Rate limit.** 5 submissions per IP per 10 minutes. One loop can otherwise flood the world.
- **Seeding.** Generate 200–300 synthetic memories before demoing. Consolidation, biomes, and semantic gravity are all *invisible* at n=12, and an empty world demos terribly. Write the seeder in hour 5, run it in hour 6 against the local dev environment (deploy is deferred to Phase 5).
- **LLM fallback.** If the provider has a bad five minutes during judging, submit must still work: on failure, fall back to keyword→archetype matching and a random-but-seeded attribute set. Never show an error toast on stage.

## 18. Schedule

### Prep block (before the clock — do this tonight)

- [ ] Generate the ~39-fallback-archetype sprite set in one locked art direction
- [ ] Embed the 10 anchors → `anchors.json`
- [ ] Supabase project created, schema applied, `vector` extension on
- [ ] Vite + React repo scaffolded locally, with a placeholder page and a hello-world `/api` serverless function (deploy deferred to Phase 5)
- [ ] API keys in env, verified working

Doing this after the clock starts costs you consolidation.

### The 12 hours

| Hours | Work | Cut line |
|---|---|---|
| **0–2** | Schema, `/api/submit` end-to-end: text → IR → embed → score → place → row in DB. Moderation inline. **No rendering yet.** | — |
| **2–5** | Canvas world, camera pan/zoom, sprites composed from fallback archetype + visual spec, anchor placement visible. | **Critical path. If this isn't done at hour 5, cut features, not quality.** |
| **5–7** | Reveal panel with candidates + neighbours. Photo modality. Polling. **Run the seeder locally.** | Seeded data is what consolidation has to chew on until deploy in Phase 5 |
| **7–9** | Consolidation + explode interaction. | Do not cut. This is the project. |
| **9–10.5** | Decay + biome bleed. Reve backdrops *only if* the API has been reliable all day. | Cut Reve first, biomes second |
| **10.5–12** | **Freeze.** Deploy to Vercel (first deploy). Seed to ~300, adding real venue submissions once gathered. Write and rehearse the demo. Test submit on a phone on venue wifi. | Nothing new after 10.5 |

**Cut order when behind:** hybrids → Reve backdrops → voice → biome bleed → decay. **Consolidation is never cut.**

### Ownership (3 people; collapse 3→2 if needed)

- **A — Pipeline:** submit route, IR prompt, embeddings, scoring, moderation, seeder, fallbacks.
- **B — World:** canvas, camera, sprite composition, placement math, polling, reveal panel.
- **C — Art + Evolution:** sprite set and art direction in the prep block, then consolidation, decay, biome rendering. Owns the demo script from hour 10.

A and B must agree on the IR JSON shape in the first 20 minutes and then never renegotiate it. Mock it immediately so B is never blocked on A.

## 19. Demo (2–3 minutes, 6 beats)

Judges get minutes, not twelve steps. Do not walk them through your architecture — show them the artifact.

1. **Open the live world.** Already populated, already strange. Pan across it. Say one sentence: *every object here is somebody's memory.*
2. **Click a stranger's object.** Reveal the memory and the "why this object" breakdown. Four seconds of proof that the transformation is real.
3. **Judge submits live**, on their own phone, from the QR code. Under 60 seconds.
4. **Their object flies into the world** — and lands *inside an existing cluster of strangers' memories that mean the same thing.*
5. **The cluster merges** into a landmark, live.
6. **Click the landmark.** It blooms open into eleven people's Christmases.

End on beat 6. Do not add a features slide.

**Fallback if wifi dies:** a pre-recorded 40-second screen capture of exactly this sequence, on the laptop, ready to play. You will probably not need it. You will be very glad you have it.

## 20. Criteria mapping

| Criterion | Where it's earned |
|---|---|
| **Experience 30%** | Under-60s submit, one-tap reveal, world readable in 3 seconds without explanation |
| **Technical craft 30%** | IR extraction, computable candidate scoring, anchor placement with z-scored softmax, live consolidation pass |
| **Originality + identity 20%** | Meaning/emotion decomposition, closed ontology with procedural expression, self-merging landmarks, hand-authored art direction |
| **Community 20%** | Novelty term (world state changes what you get), consolidation, decay by attention, biome bleed — old contributions keep changing without their authors |

## 21. Do not build

Auth · user profiles · comments · feeds · 3D · physics · force-directed layout · a stored relationships table · per-object image generation on the submit path · websockets · a settings page · anything with the word "onboarding."