import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { specificityFor, inventedArtifactPenalty } from "../lib/grounding.ts";
import { anchorPosition } from "../lib/sceneCoordinates.ts";
import { ASSET_REGISTRY, retrieveAsset } from "../lib/assetRegistry.ts";

const source = "I am currently going to the zoo and seeing deer";
assert.equal(specificityFor("spotted deer", ["zoo", "deers"], source), 1);
assert.equal(specificityFor("souvenir token", ["zoo", "deers"], source), 0.3);
assert.equal(inventedArtifactPenalty("souvenir token", source, "ongoing"), 0.45);
assert.equal(inventedArtifactPenalty("souvenir token", "I bought a souvenir token", "past"), 0);

// These deliberately mimic pre-3D persisted anchors with localX/localY but
// no position. Stable ids must resolve to canonical surface heights.
const legacyTable = { id: "table-main", type: "table", localX: 220, localY: 210 };
const legacyShelf = { id: "shelf-upper", type: "shelf", localX: 340, localY: 100 };
const legacyFloor = { id: "floor-left", type: "floor", localX: 100, localY: 260 };
assert.equal(anchorPosition(legacyTable, "small_house")[1], 1.02);
assert.equal(anchorPosition(legacyShelf, "small_house")[1], 1.38);
assert.equal(anchorPosition(legacyFloor, "small_house")[1], 0.01);

assert.equal(ASSET_REGISTRY.length, 50);
const externalAssets = ASSET_REGISTRY.filter((asset) => asset.license.source?.startsWith("https://poly.pizza/"));
assert.equal(externalAssets.length, 21);
for (const asset of externalAssets) {
  assert.equal(asset.license.type, "CC0");
  assert.ok(asset.license.author);
  assert.ok(existsSync(`public${asset.path}`), `missing ${asset.path}`);
}

function retrievalFor(noun, terms, kind = "standalone_object") {
  return retrieveAsset({
    noun,
    label: noun,
    assetSearchTerms: terms,
    semanticTags: terms,
    groundingEvidence: [noun],
    entityKind: kind,
    placementRequirements: { canExistStandalone: kind !== "supported_object", environmentTags: [], preferredAnchors: [] },
    appearance: { colorFamily: "warm brown", scale: "small", condition: "worn", materialStyle: "matte" },
    behavior: { animation: "still" },
  });
}

assert.equal(retrievalFor("family dog", ["dog", "pet"], "creature").asset.id, "dog_01");
assert.equal(retrievalFor("birthday cake", ["cake", "dessert"], "supported_object").asset.id, "cake_01");
assert.equal(retrievalFor("mobile phone", ["phone", "cellphone"], "supported_object").asset.id, "phone_01");
assert.equal(retrievalFor("wooden footbridge", ["bridge", "crossing"], "environment_feature").asset.id, "bridge_01");
assert.equal(retrievalFor("garden fountain", ["fountain", "water"], "environment_feature").asset.id, "fountain_01");

console.log("3D pipeline checks passed: grounding, anchors, 50 registered assets, and external CC0 files");
