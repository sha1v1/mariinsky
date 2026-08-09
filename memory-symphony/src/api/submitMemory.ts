import type { AudioEngine } from "../audio/AudioEngine";
import type { MusicAnalysis } from "../audio/types";
import { requestMusicAnalysis } from "./analyzeMemory";

export interface SubmitMemoryResult {
  analysis: MusicAnalysis;
  /** Instruments newly added to the mix by this memory. */
  newInstruments: string[];
}

/**
 * The full memory -> soundtrack handshake, and the actual integration entry
 * point for anything driving this AudioEngine: unlocks/resumes audio, reads
 * the engine's current state, asks the backend how the score should evolve,
 * then applies the result. Tuning (intensity, ambience, instrument palette,
 * etc.) is read from src/audio/tuning.ts inside requestMusicAnalysis — call
 * setTuning() before this if you want to bias the request.
 *
 * Must be called from inside a user-gesture handler (a click, a keypress) —
 * ensureStarted() unlocks the browser's audio context, which only works
 * synchronously within the gesture, so it runs before the network call rather
 * than after.
 */
export async function submitMemory(engine: AudioEngine, memory: string): Promise<SubmitMemoryResult> {
  await engine.ensureStarted();
  engine.resume();

  const analysis = await requestMusicAnalysis(memory, engine.getState());
  const newInstruments = engine.applyMusicAnalysis(analysis);

  return { analysis, newInstruments };
}
