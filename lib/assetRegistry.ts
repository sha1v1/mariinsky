import type { AnchorType, EntityKind } from "./ontology.ts";
import type { AppearanceSpec, BehaviorSpec, PlacementRequirements } from "./types.ts";

export type AssetEntityKind = Exclude<EntityKind, "structure">;

export interface SemanticWorldEntity {
  entityKind: EntityKind;
  noun: string;
  label: string;
  assetSearchTerms: string[];
  semanticTags: string[];
  groundingEvidence: string[];
  placementRequirements: PlacementRequirements;
  appearance: AppearanceSpec;
  behavior: BehaviorSpec;
}

export interface AssetRegistryEntry {
  id: string;
  path: string;
  displayName: string;
  semanticTags: string[];
  aliases: string[];
  entityKind: AssetEntityKind;
  compatibleAnchors: AnchorType[];
  editable: { color: boolean; material: boolean; scale: boolean };
  defaultScale: number;
  family: string;
  enabled: boolean;
  license: { type: "CC0" | "CC-BY"; source?: string; author?: string };
}

export const SCALE_MULTIPLIERS: Record<AppearanceSpec["scale"], number> = {
  tiny: 0.35, miniature: 0.5, small: 0.75, medium: 1, large: 1.35,
};

const ALL_SURFACES: AnchorType[] = ["table", "desk", "shelf", "windowsill", "floor", "generic_surface"];
const GROUND: AnchorType[] = ["ground", "floor", "garden_bed", "path"];
const WATER: AnchorType[] = ["water"];
const ORIGINAL_LICENSE: AssetRegistryEntry["license"] = {
  type: "CC0",
  source: "Memory World original low-poly library",
  author: "Memory World contributors",
};

function polyPizzaLicense(modelId: string, author = "Quaternius"): AssetRegistryEntry["license"] {
  return { type: "CC0", source: `https://poly.pizza/m/${modelId}`, author };
}

function entry(
  id: string,
  category: "domestic" | "nature" | "creatures" | "miscellaneous",
  displayName: string,
  semanticTags: string[],
  aliases: string[],
  entityKind: AssetEntityKind,
  compatibleAnchors: AnchorType[],
  defaultScale = 1,
  family = id,
  editableColor = true,
  license = ORIGINAL_LICENSE,
): AssetRegistryEntry {
  return {
    id: `${id}_01`, path: `/models/${category}/${id}.glb`, displayName,
    semanticTags, aliases, entityKind, compatibleAnchors,
    editable: { color: editableColor, material: true, scale: true },
    defaultScale, family, enabled: true,
    license,
  };
}

