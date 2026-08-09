-- Migration 002 (part 1/2) — adds the symbol-grounding pipeline's columns
-- (memory_world_symbol_grounding_render_pipeline.md §24) alongside the
-- existing `archetype`/`attributes` columns. Additive only, safe to run
-- against the live table with its 220 existing rows — nothing is dropped
-- or made NOT NULL yet, because those 220 rows don't have values for the
-- new columns until scripts/backfill-symbol-fields.ts runs.
--
-- Run this in the Supabase SQL editor, then run:
--   node scripts/backfill-symbol-fields.ts --dry-run   (sanity check)
--   node scripts/backfill-symbol-fields.ts             (actually backfill)
-- and only once that reports zero remaining nulls, run
-- 003_symbol_grounding_finalize.sql to add the NOT NULL constraints and
-- drop the old `archetype`/`attributes` columns.

alter table memories
  add column if not exists category            text,
  add column if not exists noun                 text,
  add column if not exists label                text,
  add column if not exists fallback_archetype   text,
  add column if not exists grounding_evidence   jsonb not null default '[]',
  add column if not exists visual_spec          jsonb,
  add column if not exists generated_asset_url  text,
  add column if not exists render_status        text not null default 'fallback'
    check (render_status in ('pending','generated','fallback','failed'));
