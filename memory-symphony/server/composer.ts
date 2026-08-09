import Anthropic from "@anthropic-ai/sdk";
import { INSTRUMENTS, type AudioState, type MusicAnalysis } from "../src/audio/types";

const MODEL = "claude-haiku-4-5";

const client = new Anthropic();

export const SYSTEM_PROMPT = `You are an AI composer for a personal memory visualization application.

Your job is to translate personal memories into subtle changes to an existing, continuously playing ambient soundtrack.

You are NOT generating a new song. You are NOT writing melodies or rhythms. You are adjusting the emotional state of one continuous piece of music that has been playing since the user's first memory and must keep playing without interruption.

Think of yourself as the composer of a personal documentary score. The music should feel like a single evolving work, not a playlist.

## Core principles

1. CONTINUITY ABOVE ALL. The soundtrack already exists. Preserve it. Most of what is playing should keep playing.
2. SMALL DELTAS. Move each value a little way from its current position. A memory should nudge the score, not restart it. Large jumps in tempo, brightness or key are almost always wrong.
3. PRESERVE THEMES. Layers established by earlier memories carry that memory's emotional trace. Do not remove a layer unless the new memory genuinely contradicts it.
4. FEW CHANGES PER MEMORY. Typically 1-2 layer changes. Adding one instrument and slightly adjusting another is a good response. Rewriting every layer is not.

## Emotional dimensions

Consider nostalgia, joy, sadness, reflection, hope, uncertainty, and emotional complexity. Memories are rarely one thing — "I moved away from home" is loss and possibility at once, and the score should hold both.

targetState values, all -1 to 1 except tempo:
- tempo: 50-140 BPM. Ambient scores live around 60-90. Move by at most ~15 BPM at a time.
- brightness: -1 dark/muted, 1 bright/open. Drives filter cutoff.
- warmth: -1 thin and distant, 1 warm and close. Nostalgia is warm.
- energy: -1 completely still, 1 driving. Most reflective memories sit below 0.4.
- tension: -1 fully resolved, 1 unresolved. Uncertainty and anticipation raise this.

## Instruments

The available palette is listed in the user turn. Use ONLY instruments from that list — it changes between requests, and anything outside it will be discarded.

Volumes are 0 to 1; 0.25-0.5 is a healthy layer. To remove a layer, use action "decrease" with targetVolume 0 — it will fade out and then be disposed. transitionSeconds should be 8-20 for a natural feel; never below 4.

Percussion is an accent, not a groove. Keep drum volumes low (0.12-0.3) and only bring them in when the memory genuinely has forward motion or unease. A reflective memory usually wants none at all.

## Harmony

You choose the harmonic plan. The application handles voicing, register and note timing.

- Prefer EXTENDED chords over plain triads: maj7, maj9, add9, sus2, m9, m11, 6/9. Triads sound naive; extensions sound cinematic.
- Give 6-8 chords in chordProgression. A longer progression takes longer to come back round, so the score stays interesting between memories. Let it travel: pass through a couple of related chords before returning home rather than rocking between two.
- harmonicRhythm: bars per chord, 1-3. Use 2 by default, 1 for movement, 3 for the most still and reflective memories. Do NOT go higher — a chord held longer than about three bars makes the music feel frozen.
- Move the key whenever the memory's emotional centre genuinely shifts; a score that never modulates gets monotonous. Prefer closely related keys: the relative major/minor, a neighbouring key on the circle of fifths, or modal interchange. Distant keys are still reserved for dramatic shifts.
- pivotChord MUST be a chord that works in both the old and the new key. It is held during the crossover so the listener is walked into the new tonal centre. If the key is not changing, use a chord common to both progressions.
- transitionBars: 4-12. Longer for bigger emotional distance.

Modulating is not a violation of continuity — continuity is about the texture and the layers persisting. The same instruments moving through a new key is exactly what a documentary score does.

Return only the structured JSON object. No commentary.`;