/** 45 intentionally reviewed, lightweight GLBs. No runtime downloads. */
export const ASSET_REGISTRY: AssetRegistryEntry[] = [
  entry("mug", "domestic", "Ceramic Mug", ["mug", "cup", "coffee", "tea", "drink", "kitchen", "home"], ["coffee mug", "tea cup", "ceramic cup"], "supported_object", ALL_SURFACES, 0.85, "vessel"),
  entry("book", "domestic", "Clothbound Book", ["book", "story", "reading", "school", "library", "home"], ["novel", "storybook", "journal", "notebook"], "supported_object", ALL_SURFACES, 0.75, "book"),
  entry("lamp", "domestic", "Table Lamp", ["lamp", "light", "reading", "study", "bedroom", "home"], ["desk lamp", "bedside lamp", "light fixture"], "supported_object", ["table", "desk", "shelf", "floor", "generic_surface"], 0.8, "light"),
  entry("chair", "domestic", "Wooden Chair", ["chair", "seat", "furniture", "dining", "study", "home"], ["dining chair", "desk chair", "wooden seat"], "standalone_object", ["floor", "ground"], 0.9, "furniture"),
  entry("table", "domestic", "Wooden Table", ["table", "desk", "furniture", "dining", "work", "home"], ["dining table", "side table", "wooden desk"], "standalone_object", ["floor", "ground"], 0.9, "furniture"),
  entry("radio", "domestic", "Old Radio", ["radio", "music", "broadcast", "sound", "nostalgia", "home"], ["wireless", "transistor radio", "music player"], "supported_object", ALL_SURFACES, 0.7, "electronics"),
  entry("clock", "domestic", "Mantel Clock", ["clock", "time", "morning", "night", "home"], ["alarm clock", "wall clock", "watch", "timepiece"], "supported_object", ["table", "desk", "shelf", "wall", "generic_surface"], 0.62, "timepiece"),
  entry("camera", "domestic", "Vintage Camera", ["camera", "photo", "photograph", "travel", "family", "memory"], ["film camera", "photo camera", "camcorder"], "supported_object", ALL_SURFACES, 0.68, "camera"),
  entry("plant", "domestic", "Potted Plant", ["plant", "houseplant", "leaf", "home", "garden", "growth"], ["potted plant", "indoor plant", "pot plant"], "plant", ALL_SURFACES, 0.78, "plant"),
  entry("toy", "domestic", "Wooden Toy", ["toy", "childhood", "play", "home", "nostalgia"], ["small toy", "childhood toy", "decoration", "figurine"], "supported_object", ALL_SURFACES, 0.62, "toy"),
  entry("bed", "domestic", "Small Bed", ["bed", "sleep", "bedroom", "night", "home", "rest"], ["single bed", "childhood bed", "cot"], "standalone_object", ["floor"], 0.82, "furniture"),
  entry("bookcase", "domestic", "Bookcase", ["bookcase", "shelf", "books", "library", "study", "home"], ["bookshelf", "shelving", "library shelf"], "standalone_object", ["floor", "wall"], 0.82, "furniture"),
  entry("phone", "domestic", "Mobile Phone", ["phone", "mobile", "cellphone", "call", "message", "screen", "technology"], ["cell phone", "smartphone", "mobile phone", "telephone"], "supported_object", ALL_SURFACES, 0.75, "electronics", true, polyPizzaLicense("k2kgBepoMU")),
  entry("computer", "domestic", "Desktop Computer", ["computer", "desktop", "monitor", "technology", "work", "school", "gaming"], ["desktop computer", "pc", "work computer", "monitor"], "supported_object", ["desk", "table", "shelf", "generic_surface"], 0.8, "electronics", true, polyPizzaLicense("emxvTSMKnt")),
  entry("lute", "domestic", "Wooden Lute", ["lute", "guitar", "instrument", "music", "song", "performance", "strings"], ["acoustic guitar", "string instrument", "mandolin", "ukulele"], "supported_object", ["floor", "wall", "chair", "table", "generic_surface"], 0.75, "instrument", true, polyPizzaLicense("q3IXa6QH1C")),
  entry("pizza", "domestic", "Pizza", ["pizza", "food", "dinner", "restaurant", "party", "family", "friends"], ["whole pizza", "pizza pie", "takeout pizza"], "supported_object", ["table", "desk", "generic_surface"], 0.28, "food", true, polyPizzaLicense("XmmG0uImLL")),
  entry("cake", "domestic", "Celebration Cake", ["cake", "birthday", "dessert", "celebration", "party", "food"], ["birthday cake", "celebration cake", "dessert"], "supported_object", ["table", "desk", "shelf", "generic_surface"], 1.3, "food", true, polyPizzaLicense("KGFyP16ebH", "Kenney")),
  entry("apple", "domestic", "Apple", ["apple", "fruit", "food", "school", "orchard", "snack"], ["red apple", "green apple", "piece of fruit"], "supported_object", ["table", "desk", "shelf", "generic_surface"], 3.5, "food", true, polyPizzaLicense("o4Of5itnxB", "Kenney")),
  entry("tree", "nature", "Round Canopy Tree", ["tree", "forest", "garden", "nature", "shade", "outdoor"], ["oak", "apple tree", "pine tree", "woodland tree"], "plant", GROUND, 0.9, "tree"),
  entry("flower", "nature", "Wildflower", ["flower", "garden", "spring", "nature", "gift", "love"], ["rose", "daisy", "wildflower", "blossom"], "plant", ["garden_bed", "ground", "floor", "generic_surface"], 0.72, "flower"),
  entry("mushroom", "nature", "Woodland Mushroom", ["mushroom", "forest", "autumn", "nature", "small"], ["toadstool", "fungus", "forest mushroom"], "plant", GROUND, 0.72, "mushroom"),
  entry("rock", "nature", "Smooth Rock", ["rock", "stone", "beach", "mountain", "nature", "ground"], ["pebble", "boulder", "smooth stone"], "environment_feature", GROUND, 0.75, "stone"),
  entry("pond", "nature", "Small Pond", ["pond", "water", "lake", "reflection", "garden", "nature"], ["water feature", "small lake", "pool"], "environment_feature", ["ground", "garden_bed", "water"], 0.9, "water", false),
  entry("bird", "creatures", "Small Bird", ["bird", "flight", "song", "sky", "garden", "freedom"], ["sparrow", "robin", "songbird"], "creature", ["tree_branch", "ground", "windowsill"], 0.68, "bird"),
  entry("deer", "creatures", "Gentle Deer", ["deer", "reindeer", "forest", "christmas", "animal", "winter"], ["reindeer", "stag", "doe", "toy deer"], "creature", GROUND, 0.76, "deer"),
  entry("rabbit", "creatures", "Small Rabbit", ["rabbit", "bunny", "garden", "spring", "animal", "soft"], ["bunny", "hare", "toy rabbit"], "creature", GROUND, 0.7, "rabbit"),
  entry("cat", "creatures", "House Cat", ["cat", "pet", "home", "animal", "companion"], ["kitten", "kitty", "house cat"], "creature", ["floor", "ground", "chair", "windowsill"], 0.72, "cat"),
  entry("fish", "creatures", "Small Fish", ["fish", "water", "pet", "ocean", "river", "animal"], ["goldfish", "trout", "little fish"], "creature", WATER, 0.68, "fish"),
  entry("butterfly", "creatures", "Butterfly", ["butterfly", "garden", "summer", "change", "flight", "delicate"], ["moth", "monarch", "winged insect"], "creature", ["garden_bed", "tree_branch", "ground"], 0.62, "butterfly"),
  entry("dog", "creatures", "Dog", ["dog", "pet", "puppy", "animal", "companion", "home", "walk"], ["puppy", "pet dog", "family dog", "canine"], "creature", GROUND, 0.75, "dog", true, polyPizzaLicense("2kUk0QqpCg")),
  entry("horse", "creatures", "Horse", ["horse", "pony", "animal", "farm", "riding", "stable", "countryside"], ["pony", "riding horse", "farm horse", "mare"], "creature", GROUND, 0.5, "horse", true, polyPizzaLicense("D3hAeqeDBE")),
  entry("fox", "creatures", "Red Fox", ["fox", "wildlife", "forest", "animal", "red fox", "woodland"], ["red fox", "woodland fox", "wild fox"], "creature", GROUND, 0.3, "fox", true, polyPizzaLicense("Bc97C66HKi")),
  entry("cow", "creatures", "Cow", ["cow", "cattle", "animal", "farm", "pasture", "countryside"], ["dairy cow", "farm cow", "cattle"], "creature", GROUND, 0.18, "cow", true, polyPizzaLicense("5XSc2Fka3F")),
  entry("frog", "creatures", "Frog", ["frog", "toad", "animal", "pond", "wetland", "amphibian"], ["green frog", "pond frog", "toad", "amphibian"], "creature", [...GROUND, ...WATER], 0.42, "frog", true, polyPizzaLicense("37wofOCOzG")),
  entry("umbrella", "miscellaneous", "Umbrella", ["umbrella", "rain", "weather", "travel", "shelter"], ["parasol", "rain umbrella"], "standalone_object", ["floor", "ground", "path"], 0.74, "weather gear"),
  entry("backpack", "miscellaneous", "Canvas Backpack", ["backpack", "school", "travel", "journey", "childhood"], ["school bag", "rucksack", "travel bag"], "supported_object", ["floor", "chair", "desk", "generic_surface"], 0.72, "bag"),
  entry("bell", "miscellaneous", "Brass Bell", ["bell", "sound", "school", "church", "celebration", "metal"], ["hand bell", "school bell", "brass bell"], "supported_object", ALL_SURFACES, 0.66, "keepsake"),
  entry("lantern", "miscellaneous", "Warm Lantern", ["lantern", "light", "night", "camping", "home", "warmth"], ["camp lantern", "oil lamp", "night light"], "supported_object", ALL_SURFACES, 0.7, "light"),
  entry("shell", "miscellaneous", "Spiral Shell", ["shell", "beach", "ocean", "summer", "keepsake", "travel"], ["seashell", "conch", "beach shell"], "supported_object", ALL_SURFACES, 0.62, "keepsake"),
  entry("car", "miscellaneous", "Small Car", ["car", "vehicle", "driving", "road", "travel", "commute", "transport"], ["family car", "sedan", "automobile", "vehicle"], "standalone_object", ["ground", "path", "floor"], 0.52, "vehicle", true, polyPizzaLicense("unqqkULtRU")),
  entry("bench", "miscellaneous", "Park Bench", ["bench", "seat", "park", "garden", "outdoor", "rest"], ["park bench", "garden bench", "outdoor seat"], "standalone_object", ["ground", "path", "garden_bed", "floor"], 0.95, "furniture", true, polyPizzaLicense("nARUaxtRHA")),
  entry("tent", "miscellaneous", "Camping Tent", ["tent", "camping", "camp", "outdoor", "shelter", "trip", "night"], ["camping tent", "small tent", "camp shelter"], "standalone_object", ["ground", "floor"], 0.065, "shelter", true, polyPizzaLicense("5Q7qIrfDxA")),
  entry("key", "miscellaneous", "House Key", ["key", "home", "door", "lock", "moving", "metal"], ["house key", "door key", "metal key"], "supported_object", ALL_SURFACES, 0.7, "keepsake", true, polyPizzaLicense("y3bSVdIjTh")),
  entry("first_aid", "miscellaneous", "First Aid Kit", ["first aid", "medical", "health", "hospital", "care", "emergency", "kit"], ["first aid kit", "medical kit", "emergency kit"], "supported_object", ["table", "desk", "shelf", "floor", "generic_surface"], 0.6, "medical", true, polyPizzaLicense("wP00rePSRD")),
  entry("keepsake", "miscellaneous", "Memory Keepsake", ["keepsake", "token", "coin", "medallion", "charm", "memento", "souvenir", "memory", "object"], ["small token", "souvenir token", "brass coin", "metal medallion", "pendant", "trinket", "souvenir", "generic object"], "standalone_object", [...ALL_SURFACES, "ground", "path"], 0.62, "keepsake"),
];

