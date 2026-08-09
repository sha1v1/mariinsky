-- World hierarchy — structures, anchors, and what needs one (architecture
-- refactor). Purely additive: no existing column is touched or dropped.
--
-- entity_kind/environment_tags/preferred_anchors/structure_id/anchor_id
-- default to NULL/'[]' for the ~220 already-seeded rows and are left that
-- way deliberately (decision: "leave as legacy for now") — those rows keep
-- rendering exactly as before, as free-floating standalone objects. Every
-- row written by the current pipeline (api/submit.ts, scripts/seed.ts)
-- always sets entity_kind explicitly going forward.

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

  -- [{id, type, localX, localY, occupiedByMemoryId?}] — deep-copied from
  -- STRUCTURE_DEFS at creation time, then mutated in place as objects move
  -- in. Application-owned geometry (pipeline §8) — never touched by the LLM.
  anchors       jsonb not null
);

create index on structures (x, y);

alter table memories
  add column if not exists entity_kind        text,
  add column if not exists environment_tags   jsonb not null default '[]',
  add column if not exists preferred_anchors  jsonb not null default '[]',
  add column if not exists structure_id       uuid references structures(id),
  add column if not exists anchor_id          text;

create index on memories (structure_id) where structure_id is not null;
