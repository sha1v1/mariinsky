-- Base schema for a fresh Supabase project. If you already applied an
-- earlier version of this file, don't rerun it — use the numbered files in
-- supabase/migrations/ instead to bring an existing table up to this shape
-- without losing data.

create extension if not exists vector;

-- World hierarchy — structures are shared, long-lived containers that many
-- unrelated contributors' `supported_object` memories can occupy anchors
-- in over time. Created before `memories` since memories.structure_id
-- references it. See lib/ontology.ts (STRUCTURE_DEFS) / lib/structures.ts.
create table structures (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz default now(),

  -- Always one of IMPLEMENTED_STRUCTURE_TEMPLATES (lib/ontology.ts) — the
  -- row's actual anchor geometry. The richer, possibly-unimplemented
  -- semantic flavor (e.g. "computer lab") lives in noun/label instead.
  template_id   text not null,

  noun          text not null,
  label         text not null,
  semantic_tags jsonb not null default '[]',

  x             real not null,
  y             real not null,

  -- [{id, type, position:{x,y,z}, rotation?, maxScale?, occupiedByMemoryId?}]
  -- — deep-copied from
  -- STRUCTURE_DEFS at creation time, then mutated in place as objects move
  -- in. Application-owned geometry (pipeline §8) — never touched by the LLM.
  anchors       jsonb not null
);

create index on structures (x, y);

create table memories (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz default now(),

  input_type    text not null check (input_type in ('text','photo','voice','video')),
  raw_text      text,
  input_url     text,
  media_metadata jsonb,

  ir            jsonb not null,
  epitaph       text not null,
  embedding     vector(384),

  -- Symbol identity — open noun/label, closed category/fallback_archetype.
  -- Immutable once selected; visual_spec below must never change these
  -- (memory_world_symbol_grounding_render_pipeline.md §11, §24, §28).
  category            text not null,
  noun                text not null,
  label               text not null,
  fallback_archetype  text not null,
  grounding_evidence  jsonb not null default '[]',
  asset_search_terms  jsonb not null default '[]',
  semantic_tags       jsonb not null default '[]',

  -- Render controls, generated as a separate step from symbol identity
  -- (pipeline §12, §19). Keys inside are camelCase, matching the
  -- VisualObjectSpec TS type directly (no snake<->camel mapping layer).
  visual_spec   jsonb not null,
  -- The selected reusable primitive is separate from semantic identity.
  -- A fallback asset never rewrites noun/label.
  visual_representation jsonb not null,

  -- Generated-asset pipeline (pipeline §21-23). Step 2.5 (custom
  -- per-memory art generation) isn't implemented yet, so every row stays
  -- render_status='fallback' and generated_asset_url null for now — the
  -- renderer always has the fallback_archetype sprite to draw regardless.
  generated_asset_url  text,
  render_status        text not null default 'local_3d'
                        check (render_status in ('local_3d','pending','generated','fallback','failed')),

  candidates    jsonb,

  -- World hierarchy (architecture refactor) — EntityKind classification
  -- and, for supported_object rows, which structure/anchor they occupy.
  -- x/y remain the authoritative world position either way: for a
  -- structure-owned object they're precomputed as
  -- structure.x/y + anchor.localX/Y at placement time, so every viewport
  -- bbox query keeps working unmodified. See lib/placementPipeline.ts.
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
