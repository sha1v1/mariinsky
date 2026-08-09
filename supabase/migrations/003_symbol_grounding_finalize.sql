-- Migration 002 (part 2/2) — run ONLY after 002_symbol_grounding_add_columns.sql
-- has been applied AND scripts/backfill-symbol-fields.ts reports zero rows
-- with a null category/noun/label/fallback_archetype/visual_spec.
--
-- Locks in the new symbol-grounding schema: enforces NOT NULL on the
-- layers pipeline §24 requires, and drops the old flat `archetype`/
-- `attributes` columns they replace. Every code path (api/*, lib/*,
-- scripts/*) has already been migrated off `archetype`/`attributes` by
-- this point — nothing reads them anymore.

alter table memories
  alter column category           set not null,
  alter column noun                set not null,
  alter column label               set not null,
  alter column fallback_archetype  set not null,
  alter column visual_spec         set not null;

alter table memories
  drop column archetype,
  drop column attributes;
