// Memory text -> musical parameters. Ported from memory-symphony's
// EmotionMapper.ts, with two additions: the matched keywords are returned so
// the interface can show its working, and every profile carries a hue used to
<<<<<<< HEAD
// tint the emotion in the collection's data panel.
=======
// tint the emotion in the garden's data panel.
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
//
// There is no model behind this. It is a keyword score against five profiles,
// which is exactly why it can be explained to someone in one sentence.

const PROFILES = {
  nostalgia: {
    keywords: [
      'grandfather', 'grandmother', 'grandpa', 'grandma', 'childhood',
      'remember', 'used to', 'back then', 'memory', 'memories', 'young',
      'old house', 'school', 'home', 'family', 'past', 'summer',
      'taught me', 'when i was', 'years ago', 'used to play',
    ],
    tempoRange: [70, 85],
    mood: 'warm',
    instruments: ['piano', 'ambient pad'],
    chords: [
      ['C3', 'E3', 'G3', 'B3'],
      ['A2', 'C3', 'E3', 'G3'],
      ['F2', 'A2', 'C3', 'E3'],
      ['G2', 'B2', 'D3', 'F3'],
    ],
    reverb: 0.45,
    hue: 38,
  },
  joy: {
    keywords: [
      'happy', 'laughed', 'laughing', 'celebration', 'party', 'fun',
      'excited', 'joy', 'joyful', 'birthday', 'wedding', 'won', 'win',
      'achievement', 'dance', 'danced', 'smile', 'smiled', 'celebrate',
      'graduation', 'proud',
    ],
    tempoRange: [120, 140],
    mood: 'bright',
    instruments: ['synth lead', 'plucked strings', 'percussion'],
    chords: [
      ['C4', 'E4', 'G4'],
      ['F4', 'A4', 'C5'],
      ['G4', 'B4', 'D5'],
      ['C4', 'E4', 'G4'],
    ],
    reverb: 0.15,
    hue: 48,
  },
  peace: {
    keywords: [
      'calm', 'quiet', 'beach', 'ocean', 'meditation', 'peaceful',
      'nature', 'forest', 'rain', 'sunset', 'walk', 'still', 'breeze',
      'stars', 'lake', 'silence', 'serene', 'gentle', 'morning',
    ],
    tempoRange: [55, 68],
    mood: 'ambient',
    instruments: ['ambient pad', 'soft strings'],
    chords: [
      ['C3', 'G3', 'D4'],
      ['F3', 'C4', 'G4'],
      ['A2', 'E3', 'B3'],
      ['C3', 'G3', 'D4'],
    ],
    reverb: 0.55,
    hue: 172,
  },
  sadness: {
    keywords: [
      'sad', 'cry', 'crying', 'cried', 'loss', 'lost', 'died', 'death',
      'lonely', 'miss', 'missed', 'hurt', 'breakup', 'goodbye', 'funeral',
      'grief', 'tears', 'alone', 'heartbreak', 'regret',
    ],
    tempoRange: [55, 65],
    mood: 'somber',
    instruments: ['strings', 'piano'],
    chords: [
      ['A2', 'C3', 'E3'],
      ['D3', 'F3', 'A3'],
      ['E2', 'G2', 'B2'],
      ['A2', 'C3', 'E3'],
    ],
    reverb: 0.4,
    hue: 214,
  },
};

export const EMOTIONS = ['nostalgia', 'joy', 'peace', 'sadness', 'neutral'];

export const EMOTION_HUE = {
  nostalgia: 38, joy: 48, peace: 172, sadness: 214, neutral: 268,
};

const NEUTRAL = {
  emotion: 'neutral',
  tempo: 90,
  mood: 'neutral',
  instruments: ['piano'],
  chords: [['C3', 'E3', 'G3'], ['F2', 'A2', 'C3']],
  reverb: 0.3,
  matched: [],
};

function matches(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw));
}

/**
 * Seeded so a memory's tempo never changes between openings -- the original
 * picked it with Math.random(), which meant the same memory drifted in speed
 * every time it was analysed.
 */
function inRange([min, max], t) {
  return Math.round(min + t * (max - min));
}

export function analyzeMemory(text, tempoSeed = 0.5) {
  const ranked = Object.keys(PROFILES)
    .map((key) => ({ key, hits: matches(text, PROFILES[key].keywords) }))
    .sort((a, b) => b.hits.length - a.hits.length);

  const top = ranked[0];
  if (!top || !top.hits.length) return { ...NEUTRAL };

  const profile = PROFILES[top.key];
  return {
    emotion: top.key,
    tempo: inRange(profile.tempoRange, tempoSeed),
    mood: profile.mood,
    instruments: [...profile.instruments],
    chords: profile.chords,
    reverb: profile.reverb,
    matched: top.hits.slice(0, 4),
  };
}

/** One plain sentence explaining why a memory sounds the way it does. */
export function explain(analysis) {
  if (!analysis) return '';
  if (analysis.emotion === 'neutral' || !analysis.matched?.length) {
    return 'nothing matched, so it joined on a plain piano at 90 bpm';
  }
  const words = analysis.matched.map((w) => `“${w}”`).join(', ');
  return `${words} → ${analysis.emotion} → ${analysis.instruments.join(' and ')} at ${analysis.tempo} bpm`;
}

<<<<<<< HEAD
/** The chord bed for the collection as a whole, from every memory in it. */
=======
/** The chord bed for the garden as a whole, from every memory in it. */
>>>>>>> f8ef35f94a047518ee9cf60e2a6ddc84c8087aa8
export function wallChords(emotions) {
  const tally = {};
  for (const e of emotions) tally[e] = (tally[e] || 0) + 1;
  const dominant = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
  return PROFILES[dominant]?.chords || NEUTRAL.chords;
}