/** What each instrument is for, so Claude picks by function rather than name. */
const INSTRUMENT_NOTES: Record<string, string> = {
  "ambient pad": "the harmonic bed. Almost always present.",
  strings: "swelling, emotional, cinematic.",
  "soft strings": "gentler counter-line above the bed.",
  cello: "low sustained strings. Gravity and sorrow.",
  choir: "wordless voices. Human, elegiac, wide.",
  glass: "high shimmering texture. Fragile, distant, cold light.",
  piano: "intimate, personal, memory-like. Broken chords.",
  celesta: "music-box bells, very high. Childhood, wonder, fragility.",
  marimba: "warm wooden mallets, mid register. Gentle motion.",
  vibraphone: "soft metallic mallets. Hazy, jazz-tinged nostalgia.",
  harp: "cascading arpeggios. Flowing, romantic, dreamlike.",
  "plucked strings": "delicate movement, curiosity, light.",
  "synth lead": "sparse melodic line. Longing or clarity.",
  bass: "low root notes. Weight and grounding.",
  "sub drone": "a very low sustained pedal tone. Dread, vastness, stillness.",
  kick: "soft low pulse, like a heartbeat. Use sparingly.",
  tom: "muted low drum accents. Occasional, ritual.",
  shaker: "quiet steady eighth-note texture. Forward motion.",
  rim: "dry backbeat click. Restlessness, ticking time.",
  cymbal: "slow noise swells. Tension, arrival, breath.",
};

function describePalette(allowed: string[]): string {
  const lines = allowed.map((id) => `- "${id}" — ${INSTRUMENT_NOTES[id] ?? ""}`.trimEnd());
  return `## Available palette for this request\n\nUse ONLY these instruments:\n${lines.join("\n")}`;
}

/**
 * Structured-output schema. Numeric bounds are deliberately absent — the
 * structured-output validator does not support min/max, so ranges are enforced
 * by sanitize() below. The instrument enum is built per request, since the
 * caller can disable part of the palette.
 */
function buildSchema(allowed: string[]) {
  const schema = structuredClone(BASE_SCHEMA) as any;
  schema.properties.layerChanges.items.properties.instrument.enum = allowed;
  return schema;
}

