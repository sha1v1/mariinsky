import type { AudioState, MusicAnalysis } from "../audio/types";
import { getTuning } from "../audio/tuning";
import { INSTRUMENTS } from "../audio/types";

/**
 * Sends the memory text and the soundtrack's current state to the backend,
 * which asks Claude how the score should evolve. The API key lives only on the
 * server — nothing here touches it.
 */
export async function requestMusicAnalysis(
  memory: string,
  currentAudioState: AudioState,
): Promise<MusicAnalysis> {
  const tuning = getTuning();

  if (import.meta.env.DEV) {
    console.log("[memory] submitting:", memory);
    console.log("[memory] current audio state:", currentAudioState);
    console.log("[memory] tuning:", tuning);
  }

  const response = await fetch("/api/analyze-memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Intensity goes up too: the engine damps the result numerically, and the
    // prompt asks Claude for a matching scale of change, so the two agree.
    // Ambience biases the palette Claude composes in.
    body: JSON.stringify({
      memory,
      currentAudioState,
      intensity: tuning.intensity,
      ambience: tuning.ambience,
      allowedInstruments: INSTRUMENTS.filter(
        (instrument) => !tuning.disabledInstruments.includes(instrument),
      ),
    }),
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.detail) detail = body.detail;
      else if (body?.error) detail = body.error;
    } catch {
      /* response had no JSON body */
    }
    throw new Error(detail);
  }

  const analysis = (await response.json()) as MusicAnalysis;

  if (import.meta.env.DEV) {
    console.log("[memory] MusicAnalysis received:", analysis);
  }

  return analysis;
}
