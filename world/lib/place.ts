// Step 1.5 — anchor placement (spec §11), implemented exactly:
//
//   s[i]  = cosine(e, anchor[i])          for each of the 10 anchors
//   z[i]  = (s[i] − mean(s)) / std(s)     z-score — load-bearing, without it
//                                         every memory lands near the origin
//   w     = softmax(z / T),  T = 0.35
//   keep top-3 weights, renormalize
//   pos   = Σ w[i] · anchorPos[i]
//   pos  += jitter(±40)
//   pos   = repel(pos, neighbours within 60px, 3 iterations)
//
// Neighbour lookups for repulsion are by (x, y) bounding box, not by
// embedding — cheap and exactly what the spec calls for.

import { readFileSync } from "node:fs";
import path from "node:path";
import { cosineSimilarity } from "./embed.ts";
import { supabase } from "./supabase.ts";
import { STRUCTURE_DEFS } from "./ontology.ts";
import type { ImplementedStructureTemplateId } from "./ontology.ts";

interface Anchor {
  name: string;
  embedding: number[];
  x: number;
  y: number;
}

const ANCHORS: Anchor[] = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "..", "data", "anchors.json"), "utf8")
);

const SOFTMAX_TEMPERATURE = 0.35;
const TOP_K = 3;
const JITTER_RANGE = 40;
const NEIGHBOR_RADIUS = 60;
const REPEL_ITERATIONS = 3;

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[], m: number): number {
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function softmax(values: number[]): number[] {
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

async function neighborsNear(x: number, y: number, radius: number): Promise<{ x: number; y: number }[]> {
  const { data, error } = await supabase
    .from("memories")
    .select("x, y")
    .is("parent_id", null)
    .eq("flagged", false)
    .gte("x", x - radius)
    .lte("x", x + radius)
    .gte("y", y - radius)
    .lte("y", y + radius);

  if (error) {
    console.error("[place] neighbor query failed, skipping repulsion this iteration:", error);
    return [];
  }
  return data ?? [];
}

export interface PlacementResult {
  x: number;
  y: number;
  topAnchor: string;
}

export async function placeMemory(embedding: number[]): Promise<PlacementResult> {
  const similarities = ANCHORS.map((a) => cosineSimilarity(embedding, a.embedding));
  const m = mean(similarities);
  const sd = std(similarities, m);
  const z = sd === 0 ? similarities.map(() => 0) : similarities.map((v) => (v - m) / sd);

  const weights = softmax(z.map((v) => v / SOFTMAX_TEMPERATURE));

  const ranked = weights
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w - a.w)
    .slice(0, TOP_K);
  const topSum = ranked.reduce((sum, r) => sum + r.w, 0);
  const top = ranked.map((r) => ({ ...r, w: r.w / topSum }));

  let x = 0;
  let y = 0;
  for (const { w, i } of top) {
    x += w * ANCHORS[i].x;
    y += w * ANCHORS[i].y;
  }

  x += (Math.random() * 2 - 1) * JITTER_RANGE;
  y += (Math.random() * 2 - 1) * JITTER_RANGE;

  for (let iter = 0; iter < REPEL_ITERATIONS; iter++) {
    const neighbors = await neighborsNear(x, y, NEIGHBOR_RADIUS);
    let pushX = 0;
    let pushY = 0;
    for (const n of neighbors) {
      const dx = x - n.x;
      const dy = y - n.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      if (dist < NEIGHBOR_RADIUS) {
        const overlap = NEIGHBOR_RADIUS - dist;
        pushX += (dx / dist) * overlap;
        pushY += (dy / dist) * overlap;
      }
    }
    x += pushX;
    y += pushY;
  }

  return { x, y, topAnchor: ANCHORS[top[0].i].name };
}

// --- world-hierarchy addition: footprint-aware repulsion -------------------
//
// The formula above is the spec's, implemented exactly, and its 60px
// repulsion radius is sized for point-sprites (16-64px diameter) repelling
// other point-sprites. Structures broke that assumption: a structure's box
// is ~420x320 world units, so placing one with only the 60px point-radius
// meant it could land squarely on top of an existing object (or another
// structure) that was outside 60px but still well inside its footprint —
// "why did my bedroom get placed over my bench?" was exactly this: the
// structure's own size was never part of the repulsion math.
//
// This second, separate pass runs after placeMemory() for anything whose
// own footprint is bigger than a point (currently: structures, both
// against other structures and against nearby point objects) so the base
// spec algorithm above stays untouched and this addition is opt-in per
// caller via `selfRadius`.

const FOOTPRINT_REPEL_ITERATIONS = 3;
const FOOTPRINT_QUERY_MARGIN = 300; // covers the largest structure's own radius on top of selfRadius
// Assumed radius of "just some point sprite" for this pass — exported so a
// standalone object being placed can also request clearance from existing
// structures using the same value it's assumed to occupy itself.
export const POINT_OBJECT_CLEARANCE = 40;
const FOOTPRINT_BUFFER = 24; // small gap so boxes don't just kiss edges

export function structureRadius(templateId: ImplementedStructureTemplateId): number {
  const def = STRUCTURE_DEFS[templateId];
  return Math.hypot(def.width, def.height) / 2;
}

interface FootprintNeighbor {
  x: number;
  y: number;
  radius: number;
}

async function footprintNeighborsNear(x: number, y: number, radius: number): Promise<FootprintNeighbor[]> {
  const [memRes, structRes] = await Promise.all([
    supabase
      .from("memories")
      .select("x, y")
      .is("parent_id", null)
      .eq("flagged", false)
      .gte("x", x - radius)
      .lte("x", x + radius)
      .gte("y", y - radius)
      .lte("y", y + radius),
    supabase
      .from("structures")
      .select("x, y, template_id")
      .gte("x", x - radius)
      .lte("x", x + radius)
      .gte("y", y - radius)
      .lte("y", y + radius),
  ]);

  if (memRes.error) console.error("[place] footprint memory lookup failed, skipping this iteration:", memRes.error);
  if (structRes.error) console.error("[place] footprint structure lookup failed, skipping this iteration:", structRes.error);

  const memories = (memRes.data ?? []).map((m) => ({ x: m.x, y: m.y, radius: POINT_OBJECT_CLEARANCE }));
  const structures = (structRes.data ?? []).map((s) => ({
    x: s.x,
    y: s.y,
    radius: structureRadius(s.template_id as ImplementedStructureTemplateId),
  }));
  return [...memories, ...structures];
}

// Pushes (x, y) away from any nearby memory or structure whose combined
// footprint (selfRadius + that neighbour's own radius, plus a small
// buffer) it currently overlaps. Call after placeMemory() whenever the
// thing being placed isn't just a point — pass the caller's own
// structureRadius() (or a stand-in radius for anything else non-point).
export async function repelFromFootprints(
  x: number,
  y: number,
  selfRadius: number
): Promise<{ x: number; y: number }> {
  let px = x;
  let py = y;
  const queryRadius = selfRadius + FOOTPRINT_QUERY_MARGIN;

  for (let iter = 0; iter < FOOTPRINT_REPEL_ITERATIONS; iter++) {
    const neighbors = await footprintNeighborsNear(px, py, queryRadius);
    let pushX = 0;
    let pushY = 0;
    for (const n of neighbors) {
      const dx = px - n.x;
      const dy = py - n.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const desired = selfRadius + n.radius + FOOTPRINT_BUFFER;
      if (dist < desired) {
        const overlap = desired - dist;
        pushX += (dx / dist) * overlap;
        pushY += (dy / dist) * overlap;
      }
    }
    px += pushX;
    py += pushY;
  }

  return { x: px, y: py };
}