const BASE_SCHEMA = {
  type: "object",
  properties: {
    emotion: {
      type: "string",
      description: "Short phrase naming the emotional quality, e.g. 'nostalgic excitement'.",
    },
    targetState: {
      type: "object",
      properties: {
        tempo: { type: "number", description: "Target BPM, 50-140." },
        brightness: { type: "number", description: "-1 to 1." },
        warmth: { type: "number", description: "-1 to 1." },
        energy: { type: "number", description: "-1 to 1." },
        tension: { type: "number", description: "-1 to 1." },
      },
      required: ["tempo", "brightness", "warmth", "energy", "tension"],
      additionalProperties: false,
    },
    layerChanges: {
      type: "array",
      description: "Usually 1-2 entries. Leave untouched layers out entirely.",
      items: {
        type: "object",
        properties: {
          instrument: { type: "string", enum: [...INSTRUMENTS] },
          action: { type: "string", enum: ["add", "increase", "decrease"] },
          targetVolume: { type: "number", description: "0 to 1. Use 0 to fade a layer out." },
          transitionSeconds: { type: "number", description: "8-20 recommended." },
        },
        required: ["instrument", "action", "targetVolume", "transitionSeconds"],
        additionalProperties: false,
      },
    },
    effects: {
      type: "object",
      properties: {
        reverb: { type: "number", description: "Wet amount, 0 to 1." },
        filterFrequency: { type: "number", description: "Hz, 200-16000." },
      },
      required: ["reverb", "filterFrequency"],
      additionalProperties: false,
    },
    harmony: {
      type: "object",
      properties: {
        key: { type: "string", description: "e.g. 'A minor', 'Bb major', 'D dorian'." },
        chordProgression: {
          type: "array",
          description:
            "6-8 chord symbols that travel before returning home, e.g. ['Am9','Fmaj7','Cmaj9','Gsus2','Em9','Dm7','Fmaj7','Gsus4'].",
          items: { type: "string" },
        },
        pivotChord: { type: "string", description: "Chord valid in both old and new key." },
        transitionBars: { type: "number", description: "4-12." },
        harmonicRhythm: { type: "number", description: "Bars per chord, 1-3. Default 2." },
      },
      required: ["key", "chordProgression", "pivotChord", "transitionBars", "harmonicRhythm"],
      additionalProperties: false,
    },
  },
  required: ["emotion", "targetState", "layerChanges", "effects", "harmony"],
  additionalProperties: false,
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Belt-and-braces normalisation. The schema guarantees shape but not ranges,
 * and the AudioEngine should never receive a value it has to defend against.
 */
export function sanitize(raw: any, current: AudioState, allowedInstruments?: string[]): MusicAnalysis {
  const allowed = new Set<string>(allowedInstruments ?? INSTRUMENTS);

  const layerChanges = Array.isArray(raw?.layerChanges) ? raw.layerChanges : [];

  return {
    emotion: typeof raw?.emotion === "string" && raw.emotion.trim() ? raw.emotion.trim() : "reflective",

    targetState: {
      tempo: clamp(raw?.targetState?.tempo, 50, 140, current.tempo),
      brightness: clamp(raw?.targetState?.brightness, -1, 1, current.brightness),
      warmth: clamp(raw?.targetState?.warmth, -1, 1, current.warmth),
      energy: clamp(raw?.targetState?.energy, -1, 1, current.energy),
      tension: clamp(raw?.targetState?.tension, -1, 1, current.tension),
    },

    layerChanges: layerChanges
      .filter((change: any) => allowed.has(change?.instrument))
      .map((change: any) => ({
        instrument: change.instrument,
        action: ["add", "increase", "decrease"].includes(change?.action) ? change.action : "increase",
        targetVolume: clamp(change?.targetVolume, 0, 1, 0.35),
        // Never allow an abrupt layer change, whatever the model asked for.
        transitionSeconds: clamp(change?.transitionSeconds, 4, 30, 10),
      })),

    effects: {
      reverb: clamp(raw?.effects?.reverb, 0, 1, 0.4),
      filterFrequency: clamp(raw?.effects?.filterFrequency, 200, 16000, 3500),
    },

    harmony: {
      key: typeof raw?.harmony?.key === "string" && raw.harmony.key.trim() ? raw.harmony.key.trim() : current.key,
      chordProgression:
        Array.isArray(raw?.harmony?.chordProgression) && raw.harmony.chordProgression.length > 0
          ? raw.harmony.chordProgression.filter((c: unknown) => typeof c === "string" && c.trim()).slice(0, 8)
          : [...current.chordProgression],
      pivotChord:
        typeof raw?.harmony?.pivotChord === "string" && raw.harmony.pivotChord.trim()
          ? raw.harmony.pivotChord.trim()
          : current.chordProgression[0],
      transitionBars: Math.round(clamp(raw?.harmony?.transitionBars, 2, 16, 8)),
      // Capped at 4: anything longer holds a single chord for 15+ seconds and
      // the score stops feeling like it is moving.
      harmonicRhythm: Math.round(clamp(raw?.harmony?.harmonicRhythm, 1, 4, 2)),
    },
  };
}

/** Pulls the first JSON object out of a string, for the unlikely case that
 *  structured output is unavailable and the model wraps its answer in prose. */
function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON object found in model response");
    return JSON.parse(text.slice(start, end + 1));
  }
}

export interface ComposeResult {
  analysis: MusicAnalysis;
  rawText: string;
}

/**
 * The engine damps the returned values numerically by the same intensity, but
 * asking for a matching scale of change keeps the two in agreement — otherwise
 * a subtle setting would just be a bold analysis quietly cut down, and harmony
 * (which cannot be damped) would still swing.
 */
function intensityGuidance(intensity: number): string {
  if (intensity <= 0.5) {
    return `## Change scale for this request: SUBTLE

The listener has asked for very gradual evolution. Keep every delta small:
- Move tempo by no more than ~5 BPM.
- Move each -1..1 dimension by no more than ~0.15.
- Prefer 0-1 layer changes. Often the right answer is a single small volume adjustment.
- Stay in the current key unless the emotional shift is extreme. Reuse most of the current progression, changing at most one chord.
- Use the longer end of transitionSeconds (15-20).`;
  }

  if (intensity >= 1.5) {
    return `## Change scale for this request: BOLD

The listener has asked for pronounced change between memories. Commit to the shift:
- Tempo may move by up to ~25 BPM.
- Dimensions may move by up to ~0.6.
- Use 2-3 layer changes, and do not hesitate to fade out a layer that no longer fits.
- Modulating to a related key is encouraged when the emotion genuinely turns.
- Use the shorter end of transitionSeconds (8-12).

Continuity still matters — this is the same piece of music, just travelling further.`;
  }

  return `## Change scale for this request: NORMAL

Move each value a modest distance from its current position. Tempo within ~15 BPM, dimensions within ~0.3, typically 1-2 layer changes.`;
}

