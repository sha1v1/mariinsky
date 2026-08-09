import { useState } from "react";
import { AudioEngine } from "./audio/AudioEngine";
import { requestMusicAnalysis } from "./api/analyzeMemory";
import type { MusicAnalysis } from "./audio/types";
import MemoryInput from "./components/MemoryInput";
import AudioVisualizer from "./components/AudioVisualizer";
import TuningControls from "./components/TuningControls";
import AmbienceSelector from "./components/AmbienceSelector";
import InstrumentToggles from "./components/InstrumentToggles";

interface MemoryEntry {
  id: string;
  text: string;
  analysis: MusicAnalysis;
  newInstruments: string[];
}

const EMOTION_COLORS: Record<string, string> = {
  nostalg: "text-amber-400",
  joy: "text-yellow-300",
  happ: "text-yellow-300",
  excite: "text-yellow-300",
  peace: "text-teal-300",
  calm: "text-teal-300",
  hope: "text-emerald-300",
  sad: "text-blue-300",
  grief: "text-blue-300",
  loss: "text-blue-300",
  reflect: "text-indigo-300",
  uncertain: "text-violet-300",
};

/** Claude returns free-form emotion phrases, so match on a fragment. */
function emotionColor(emotion: string): string {
  const lower = emotion.toLowerCase();
  const hit = Object.keys(EMOTION_COLORS).find((key) => lower.includes(key));
  return hit ? EMOTION_COLORS[hit] : "text-slate-300";
}

export default function App() {
  const [engine] = useState(() => new AudioEngine());
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeInstruments, setActiveInstruments] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateSoundscape = async (text: string) => {
    setIsAnalyzing(true);
    setError(null);
    try {
      // Start audio first so the context is unlocked by this user gesture,
      // even though the analysis round-trip happens before anything sounds.
      // resume() also covers submitting a memory while the score is paused.
      await engine.ensureStarted();
      engine.resume();

      const analysis = await requestMusicAnalysis(text, engine.getState());
      const newInstruments = engine.applyMusicAnalysis(analysis);

      setMemories((prev) => [
        ...prev,
        { id: `${Date.now()}-${prev.length}`, text, analysis, newInstruments },
      ]);
      setActiveInstruments(engine.instruments);
      setIsPlaying(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleStart = async () => {
    await engine.ensureStarted();
    engine.resume();
    setIsPlaying(true);
  };

  const handleStop = () => {
    engine.pause();
    setIsPlaying(false);
  };

  const handleClear = () => {
    engine.reset();
    setMemories([]);
    setActiveInstruments([]);
    setIsPlaying(false);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-10">
      <div className="mx-auto max-w-3xl flex flex-col gap-8">
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Memory Symphony</h1>
          <p className="text-slate-400 text-sm">
            Every memory contributes a new layer to a living soundtrack.
          </p>
        </header>

        <MemoryInput onSubmit={handleCreateSoundscape} disabled={isAnalyzing} />

        {isAnalyzing && (
          <p className="text-sm text-indigo-400 -mt-4">Listening to the memory&hellip;</p>
        )}
        {error && <p className="text-sm text-rose-400 -mt-4">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={handleStart}
            disabled={isPlaying}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium transition-colors"
          >
            Start
          </button>
          <button
            onClick={handleStop}
            disabled={!isPlaying}
            className="rounded-lg bg-rose-600 hover:bg-rose-500 disabled:bg-slate-700 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium transition-colors"
          >
            Stop
          </button>
          <button
            onClick={handleClear}
            disabled={memories.length === 0}
            className="rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium transition-colors ml-auto"
          >
            Clear all
          </button>
        </div>

        <AmbienceSelector disabled={isAnalyzing} />

        <InstrumentToggles disabled={isAnalyzing} />

        <TuningControls />

        <AudioVisualizer engine={engine} isActive={isPlaying} />

        {activeInstruments.length > 0 && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-sm text-slate-400 mb-1">Current soundtrack layers</p>
            <p className="text-lg font-medium">{activeInstruments.join(" + ")}</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {memories
            .slice()
            .reverse()
            .map((memory) => (
              <div key={memory.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <p className="text-slate-200 mb-2">&ldquo;{memory.text}&rdquo;</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span className={`font-semibold ${emotionColor(memory.analysis.emotion)}`}>
                    {memory.analysis.emotion}
                  </span>
                  <span className="text-slate-400">
                    tempo: {Math.round(memory.analysis.targetState.tempo)} bpm
                  </span>
                  <span className="text-slate-400">key: {memory.analysis.harmony.key}</span>
                  <span className="text-slate-400">
                    {memory.analysis.harmony.chordProgression.join(" - ")}
                  </span>
                </div>
                {memory.newInstruments.length > 0 ? (
                  <p className="text-xs text-indigo-400 mt-2">
                    + added layer: {memory.newInstruments.join(", ")}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 mt-2">blended into existing layers</p>
                )}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
