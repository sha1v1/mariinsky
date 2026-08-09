// Step 2.1 — GET /api/world?x0&y0&x1&y1
// Returns visible objects (parent_id is null, not flagged) inside the
// viewport bbox, with only the fields the renderer needs. Explicitly
// excludes `embedding` (1536-dim... here 384-dim, but still huge) and
// `candidates`/`ir`/`grounding_evidence` (reveal-panel-only, not needed to
// draw a sprite). `label` is included (not just the closed
// `fallback_archetype`) so the renderer/reveal-panel can always show the
// real open-vocabulary interpretation, per the symbol-grounding pipeline
// §22 — the object's meaning is never reduced to its fallback archetype.
// Capped at 800 rows.
//
// World hierarchy (architecture refactor) — also returns `structures` in
// the same viewport, since a structure's crude rectangle draws underneath
// the memory objects sitting at its anchors (components/World.tsx). This
// changes the response shape from a flat array to
// { objects: [...], structures: [...] } — a breaking change to the
// previous contract, updated in lockstep with World.tsx.

import { supabase } from "../lib/supabase.ts";

const MAX_ROWS = 800;
const MAX_STRUCTURES = 200;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const x0 = Number(url.searchParams.get("x0"));
  const y0 = Number(url.searchParams.get("y0"));
  const x1 = Number(url.searchParams.get("x1"));
  const y1 = Number(url.searchParams.get("y1"));

  if ([x0, y0, x1, y1].some((n) => !Number.isFinite(n))) {
    return new Response(
      JSON.stringify({ error: "expected numeric x0, y0, x1, y1 query params" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const [minX, maxX, minY, maxY] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];

  const [objectsRes, structuresRes] = await Promise.all([
    supabase
      .from("memories")
      .select(
        "id, x, y, category, fallback_archetype, visual_spec, generated_asset_url, render_status, label, epitaph, is_composite, child_count, entity_kind, structure_id, anchor_id"
      )
      .is("parent_id", null)
      .eq("flagged", false)
      .gte("x", minX)
      .lte("x", maxX)
      .gte("y", minY)
      .lte("y", maxY)
      .limit(MAX_ROWS),
    supabase
      .from("structures")
      .select("id, template_id, noun, label, x, y, anchors")
      .gte("x", minX)
      .lte("x", maxX)
      .gte("y", minY)
      .lte("y", maxY)
      .limit(MAX_STRUCTURES),
  ]);

  if (objectsRes.error) {
    console.error("[api/world] memories query failed:", objectsRes.error);
    return new Response(JSON.stringify({ error: objectsRes.error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  if (structuresRes.error) {
    console.error("[api/world] structures query failed:", structuresRes.error);
    return new Response(JSON.stringify({ error: structuresRes.error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ objects: objectsRes.data, structures: structuresRes.data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
