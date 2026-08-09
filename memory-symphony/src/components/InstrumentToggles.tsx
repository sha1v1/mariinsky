import { useEffect, useState } from "react";
import { getTuning, setTuning, subscribeTuning, type Tuning } from "../audio/tuning";
import { INSTRUMENTS, INSTRUMENT_GROUPS } from "../audio/types";

/**
 * Controls which instruments Claude is allowed to reach for. Enabling one does
 * not add it — Claude still decides whether it belongs in the composition.
 * Disabling one only stops it being added; anything already playing continues.
 */
export default function InstrumentToggles({ disabled }: { disabled?: boolean }) {
  const [tuning, setLocal] = useState<Tuning>(getTuning);

  useEffect(() => subscribeTuning(setLocal), []);

  const disabledSet = new Set(tuning.disabledInstruments);
  const enabledCount = INSTRUMENTS.length - disabledSet.size;

  const toggle = (instrument: string) => {
    const next = new Set(disabledSet);
    if (next.has(instrument)) next.delete(instrument);
    else if (enabledCount > 1) next.add(instrument); // never disable the last one
    setTuning({ disabledInstruments: [...next] });
  };

  const setAll = (ids: readonly string[], enable: boolean) => {
    const next = new Set(disabledSet);
    ids.forEach((id) => (enable ? next.delete(id) : next.add(id)));
    // Guard against switching everything off.
    if (INSTRUMENTS.length - next.size < 1) return;
    setTuning({ disabledInstruments: [...next] });
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Palette{" "}
          <span className="text-slate-600 text-xs">
            ({enabledCount}/{INSTRUMENTS.length})
          </span>
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setAll(INSTRUMENTS, true)}
            disabled={disabled || disabledSet.size === 0}
            className="text-xs text-slate-500 hover:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            All
          </button>
          <button
            onClick={() => setAll(INSTRUMENTS.slice(1), false)}
            disabled={disabled}
            className="text-xs text-slate-500 hover:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            None
          </button>
        </div>
      </div>

      {INSTRUMENT_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-600">{group.label}</p>
          <div className="flex flex-wrap gap-2">
            {group.instruments.map((instrument) => {
              const isOn = !disabledSet.has(instrument);
              return (
                <button
                  key={instrument}
                  onClick={() => toggle(instrument)}
                  disabled={disabled}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    isOn
                      ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
                      : "border-slate-800 bg-slate-900/60 text-slate-600 hover:text-slate-400"
                  }`}
                >
                  {instrument}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-xs text-slate-600">
        Enabled instruments are offered to Claude — it still decides whether each one belongs.
        Disabling stops an instrument being added; anything already playing keeps going and can
        still be faded out.
      </p>
    </div>
  );
}
