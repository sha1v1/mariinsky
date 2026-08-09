/**
 * Downloads the deliberately curated external half of Memory World's model
 * library. Every entry is verified as Public Domain (CC0) on its Poly Pizza
 * page before its GLB is written. Re-run with:
 *
 *   npm run models:download
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const assets = [
  { id: "dog", category: "creatures", modelId: "2kUk0QqpCg" },
  { id: "horse", category: "creatures", modelId: "D3hAeqeDBE" },
  { id: "fox", category: "creatures", modelId: "Bc97C66HKi" },
  { id: "cow", category: "creatures", modelId: "5XSc2Fka3F" },
  { id: "frog", category: "creatures", modelId: "37wofOCOzG" },
  { id: "phone", category: "domestic", modelId: "k2kgBepoMU" },
  { id: "computer", category: "domestic", modelId: "emxvTSMKnt" },
  { id: "lute", category: "domestic", modelId: "q3IXa6QH1C" },
  { id: "pizza", category: "domestic", modelId: "XmmG0uImLL" },
  { id: "cake", category: "domestic", modelId: "KGFyP16ebH" },
  { id: "apple", category: "domestic", modelId: "o4Of5itnxB" },
  { id: "car", category: "miscellaneous", modelId: "unqqkULtRU" },
  { id: "bench", category: "miscellaneous", modelId: "nARUaxtRHA" },
  { id: "tent", category: "miscellaneous", modelId: "5Q7qIrfDxA" },
  { id: "key", category: "miscellaneous", modelId: "y3bSVdIjTh" },
  { id: "first_aid", category: "miscellaneous", modelId: "wP00rePSRD" },
];

for (const asset of assets) {
  const source = `https://poly.pizza/m/${asset.modelId}`;
  const pageResponse = await fetch(source, { headers: { "user-agent": "MemoryWorldAssetCurator/1.0" } });
  if (!pageResponse.ok) throw new Error(`${asset.id}: source page returned ${pageResponse.status}`);
  const page = await pageResponse.text();
  if (!page.includes("Public Domain (CC0)")) {
    throw new Error(`${asset.id}: source page no longer declares Public Domain (CC0)`);
  }

  const candidates = [...page.matchAll(/https:\/\/static\.poly\.pizza\/[a-f0-9-]+\.glb(?:\.br)?/gi)]
    .map((match) => match[0].replace(/\.br$/i, ""));
  const downloadUrl = candidates[0];
  if (!downloadUrl) throw new Error(`${asset.id}: no GLB URL found on source page`);

  const modelResponse = await fetch(downloadUrl, { headers: { "user-agent": "MemoryWorldAssetCurator/1.0" } });
  if (!modelResponse.ok) throw new Error(`${asset.id}: GLB download returned ${modelResponse.status}`);
  const bytes = new Uint8Array(await modelResponse.arrayBuffer());
  if (bytes.length < 20 || new TextDecoder().decode(bytes.slice(0, 4)) !== "glTF") {
    throw new Error(`${asset.id}: download is not a valid binary glTF file`);
  }

  const output = resolve(`public/models/${asset.category}/${asset.id}.glb`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, bytes);
  console.log(`${asset.id.padEnd(12)} ${String(Math.round(bytes.length / 1024)).padStart(5)} KB  ${source}`);
}
