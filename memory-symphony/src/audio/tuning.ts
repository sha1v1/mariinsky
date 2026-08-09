/**
 * Experimental controls for how drastically the soundtrack reacts to each new
 * memory. This does not change *what* Claude composes — only how far the engine
 * actually travels toward it, and how long it takes to get there.
 *
 * Resolution order (first wins):
 *   1. runtime  — window.memorySymphony.setIntensity(0.3)
 *   2. URL      — ?intensity=0.3&transitionScale=2
 *   3. storage  — persisted from a previous setTuning() call
 *   4. .env     — VITE_CHANGE_INTENSITY / VITE_TRANSITION_SCALE
 *   5. default  — 1.0 / 1.0
 */

import { AMBIENCE_IDS, INSTRUMENTS, type AmbienceId } from "./types";

export interface Tuning {
  /**
   * How far toward Claude's target state the engine actually moves.
   *   0    — ignore the analysis entirely; the score never changes
   *   0.25 — barely perceptible drift
   *   1    — exactly what Claude asked for (default)
   *   2    — double the delta; exaggerated, useful for hearing what a dimension does
   *
   * Below 0.25 harmony changes are skipped entirely (a key change cannot be
   * partially applied the way a continuous value can), so the score holds its
   * current key and only the texture drifts.
   */
  intensity: number;

  /**
   * Multiplies every transition time — fades, parameter ramps, and the pivot
   * chord's length. Higher is slower and smoother; lower is faster and more
   * obvious. Independent of intensity: you can have a large change happen
   * slowly, or a small one happen quickly.
   */
  transitionScale: number;

  /**
   * How readily the score modulates *between* memories, on its own.
   *   0   — never; the key only changes when a new memory arrives
   *   0.5 — roughly every other pass through the progression (default)
   *   1   — every pass
   *
   * Modulation transposes the progression already playing by a fourth or a
   * fifth — one step around the circle of fifths — and pivots on the chord
   * that is currently sounding, which is diatonic in both keys. Same music,
   * new key, no seam.
   */
  keyMovement: number;

  /**
   * Palette bias sent to Claude with each memory. Unlike the three values
   * above — which damp what the engine does with the answer — this shapes the
   * answer itself: key colour, tempo band, instrument choice, harmonic
   * language. The memory still supplies the emotion.
   */
  ambience: AmbienceId;

  /**
   * Instruments removed from the palette Claude may choose from. Stored as the
   * *disabled* set so that anything added to the catalogue later is enabled by
   * default rather than silently missing.
   *
   * This only governs what can be **added**. A disabled instrument that is
   * already playing keeps playing, and Claude can still fade it out — it just
   * cannot bring it in or turn it up.
   */
  disabledInstruments: string[];

  /**
   * Bars per chord — how often the harmony moves.
   *   0 — auto: use whatever harmonicRhythm Claude composed
   *   1 — a chord every bar (restless)
   *   6 — a chord every six bars (very still)
   *
   * Unlike the other settings this takes effect immediately, at the next bar,
   * rather than waiting for the next memory.
   */
  chordRate: number;
}

export const DEFAULT_TUNING: Tuning = {
  intensity: 1,
  transitionScale: 1,
  keyMovement: 0.5,
  ambience: "natural",
  disabledInstruments: [],
  chordRate: 0,
};

/** Progression cycles between self-modulations. 0 disables them entirely. */
export function modulationInterval(keyMovement: number): number {
  if (keyMovement <= 0.001) return 0;
  return Math.max(1, Math.round(4 - 3 * keyMovement));
}

const STORAGE_KEY = "memory-symphony:tuning";

const KNOWN_INSTRUMENTS = new Set<string>(INSTRUMENTS);

function toNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampTuning(raw: Partial<Tuning>): Tuning {
  return {
    intensity: Math.min(3, Math.max(0, toNumber(raw.intensity, DEFAULT_TUNING.intensity))),
    transitionScale: Math.min(
      8,
      Math.max(0.1, toNumber(raw.transitionScale, DEFAULT_TUNING.transitionScale)),
    ),
    keyMovement: Math.min(1, Math.max(0, toNumber(raw.keyMovement, DEFAULT_TUNING.keyMovement))),
    ambience: AMBIENCE_IDS.includes(raw.ambience as string)
      ? (raw.ambience as AmbienceId)
      : DEFAULT_TUNING.ambience,
    disabledInstruments: Array.isArray(raw.disabledInstruments)
      ? // Never let every instrument be disabled — there would be nothing to compose with.
        raw.disabledInstruments
          .filter((id): id is string => typeof id === "string" && KNOWN_INSTRUMENTS.has(id))
          .slice(0, INSTRUMENTS.length - 1)
      : [],
    chordRate: Math.min(6, Math.max(0, Math.round(toNumber(raw.chordRate, DEFAULT_TUNING.chordRate)))),
  };
}

