// Backfills the 220 pre-existing rows (seeded before the symbol-grounding
// schema migration) from their old flat `archetype`/`attributes` columns
// into the new layered columns: category/noun/label/fallback_archetype/
// grounding_evidence/visual_spec.
//
// These old rows were never run through open-vocabulary candidate
// generation, so there's no real distinct noun to recover — per the
// approved migration plan, `noun` and `label` are both set to the row's
// existing `epitaph` (already a decent human-written phrase, e.g. "a
// reindeer on the window ledge") rather than fabricating a fake one.
// `fallback_archetype` carries over the old `archetype` value unchanged
// (already validated against the ontology), and `category` is derived
// from it. `visual_spec` is reconstructed from the old `attributes` blob,
// converting snake_case keys to the VisualObjectSpec camelCase shape.
//
// Run AFTER applying supabase/migrations/002_symbol_grounding_add_columns.sql
// and BEFORE applying 003_symbol_grounding_finalize.sql.
//
// Usage:
//   node scripts/backfill-symbol-fields.ts --dry-run
//   node scripts/backfill-symbol-fields.ts

import { supabase } from "../lib/supabase.ts";
import { categoryForFallbackArchetype, FALLBACK_ARCHETYPES } from "../lib/ontology.ts";
import { snapToNearest } from "../lib/util.ts";
import type { VisualObjectSpec } from "../lib/types.ts";

interface OldRow {
  id: string;
  archetype: string | null;
  attributes: Record<string, unknown> | null;
  epitaph: string | null;
  category: string | null;
}

function buildVisualSpec(attrs: Record<string, unknown> | null): VisualObjectSpec {
  const a = attrs ?? {};
  return {
    material: (a.material as VisualObjectSpec["material"]) ?? "wood",
    condition: (a.condition as VisualObjectSpec["condition"]) ?? "worn",
    scale: (a.scale as VisualObjectSpec["scale"]) ?? "medium",
    animation: (a.animation as VisualObjectSpec["animation"]) ?? "still",
    primaryColor: (a.primary_color as string) ?? "grey",
    secondaryColor: (a.secondary_color as string) ?? undefined,
    glow: typeof a.glow === "number" ? a.glow : 0,
    uniqueDetail: (a.unique_detail as string) ?? undefined,
    preferredPlacement: "generic",
    explanation: ["Backfilled from the pre-migration attributes blob during the symbol-grounding schema migration."],
  };
}

async function fetchRowsToBackfill(): Promise<OldRow[]> {
  const { data, error } = await supabase
    .from("memories")
    .select("id, archetype, attributes, epitaph, category")
    .is("category", null);

  if (error) throw new Error(`failed to fetch rows: ${error.message}`);
  return data ?? [];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const rows = await fetchRowsToBackfill();

  console.log(`[backfill] ${rows.length} rows need backfilling${dryRun ? " (dry run, nothing will be written)" : ""}\n`);

  let done = 0;
  for (const row of rows) {
    const fallbackArchetype = snapToNearest(row.archetype ?? "stone", FALLBACK_ARCHETYPES);
    const category = categoryForFallbackArchetype(fallbackArchetype) ?? "object";
    const label = (row.epitaph ?? "").trim() || `a ${fallbackArchetype}`;

    const update = {
      category,
      noun: label,
      label,
      fallback_archetype: fallbackArchetype,
      grounding_evidence: [],
      visual_spec: buildVisualSpec(row.attributes),
    };

    console.log(`[backfill] ${row.id} archetype="${row.archetype}" -> category=${category} fallback_archetype=${fallbackArchetype} label="${label}"`);

    if (!dryRun) {
      const { error } = await supabase.from("memories").update(update).eq("id", row.id);
      if (error) console.error(`[backfill] update failed for ${row.id}:`, error);
      else done++;
    }
  }

  console.log(`\n[backfill] ${dryRun ? "would update" : "updated"} ${dryRun ? rows.length : done}/${rows.length} rows.`);

  if (!dryRun) {
    const { count, error } = await supabase
      .from("memories")
      .select("*", { count: "exact", head: true })
      .is("category", null);
    if (error) {
      console.error("[backfill] post-check failed:", error);
    } else {
      console.log(
        count === 0
          ? "[backfill] verified: zero rows remain with a null category. Safe to run 003_symbol_grounding_finalize.sql."
          : `[backfill] WARNING: ${count} rows still have a null category — do not run 003_symbol_grounding_finalize.sql yet.`
      );
    }
  }
}

main().catch((err) => {
  console.error("[backfill] fatal error:", err);
  process.exit(1);
});
