// Puts a handful of memories in the garden so the wall is not empty the first
// time it is opened, and backfills any memory that predates the marble and
// emotion fields. Safe to run more than once: it never duplicates a seed and
// never touches a memory somebody actually contributed.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { splitText } from '../public/js/analyze.js';
import { textComponents } from '../public/js/components.js';
import { analyzeMemory } from '../public/js/emotion.js';
import { marbleColor } from '../public/js/marble.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORBS = path.join(__dirname, '..', 'data', 'orbs');
fs.mkdirSync(ORBS, { recursive: true });

const SEEDS = [
  'the smell of the hallway at my grandmother’s house, which was mostly floor polish and rain',
  'we laughed so hard at the wedding that somebody had to sit down on the kerb',
  'the lake at six in the morning, before anyone else was awake, completely still',
  'i miss the sound he made getting out of his chair',
  'the summer i was nine i was allowed to walk to the shop alone for the first time',
  'a very ordinary tuesday. nothing happened. i think about it constantly',
  'the forest after rain, walking slowly, not talking',
  'my sister’s birthday, the year we danced in the kitchen until the neighbours knocked',
];

async function existing() {
  const names = (await fsp.readdir(ORBS)).filter((f) => f.endsWith('.json'));
  const orbs = [];
  for (const n of names) {
    try { orbs.push(JSON.parse(await fsp.readFile(path.join(ORBS, n), 'utf8'))); } catch {}
  }
  return orbs.sort((a, b) => a.createdAt - b.createdAt);
}

const orbs = await existing();
const seeded = new Set(orbs.filter((o) => o.seeded).map((o) => o.title));
const palette = [];
let wrote = 0;

// Backfill first, so seeds draw their colour from a wall that already has one.
for (const orb of orbs) {
  let dirty = false;
  if (!orb.marble) { orb.marble = marbleColor(orb.id, palette.slice()); dirty = true; }
  if (!orb.emotion || !orb.analysis) {
    const text = Object.values(orb.sources)
      .filter((s) => s.kind === 'text').map((s) => s.text).join(' ') || orb.title;
    const a = analyzeMemory(text);
    orb.emotion = a.emotion;
    orb.analysis = a;
    dirty = true;
  }
  if (dirty) {
    await fsp.writeFile(path.join(ORBS, `${orb.id}.json`), JSON.stringify(orb));
    wrote++;
  }
  palette.push(orb.marble);
}

// Stagger the seeds backwards through the last few days so the wall reads as
// something that grew rather than something that was installed.
let when = Date.now() - SEEDS.length * 5 * 3600 * 1000;

for (const text of SEEDS) {
  if (seeded.has(text.split('\n')[0].slice(0, 110))) continue;
  const id = crypto.randomBytes(6).toString('hex');
  const frags = splitText(text);
  const analysis = analyzeMemory(text);
  const orb = {
    id,
    title: text.slice(0, 110),
    createdAt: when,
    seeded: true,
    glow: '#8fa9ff',
    marble: marbleColor(id, palette.slice()),
    emotion: analysis.emotion,
    analysis,
    decay: 0,
    sources: { txt1: { kind: 'text', text, label: 'what was written' } },
    components: textComponents('txt1', frags),
    versions: [],
  };
  await fsp.writeFile(path.join(ORBS, `${id}.json`), JSON.stringify(orb));
  palette.push(orb.marble);
  when += 5 * 3600 * 1000;
  wrote++;
}

console.log(`  seeded/updated ${wrote} memories — ${palette.length} marbles on the wall`);