function readStorage(): Partial<Tuning> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function readUrl(): Partial<Tuning> {
  try {
    const params = new URLSearchParams(window.location.search);
    const out: Partial<Tuning> = {};
    if (params.has("intensity")) out.intensity = Number(params.get("intensity"));
    if (params.has("transitionScale")) out.transitionScale = Number(params.get("transitionScale"));
    if (params.has("keyMovement")) out.keyMovement = Number(params.get("keyMovement"));
    if (params.has("ambience")) out.ambience = params.get("ambience") as AmbienceId;
    return out;
  } catch {
    return {};
  }
}

function readEnv(): Partial<Tuning> {
  const out: Partial<Tuning> = {};
  const intensity = import.meta.env.VITE_CHANGE_INTENSITY;
  const scale = import.meta.env.VITE_TRANSITION_SCALE;
  const keyMovement = import.meta.env.VITE_KEY_MOVEMENT;
  if (intensity !== undefined) out.intensity = Number(intensity);
  if (scale !== undefined) out.transitionScale = Number(scale);
  if (keyMovement !== undefined) out.keyMovement = Number(keyMovement);
  return out;
}

let current: Tuning = clampTuning({
  ...DEFAULT_TUNING,
  ...readEnv(),
  ...readStorage(),
  ...readUrl(),
});

type Listener = (tuning: Tuning) => void;
const listeners = new Set<Listener>();

/** Lets the UI follow changes made from the console, and vice versa. */
export function subscribeTuning(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  const snapshot = getTuning();
  listeners.forEach((listener) => listener(snapshot));
}

export function getTuning(): Tuning {
  return { ...current };
}

export function setTuning(next: Partial<Tuning>): Tuning {
  current = clampTuning({ ...current, ...next });
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable — the value still applies for this session */
  }
  console.log("[tuning]", current);
  notify();
  return getTuning();
}

export function resetTuning(): Tuning {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  current = { ...DEFAULT_TUNING };
  console.log("[tuning] reset", current);
  notify();
  return getTuning();
}

/** Human-readable label for the current intensity, shown next to the slider. */
export function describeIntensity(value: number): string {
  if (value <= 0.001) return "frozen";
  if (value < 0.25) return "imperceptible";
  if (value < 0.5) return "very subtle";
  if (value < 0.85) return "subtle";
  if (value <= 1.15) return "as composed";
  if (value < 1.6) return "pronounced";
  return "exaggerated";
}

export function describeTransitionScale(value: number): string {
  if (value < 0.6) return "quick";
  if (value <= 1.4) return "as composed";
  if (value < 2.5) return "slow";
  return "very slow";
}

export function describeChordRate(value: number): string {
  if (value <= 0) return "auto";
  return value === 1 ? "every bar" : `every ${value} bars`;
}

export function describeKeyMovement(value: number): string {
  const interval = modulationInterval(value);
  if (interval === 0) return "memories only";
  return interval === 1 ? "every cycle" : `every ${interval} cycles`;
}

// Console handle, so intensity can be changed mid-session without a reload —
// reloading would discard the soundtrack you are trying to A/B against.
if (typeof window !== "undefined") {
  (window as any).memorySymphony = {
    getTuning,
    setTuning,
    resetTuning,
    setIntensity: (value: number) => setTuning({ intensity: value }),
    setTransitionScale: (value: number) => setTuning({ transitionScale: value }),
    setKeyMovement: (value: number) => setTuning({ keyMovement: value }),
    setAmbience: (value: AmbienceId) => setTuning({ ambience: value }),
    setDisabledInstruments: (value: string[]) => setTuning({ disabledInstruments: value }),
    setChordRate: (value: number) => setTuning({ chordRate: value }),
  };
}
