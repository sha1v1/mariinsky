# Memory Symphony

```
memory text
  → POST /api/analyze-memory  (+ current AudioState + tuning)
  → Claude (claude-haiku-4-5, structured output)
  → MusicAnalysis  (target state, layer changes, harmony plan)
  → AudioEngine.applyMusicAnalysis()
  → Tone.js: ramps, fades, pivot-chord modulation — nothing jumps
```

Claude never returns audio or notes, only directions — the engine decides
how to voice a chord against what's already playing.

## Ideas For Integration (Feel Free to Discard)

1. We already have a base track 
2. When you hover over a memory, we could slightly modify the chord progression while staying in the same key so its not a crazy transition
3. When you click into the memory, maybe we nudge the LLM to make a more aggressive change (ex. changing the key changing more chord)

## Layout

```
src/
  App.tsx                    UI: memory list, transport, tuning panels
  api/
    analyzeMemory.ts         fetch wrapper — POSTs to backend, reads tuning
    submitMemory.ts          full handshake: unlock audio → get state → analyze → apply
  audio/
    types.ts                 shared contract (AudioState, MusicAnalysis, catalogues) — imported by both client and server
    AudioEngine.ts            Tone.js playback engine
    EmotionMapper.ts          music theory: chord parsing, voicing, voice-leading, melody
    tuning.ts                 experimental controls
  components/                 MemoryInput, AudioVisualizer, AmbienceSelector, InstrumentToggles, TuningControls
server/
  index.ts                    Express app, POST /api/analyze-memory
  composer.ts                 system prompt, structured-output schema, sanitize()
```

## Setup

```bash
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY
npm run dev
```

Runs Vite (`:5173`) and the Express backend (`:8787`) together; Vite proxies
`/api/*`. Open `localhost:5173` and submit a memory — browsers require a user
gesture to start audio, so nothing plays until the first click.

## Backend

**`POST /api/analyze-memory`**

```jsonc
{
  "memory": "string",
  "currentAudioState": { /* AudioState */ },
  "intensity": 1,                          // optional, 0–3, default 1
  "ambience": "natural",                   // optional
  "allowedInstruments": ["piano", "..."]   // optional, defaults to all
}
```
→ a `MusicAnalysis` object, or `4xx`/`502` with `{ error, detail }`.

- `claude-haiku-4-5`, response forced via `output_config.format` (JSON
  schema), not prompt-only instructions.
- The instrument enum is built **per request** from `allowedInstruments` — a
  disabled instrument literally cannot be returned.
- `sanitize()` re-clamps every field server-side regardless of what the
  model said (ranges, transition times, instrument names).
- Full request/response cycle logged to the console.

## Engine

`AudioEngine` owns a Tone.js effects chain, one layer per active instrument,
and a harmony clock advancing on its own transport-synced loop.

- **Nothing jumps** — volumes ramp over `transitionSeconds`; key changes
  hold a *pivot chord* (valid in both old and new key) for a few bars before
  the new progression takes over.
- **Layers persist** — `applyMusicAnalysis()` only touches instruments
  Claude mentions; everything else keeps playing. This is the actual
  continuity mechanism.
- **Self-modulates** — independent of memories, the engine can transpose its
  own progression by a fourth/fifth every few cycles so a long listen
  doesn't loop forever (tunable via key movement / chord rate).
- **20 instruments**, 8 arrangement roles (bed / swell / figure / arpeggio /
  melody / bass / drone / percussive), including 5 percussion voices on
  `MembraneSynth`/`NoiseSynth`.

`EmotionMapper.ts` is the music theory underneath: chord symbol parsing,
voice-leading (each chord tone moves to the nearest available note rather
than leaping), and a weighted-random melody generator that stays in key by
construction. Claude sends chord symbols, never notes — this turns them into
something playable.

## The contract

**`AudioState`** (engine → request): `tempo`; `brightness`/`warmth`/`energy`/`tension` (`-1..1`); `activeLayers: {instrument, volume}[]`; `key`, `chordProgression`.

**`MusicAnalysis`** (Claude → engine): `emotion` (label); `targetState` (same five dimensions, as a target); `layerChanges: {instrument, action, targetVolume, transitionSeconds}[]`; `effects: {reverb, filterFrequency}`; `harmony: {key, chordProgression, pivotChord, transitionBars, harmonicRhythm}`.

The engine never jumps straight to `targetState` — it interpolates toward it, scaled by the intensity knob below.

## Tuning (experimentation only — doesn't change what Claude decides, only how closely it's followed)

| Control | Range | Effect |
|---|---|---|
| Change intensity | 0–2 | How far the engine moves toward Claude's target (0 = frozen, 1 = as composed). Below 0.25, key changes are skipped. Also sent to Claude so it composes matching deltas. |
| Transition length | 0.25×–4× | Multiplies every fade/ramp/pivot duration. Independent of intensity. |
| Key movement | 0–1 | How often the score self-modulates *between* memories. |
| Chord rate | 0–6 bars | Overrides chord-change frequency. `0` = as composed. Takes effect immediately. |
| Ambience | 6 presets | Biases the *palette* (Upbeat/Melancholy/Dreamlike/Cinematic/Intimate/Natural) — subordinate to the memory's own emotion, never overrides it. |
| Instrument palette | 20 toggles | What Claude may **add**. Disabling doesn't remove an instrument already playing. |

Exposed as UI, persists to `localStorage`, URL-overridable
(`?intensity=0.3&ambience=dreamlike`). Resolution order in `tuning.ts`:
runtime → URL → storage → `.env` → default.

## Integrating elsewhere

```ts
import { AudioEngine } from "./audio/AudioEngine";
import { submitMemory } from "./api/submitMemory";
import { setIntensity, setAmbience } from "./audio/tuning";

const engine = new AudioEngine();
setIntensity(0.5);
setAmbience("upbeat");

// must run inside a user-gesture handler — ensureStarted() unlocks audio
button.onclick = () => submitMemory(engine, textarea.value);
```

- `submitMemory()` is the whole handshake — the one call per memory.
- Every tuning value has a named setter (`setIntensity`, `setAmbience`,
  `setTransitionScale`, `setKeyMovement`, `setChordRate`,
  `setDisabledInstruments`) plus batch `setTuning(partial)` — plain module
  exports, not React-specific.
- `audio/types.ts` is the full shared type contract.
- Only `intensity`, `ambience`, and `allowedInstruments` travel over HTTP.
  `transitionScale`/`keyMovement`/`chordRate` are engine-local — a different
  engine implementation would need its own version of that logic.

## Not here yet

No persistence (refresh resets everything), no tests, percussion/FM-synth
timbres unaudited by ear, and the three engine-local tuning values aren't
exposed over the API.
