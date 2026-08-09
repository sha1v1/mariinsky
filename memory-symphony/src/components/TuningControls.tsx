import { useEffect, useState } from "react";
import {
  DEFAULT_TUNING,
  describeChordRate,
  describeIntensity,
  describeKeyMovement,
  describeTransitionScale,
  getTuning,
  resetTuning,
  setTuning,
  subscribeTuning,
  type Tuning,
} from "../audio/tuning";

/**
 * Experimentation controls for how far the soundtrack moves per memory.
 * Values apply to the next memory submitted — an in-flight transition is never
 * interrupted mid-fade.
 */
export default function TuningControls() {
  const [tuning, setLocal] = useState<Tuning>(getTuning);

  // Keep in sync with window.memorySymphony.setIntensity(...) from the console.
  useEffect(() => subscribeTuning(setLocal), []);

  const isDefault =
    tuning.intensity === DEFAULT_TUNING.intensity &&
    tuning.transitionScale === DEFAULT_TUNING.transitionScale &&
    tuning.keyMovement === DEFAULT_TUNING.keyMovement &&
    tuning.ambience === DEFAULT_TUNING.ambience &&
    tuning.chordRate === DEFAULT_TUNING.chordRate &&
    tuning.disabledInstruments.length === 0;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">Tuning</p>
        <button
          onClick={() => resetTuning()}
          disabled={isDefault}
          className="text-xs text-slate-500 hover:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Reset
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between text-sm">
            <span className="text-slate-300">Change intensity</span>
            <span className="text-slate-500 text-xs tabular-nums">
              {tuning.intensity.toFixed(2)} &middot; {describeIntensity(tuning.intensity)}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={tuning.intensity}
            onChange={(e) => setTuning({ intensity: Number(e.target.value) })}
            className="w-full accent-indigo-500 cursor-pointer"
          />
          <span className="text-xs text-slate-500">
            How far the score moves toward each new memory.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between text-sm">
            <span className="text-slate-300">Transition length</span>
            <span className="text-slate-500 text-xs tabular-nums">
              {tuning.transitionScale.toFixed(2)}&times; &middot;{" "}
              {describeTransitionScale(tuning.transitionScale)}
            </span>
          </span>
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.25}
            value={tuning.transitionScale}
            onChange={(e) => setTuning({ transitionScale: Number(e.target.value) })}
            className="w-full accent-indigo-500 cursor-pointer"
          />
          <span className="text-xs text-slate-500">
            How long fades, ramps and key changes take.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between text-sm">
            <span className="text-slate-300">Key movement</span>
            <span className="text-slate-500 text-xs tabular-nums">
              {tuning.keyMovement.toFixed(2)} &middot; {describeKeyMovement(tuning.keyMovement)}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={tuning.keyMovement}
            onChange={(e) => setTuning({ keyMovement: Number(e.target.value) })}
            className="w-full accent-indigo-500 cursor-pointer"
          />
          <span className="text-xs text-slate-500">
            How often the score modulates on its own, between memories.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between text-sm">
            <span className="text-slate-300">Chord rate</span>
            <span className="text-slate-500 text-xs tabular-nums">
              {describeChordRate(tuning.chordRate)}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={6}
            step={1}
            value={tuning.chordRate}
            onChange={(e) => setTuning({ chordRate: Number(e.target.value) })}
            className="w-full accent-indigo-500 cursor-pointer"
          />
          <span className="text-xs text-slate-500">
            Bars per chord. 0 follows what Claude composed. Takes effect immediately.
          </span>
        </label>
      </div>

      <p className="text-xs text-slate-600">
        {tuning.intensity < 0.25
          ? "Below 0.25 the key is held — only texture drifts. Applies to the next memory."
          : "Applies to the next memory."}
      </p>
    </div>
  );
}
