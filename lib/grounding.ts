import type { MemoryIR } from "./types.ts";

const PORTABLE_ARTIFACT_NOUNS = new Set([
  "souvenir", "token", "ticket", "map", "photo", "photograph", "coin",
  "medallion", "keepsake", "statue", "sculpture", "figurine", "postcard", "brochure",
]);

function normalizeToken(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (cleaned.endsWith("ies") && cleaned.length > 3) return `${cleaned.slice(0, -3)}y`;
  if (/(ches|shes|xes|zes|sses)$/.test(cleaned)) return cleaned.slice(0, -2);
  if (cleaned.endsWith("s") && !cleaned.endsWith("ss")) return cleaned.slice(0, -1);
  return cleaned;
}

export function specificityFor(noun: string, literalAnchors: string[], summary = ""): number {
  const nounTokens = noun.split(/\s+/).map(normalizeToken).filter(Boolean);
  const headNoun = nounTokens.at(-1);
  if (!headNoun) return 0.3;
  const literalTokens = [summary, ...literalAnchors].join(" ").split(/\s+/).map(normalizeToken).filter(Boolean);
  return literalTokens.includes(headNoun) ? 1 : 0.3;
}

export function inventedArtifactPenalty(
  noun: string,
  sourceText: string,
  timeContext: MemoryIR["timeContext"],
): number {
  const nounTokens = noun.split(/\s+/).map(normalizeToken).filter(Boolean);
  const artifact = nounTokens.find((token) => PORTABLE_ARTIFACT_NOUNS.has(token));
  if (!artifact) return 0;
  const sourceTokens = sourceText.split(/\s+/).map(normalizeToken).filter(Boolean);
  if (sourceTokens.includes(artifact)) return 0;
  return timeContext === "present" || timeContext === "ongoing" || timeContext === "future" ? 0.45 : 0.3;
}