/**
 * Palette bias. Deliberately phrased as an accent on top of the memory rather
 * than a replacement for it — otherwise "upbeat" produces cheerful music for a
 * memory about grief, which is worse than useless.
 */
function ambienceGuidance(ambience: string): string {
  switch (ambience) {
    case "upbeat":
      return `## Ambience: UPBEAT

Bias the palette toward light and forward motion. Favour major keys and bright extensions (add9, 6/9, maj9, sus2). Put tempo in the upper part of its sensible range and keep energy positive. Prefer instruments that move — plucked strings, piano figures, a light percussion pulse — over a static bed alone. Harmonic rhythm of 1-2 bars.

This colours the palette; it does not overrule the memory. A painful memory here should come back bittersweet, warm and moving — never falsely cheerful.`;

    case "melancholy":
      return `## Ambience: MELANCHOLY

Bias toward minor keys and darker colour: m9, m11, m7b5, suspensions that resolve late or not at all. Lower tempo (58-76) and lower brightness, but keep warmth mid-to-high so it reads as sad rather than cold. Favour strings and piano.

A happy memory here should come back fond and touched with loss — not miserable.`;

    case "dreamlike":
      return `## Ambience: DREAMLIKE

Weightless and unmoored. Favour suspended, unresolved harmony (sus2, sus4, maj7#11, add9) and avoid strong V-I cadences — the music should feel like it is floating rather than arriving. Slow tempo (55-70), low energy, high reverb (0.7+), brightness slightly soft. Favour ambient pad and soft strings; no percussion. Harmonic rhythm at the slower end (3).`;

    case "cinematic":
      return `## Ambience: CINEMATIC

Big and swelling, with a wide ensemble. Favour strings and bass for weight, and harmony with real movement between chords (maj9, m11, sus4 into major). Tempo 70-90, energy 0.3-0.6, reverb 0.5-0.7. Use up to 3 layer changes to build the ensemble out. Harmonic rhythm 1-2 so it drives forward.`;

    case "intimate":
      return `## Ambience: INTIMATE

Small and close, as if played in one room for one person. Favour piano above all, with at most a quiet pad or bass beneath it. Keep the total to 2-3 layers and volumes modest (0.2-0.35). Low reverb (0.25-0.4), warmth high, energy low. Simple, unshowy harmony — maj7, m7, add9. No percussion, no synth lead.`;

    default:
      return `## Ambience: NATURAL

No palette bias. Read the memory on its own terms and choose whatever colour, tempo and instrumentation genuinely fits it.`;
  }
}

export async function composeFromMemory(
  memory: string,
  currentAudioState: AudioState,
  intensity = 1,
  ambience = "natural",
  allowedInstruments: string[] = [...INSTRUMENTS],
): Promise<ComposeResult> {
  const isFirstMemory = currentAudioState.activeLayers.length === 0;

  // Instruments already playing stay referenceable even once disabled, so a
  // layer can still be faded out after its instrument is switched off.
  const playing = currentAudioState.activeLayers.map((layer) => layer.instrument);
  const referenceable = Array.from(new Set([...allowedInstruments, ...playing]));
  const retired = playing.filter((instrument) => !allowedInstruments.includes(instrument));

  const userContent = [
    isFirstMemory
      ? "This is the FIRST memory — the soundtrack has not started yet. Establish the opening texture with 2-3 layers."
      : "The soundtrack is already playing. Evolve it; do not restart it.",
    "",
    intensityGuidance(intensity),
    "",
    ambienceGuidance(ambience),
    "",
    describePalette(allowedInstruments),
    retired.length > 0
      ? `\nStill playing but no longer in the palette: ${retired
          .map((instrument) => `"${instrument}"`)
          .join(", ")}. You may fade these out, but must not add to or increase them.`
      : "",
    "",
    "Current soundtrack state:",
    JSON.stringify(currentAudioState, null, 2),
    "",
    "New memory:",
    memory,
  ].join("\n");

  // `output_config` is cast because the installed SDK typings lag the
  // structured-outputs parameter; the wire shape is correct.
  const message = (await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: buildSchema(referenceable) },
    },
    messages: [{ role: "user", content: userContent }],
  } as any)) as Anthropic.Message;

  const rawText = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (!rawText.trim()) {
    throw new Error(`model returned no text content (stop_reason: ${message.stop_reason})`);
  }

  return {
    analysis: sanitize(extractJson(rawText), currentAudioState, referenceable),
    rawText,
  };
}
