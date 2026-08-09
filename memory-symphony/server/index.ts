import "dotenv/config";
import express from "express";
import { composeFromMemory } from "./composer";
import { AMBIENCE_IDS, INSTRUMENTS, SEED_STATE, type AudioState } from "../src/audio/types";

const INSTRUMENT_IDS: readonly string[] = INSTRUMENTS;

const PORT = Number(process.env.PORT ?? 8787);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "\n  ANTHROPIC_API_KEY is not set.\n" +
      "  Copy .env.example to .env and add your key before starting the server.\n",
  );
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/analyze-memory", async (req, res) => {
  const started = Date.now();
  const memory: unknown = req.body?.memory;

  if (typeof memory !== "string" || !memory.trim()) {
    return res.status(400).json({ error: "`memory` must be a non-empty string." });
  }
  if (memory.length > 4000) {
    return res.status(400).json({ error: "`memory` is too long (max 4000 characters)." });
  }

  // Fall back to the seed state so a client that has lost its state still works.
  const currentAudioState: AudioState = {
    ...SEED_STATE,
    ...(typeof req.body?.currentAudioState === "object" && req.body.currentAudioState
      ? req.body.currentAudioState
      : {}),
  };

  const rawIntensity = Number(req.body?.intensity);
  const intensity = Number.isFinite(rawIntensity) ? Math.min(3, Math.max(0, rawIntensity)) : 1;

  const rawAmbience = req.body?.ambience;
  const ambience = AMBIENCE_IDS.includes(rawAmbience) ? rawAmbience : "natural";

  const requested = req.body?.allowedInstruments;
  const filtered = Array.isArray(requested)
    ? requested.filter((id: unknown): id is string => INSTRUMENT_IDS.includes(id as string))
    : [];
  // An empty palette would make the schema enum invalid, so fall back to all.
  const allowedInstruments = filtered.length > 0 ? filtered : [...INSTRUMENTS];

  console.log("\n────────────────────────────────────────────────");
  console.log("[1] memory:", memory);
  console.log("[2] currentAudioState:", JSON.stringify(currentAudioState));
  console.log("    intensity:", intensity, "| ambience:", ambience);
  console.log("    palette:", allowedInstruments.join(", "));

  try {
    const { analysis, rawText } = await composeFromMemory(
      memory,
      currentAudioState,
      intensity,
      ambience,
      allowedInstruments,
    );

    console.log("[3] claude raw response:", rawText);
    console.log("[4] parsed MusicAnalysis:", JSON.stringify(analysis, null, 2));
    console.log(`    (${Date.now() - started}ms)`);

    res.json(analysis);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[!] analyze-memory failed:", detail);
    res.status(502).json({ error: "Failed to analyze memory.", detail });
  }
});

app.listen(PORT, () => {
  console.log(`Memory Symphony API listening on http://localhost:${PORT}`);
});