const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
const stems = (value: string) => new Set(clean(value).split(" ").filter(Boolean).map((w) => w.replace(/(ies|ing|ed|es|s)$/i, "")));

function overlap(queries: string[], candidates: string[]): number {
  if (queries.length === 0 || candidates.length === 0) return 0;
  let best = 0;
  for (const query of queries) {
    const q = clean(query);
    const qTokens = stems(q);
    for (const candidate of candidates) {
      const c = clean(candidate);
      if (q === c) return 1;
      if (q.includes(c) || c.includes(q)) best = Math.max(best, 0.88);
      const cTokens = stems(c);
      const common = [...qTokens].filter((token) => cTokens.has(token)).length;
      best = Math.max(best, common / Math.max(qTokens.size, cTokens.size, 1));
    }
  }
  return best;
}

function kindScore(entity: SemanticWorldEntity, asset: AssetRegistryEntry): number {
  if (entity.entityKind === asset.entityKind) return 1;
  if (entity.entityKind === "supported_object" && asset.entityKind === "standalone_object") return 0.7;
  if (entity.entityKind === "standalone_object" && asset.entityKind === "supported_object") return 0.55;
  if ((entity.entityKind === "plant" && asset.entityKind === "environment_feature") ||
      (entity.entityKind === "environment_feature" && asset.entityKind === "plant")) return 0.35;
  return 0;
}

