// attributes.primary_color / secondary_color come back from the LLM as
// free-text descriptive phrases ("warm chestnut brown", "obsidian black",
// "dull brass"), not CSS-safe values — Canvas fillStyle silently fails on
// multi-word strings like that. This resolves a description to a hex color
// by scanning its words (last word first, since the color word usually
// trails the modifier: "warm chestnut BROWN") against a keyword table that
// covers both standard CSS color names and the thematic/material words the
// LLM (and our own fallback palette in lib/llm.ts) actually produce, sized
// to the spec's "muted desaturated palette" art direction rather than raw
// saturated CSS primaries. Client-safe: no server-only imports.

const COLOR_KEYWORDS: Record<string, string> = {
  // standard CSS names the LLM does sometimes just use directly
  red: "#b5484a",
  orange: "#c98a4b",
  yellow: "#cbb35a",
  green: "#6b8f6b",
  blue: "#5c7a9c",
  purple: "#8a6b96",
  violet: "#8a6b96",
  pink: "#c98a9c",
  brown: "#8a6a4f",
  black: "#2b2b2b",
  white: "#e8e4da",
  gray: "#8a8a86",
  grey: "#8a8a86",
  gold: "#b8974e",
  silver: "#a8a8a0",
  tan: "#b8a482",
  beige: "#c9bb9c",
  cream: "#e8dfc4",
  ivory: "#e6e0cc",
  maroon: "#722f37",
  navy: "#3d4f66",
  teal: "#4f7d7a",
  olive: "#7a7a4f",
  coral: "#c97a6a",
  salmon: "#c98a7a",
  crimson: "#9c3d43",

  // thematic/material words the LLM and our own fallback palette produce
  burgundy: "#722f37",
  chestnut: "#7a4f3d",
  ochre: "#b8874e",
  slate: "#5f6b73",
  charcoal: "#3d3d3d",
  obsidian: "#232323",
  sage: "#8a9678",
  moss: "#6b7d5a",
  amber: "#b8823d",
  brass: "#a8874e",
  bronze: "#8a6a3d",
  copper: "#a8683d",
  rust: "#8a4f3d",
  walnut: "#5f4632",
  mahogany: "#5a2f28",
  pewter: "#8a8a82",
  frosted: "#dce4e4",
};

const DEFAULT_COLOR = "#8a8a86"; // muted neutral gray, matches the art direction

export function resolveColor(description: string | undefined | null): string {
  if (!description) return DEFAULT_COLOR;

  // hex or rgb() passed straight through
  const trimmed = description.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) return trimmed;
  if (/^rgb/i.test(trimmed)) return trimmed;

  const words = trimmed.toLowerCase().split(/[\s-]+/);
  for (let i = words.length - 1; i >= 0; i--) {
    const hit = COLOR_KEYWORDS[words[i]];
    if (hit) return hit;
  }
  return DEFAULT_COLOR;
}
