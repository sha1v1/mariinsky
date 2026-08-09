import { useEffect, useState } from "react";
import { getTuning, setTuning, subscribeTuning, type Tuning } from "../audio/tuning";
import { AMBIENCES } from "../audio/types";

/**
 * Picks the palette Claude composes in. Applies to the next memory submitted —
 * it biases the request, so nothing changes until something is analyzed.
 */
export default function AmbienceSelector({ disabled }: { disabled?: boolean }) {
  const [tuning, setLocal] = useState<Tuning>(getTuning);

  useEffect(() => subscribeTuning(setLocal), []);

  const selected = AMBIENCES.find((a) => a.id === tuning.ambience) ?? AMBIENCES[0];

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 flex flex-col gap-3">
      <p className="text-sm text-slate-400">Ambience</p>

      <div className="flex flex-wrap gap-2">
        {AMBIENCES.map((ambience) => {
          const isActive = ambience.id === tuning.ambience;
          return (
            <button
              key={ambience.id}
              onClick={() => setTuning({ ambience: ambience.id })}
              disabled={disabled}
              title={ambience.description}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                isActive
                  ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
                  : "border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {ambience.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-slate-500">
        {selected.description} Shapes the palette of the next memory — the memory itself still
        decides the emotion.
      </p>
    </div>
  );
}