function anchorScore(entity: SemanticWorldEntity, asset: AssetRegistryEntry): number {
  const preferred = entity.placementRequirements.preferredAnchors;
  if (preferred.length === 0) return entity.placementRequirements.canExistStandalone ? 1 : 0.5;
  return preferred.some((anchor) => asset.compatibleAnchors.includes(anchor)) ? 1 : 0;
}

export interface AssetRetrievalResult {
  asset: AssetRegistryEntry;
  score: number;
  tier: "exact" | "related" | "family" | "keepsake";
}

export function retrieveAsset(
  semanticEntity: SemanticWorldEntity,
  registry: AssetRegistryEntry[] = ASSET_REGISTRY,
): AssetRetrievalResult {
  const enabled = registry.filter((asset) => asset.enabled && asset.license.type === "CC0");
  const queryTerms = [semanticEntity.noun, ...semanticEntity.assetSearchTerms];
  const scored = enabled.map((asset) => {
    const identityTerms = [asset.displayName, ...asset.aliases];
    const nounMatch = overlap([semanticEntity.noun], identityTerms);
    const lexicalMatch = overlap(queryTerms, identityTerms);
    const semanticTagMatch = overlap(semanticEntity.semanticTags, asset.semanticTags);
    const entityKindMatch = kindScore(semanticEntity, asset);
    const anchorCompatibility = anchorScore(semanticEntity, asset);
    return { asset, nounMatch, lexicalMatch, score: 0.45 * lexicalMatch + 0.25 * semanticTagMatch + 0.15 * entityKindMatch + 0.15 * anchorCompatibility };
  }).sort((a, b) => b.score - a.score);

  // Retrieval hierarchy is intentional: an explicit noun/alias hit wins
  // before broader context does. This keeps "reindeer toy" represented by
  // the deer primitive instead of a generic toy merely because both are
  // domestic and shelf-compatible.
  const directNoun = scored.filter((candidate) => candidate.nounMatch >= 0.82).sort((a, b) => b.nounMatch - a.nounMatch || b.score - a.score)[0];
  if (directNoun) return { asset: directNoun.asset, score: directNoun.score, tier: "exact" };
  const exact = scored.filter((candidate) => candidate.lexicalMatch >= 0.98).sort((a, b) => b.score - a.score)[0];
  if (exact) return { asset: exact.asset, score: exact.score, tier: "exact" };
  const best = scored[0];
  if (best && best.lexicalMatch >= 0.82) return { asset: best.asset, score: best.score, tier: "related" };
  if (best && best.score >= 0.48) return { asset: best.asset, score: best.score, tier: "related" };
  if (best && best.score >= 0.32) return { asset: best.asset, score: best.score, tier: "family" };
  const keepsake = registry.find((asset) => asset.id === "keepsake_01") ?? ASSET_REGISTRY.at(-1)!;
  return { asset: keepsake, score: best?.score ?? 0, tier: "keepsake" };
}

export function retrieveBestAsset(
  semanticEntity: SemanticWorldEntity,
  registry: AssetRegistryEntry[] = ASSET_REGISTRY,
): AssetRegistryEntry | null {
  return registry.length > 0 ? retrieveAsset(semanticEntity, registry).asset : null;
}
