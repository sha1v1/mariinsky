// Step 1.4 — batched local embeddings via transformers.js (same model as
// scripts/gen-anchors.ts: Xenova/bge-small-en-v1.5, 384-dim, mean-pooled,
// normalized). The pipeline is loaded once per process and reused — model
// load is the slow part (seconds); each embed call after that is fast.
// Verified batching behavior directly before relying on it: a 3-text batch
// returns dims [3, 384] via .tolist(), i.e. one 384-length array per input,
// in input order.

import { pipeline } from "@huggingface/transformers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractorPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getExtractor(): Promise<any> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", "Xenova/bge-small-en-v1.5");
  }
  return extractorPromise;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist() as number[][];
}

export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embedBatch([text]);
  return vec;
}

// Vectors from embedBatch/embedOne are already L2-normalized, so a plain
// dot product equals cosine similarity — no need to divide by magnitudes.
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
