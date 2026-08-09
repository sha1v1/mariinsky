// The objects on the page.
//
// Everything lying on the paper -- a memory and the junk around it alike -- is a
// photographic cut-out out of `public/images/items/`, built from the asset
// library by `scripts/items.mjs`. Two things come out of this module:
//
//   matchItem(memory)     the object a memory *is*, read off what it says
//   fillerItem(col, row)  the object in a cell no memory took
//
// A memory is matched to an object by its own words: "the smell of bakery
// bread" is a pretzel, "my sister's birthday" is a slice of cake. When nothing
// in the library is close, the memory stays a marble -- which is the honest
// answer, and is also why the marble photograph is excluded from the pool
// below: a glass marble on this page means "no object fits", and a second,
// photographic kind of marble would make that sentence ambiguous.
//
// Matching is a keyword table rather than anything cleverer on purpose. It runs
// on the wall payload with no network call and no model, it is inspectable, and
// a wrong match is a wrong picture rather than a wrong memory. Tags come in two
// strengths: `strong` is the object itself or an unmistakable cue for it, `weak`
// is an association. It takes one strong hit or two weak ones to beat the
// marble, so a single glancing word never renames a memory.

import { mulberry32 } from './rng.js';

const STRONG = 2;
const WEAK = 1;
const THRESHOLD = 2;

/** Excluded from the pool entirely: the app already has a marble. */
const RESERVED = new Set(['marble']);

const TAGS = {
  'acorn':                { strong: ['acorn'], weak: ['oak', 'squirrel', 'autumn', 'forest', 'woods', 'nut'] },
  'bandaid':              { strong: ['bandaid', 'band-aid', 'plaster'], weak: ['scrape', 'grazed', 'knee', 'stitches', 'hospital', 'fell over', 'hurt'] },
  'birthday-cake-slice':  { strong: ['birthday', 'cake'], weak: ['candles', 'party', 'blew out', 'blow out', 'wish', 'celebrat', 'turning'] },
  'blueberry':            { strong: ['blueberr'], weak: ['berries', 'picking', 'jam', 'muffin'] },
  'button':               { strong: ['button'], weak: ['sewing', 'cardigan', 'coat', 'shirt', 'jar'] },
  'cherry':               { strong: ['cherry', 'cherries'], weak: ['blossom', 'pie', 'orchard', 'stem'] },
  'chestnut':             { strong: ['chestnut', 'conker'], weak: ['roast', 'autumn', 'fall'] },
  'chocolate-chip-cookie': { strong: ['cookie', 'biscuit'], weak: ['baking', 'bake', 'dough', 'oven', 'chocolate', 'kitchen'] },
  'coin':                 { strong: ['coin', 'penny', 'pennies', 'quarter'], weak: ['money', 'change', 'pocket', 'allowance', 'wishing well', 'shop', 'saved up'] },
  'coral':                { strong: ['coral', 'reef'], weak: ['snorkel', 'diving', 'tropical', 'ocean'] },
  'crayon':               { strong: ['crayon'], weak: ['colouring', 'coloring', 'drawing', 'drew', 'kindergarten', 'school'] },
  'cupcake':              { strong: ['cupcake'], weak: ['frosting', 'icing', 'sprinkles', 'bake sale'] },
  'daisy':                { strong: ['daisy', 'daisies'], weak: ['flower', 'meadow', 'field', 'spring', 'chain', 'garden'] },
  'dandelion':            { strong: ['dandelion'], weak: ['wish', 'blowing', 'seeds', 'lawn', 'weeds', 'puff'] },
  'donut':                { strong: ['donut', 'doughnut'], weak: ['glazed', 'sprinkles', 'coffee'] },
  'driftwood':            { strong: ['driftwood'], weak: ['beach', 'shore', 'tide', 'washed up', 'lake', 'log', 'river'] },
  'feather':              { strong: ['feather'], weak: ['bird', 'wing', 'pigeon', 'nest', 'flying', 'flight'] },
  'four-leaf-clover':     { strong: ['clover', 'four-leaf'], weak: ['luck', 'lucky', 'grass', 'fortune', 'wish'] },
  'gummy-bear':           { strong: ['gummy'], weak: ['candy', 'sweets', 'corner shop', 'sour', 'pick and mix'] },
  'ice-cream-cone':       { strong: ['ice cream', 'ice-cream', 'icecream', 'gelato'], weak: ['cone', 'summer', 'melting', 'scoop', 'van', 'shop'] },
  'key':                  { strong: ['key', 'keys'], weak: ['door', 'lock', 'moving', 'apartment', 'flat', 'my own place', 'hallway'] },
  'ladybug':              { strong: ['ladybug', 'ladybird'], weak: ['bug', 'beetle', 'insect', 'garden', 'crawl'] },
  'lemon':                { strong: ['lemon'], weak: ['lemonade', 'sour', 'citrus', 'tea'] },
  'lollipop':             { strong: ['lollipop', 'lolly'], weak: ['candy', 'sweet', 'dentist', 'fair', 'shop'] },
  'maple-leaf':           { strong: ['maple'], weak: ['leaves', 'autumn', 'fall', 'syrup', 'raking', 'canada'] },
  'monarch-butterfly':    { strong: ['butterfl', 'monarch'], weak: ['moth', 'wings', 'garden', 'migration', 'summer'] },
  'oak-leaf':             { strong: ['oak'], weak: ['leaves', 'forest', 'woods', 'autumn', 'fall', 'tree'] },
  'orange-slice':         { strong: ['orange'], weak: ['citrus', 'juice', 'breakfast', 'segments', 'halftime'] },
  'pinecone':             { strong: ['pinecone', 'pine cone'], weak: ['pine', 'forest', 'woods', 'camping', 'cabin', 'hike', 'hiking', 'trail', 'christmas'] },
  'pizza-slice':          { strong: ['pizza'], weak: ['pepperoni', 'takeout', 'takeaway', 'delivery', 'friday'] },
  'poker-chip':           { strong: ['poker', 'casino'], weak: ['cards', 'bet', 'game night', 'vegas', 'chips'] },
  'pretzel':              { strong: ['pretzel'], weak: ['bakery', 'bread', 'dough', 'salt', 'baking', 'oven', 'loaf'] },
  'quartz-crystal':       { strong: ['quartz', 'crystal'], weak: ['gem', 'mineral', 'geode', 'museum', 'collection'] },
  'river-rock':           { strong: ['pebble', 'river rock'], weak: ['rock', 'stone', 'river', 'stream', 'creek', 'brook', 'skipping', 'lake'] },
  'sand-dollar':          { strong: ['sand dollar'], weak: ['beach', 'sand', 'shore', 'tide', 'ocean'] },
  'seashell':             { strong: ['seashell', 'sea shell'], weak: ['shell', 'beach', 'ocean', 'sea', 'shore', 'holiday', 'coast'] },
  'snail-shell':          { strong: ['snail'], weak: ['slug', 'garden', 'after the rain', 'slow', 'damp'] },
  'starfish':             { strong: ['starfish', 'sea star'], weak: ['tide pool', 'ocean', 'beach', 'star'] },
  'strawberry':           { strong: ['strawberr'], weak: ['berries', 'picking', 'jam', 'shortcake', 'summer', 'garden'] },
  'thread':               { strong: ['thread', 'spool'], weak: ['sewing', 'needle', 'mending', 'knitting', 'stitch', 'grandmother'] },
  'twig':                 { strong: ['twig'], weak: ['stick', 'branch', 'kindling', 'fetch', 'walk', 'forest', 'woods', 'tree'] },
  'watermelon-slice':     { strong: ['watermelon'], weak: ['melon', 'picnic', 'barbecue', 'bbq', 'summer', 'seeds'] },
  'wishbone':             { strong: ['wishbone'], weak: ['thanksgiving', 'turkey', 'roast', 'luck', 'wish', 'dinner'] },
};

let catalogue = [];          // every usable item, in index order
let byId = new Map();

/**
 * Read the generated index once. Items without an entry in TAGS can still be
 * filler -- they simply never match a memory -- so adding a photograph to the
 * library is a one-line change and tagging it is optional.
 */
export async function loadItems() {
  if (catalogue.length) return catalogue;
  const index = await fetch('/images/items/index.json').then((r) => r.json()).catch(() => []);
  catalogue = index
    .filter((it) => !RESERVED.has(it.id))
    .map((it) => ({ ...it, ratio: it.w / it.h, tags: TAGS[it.id] || null }));
  byId = new Map(catalogue.map((it) => [it.id, it]));
  return catalogue;
}

export const itemById = (id) => byId.get(id) || null;
export const itemCount = () => catalogue.length;

// ------------------------------------------------------------- matching ---

/** Everything a memory says about itself, as one lowercase haystack. */
function words(memory) {
  const bits = [memory.title, memory.text, memory.summary];
  if (Array.isArray(memory.sources)) {
    for (const s of memory.sources) if (typeof s?.text === 'string') bits.push(s.text);
  }
  return bits.filter(Boolean).join(' ').toLowerCase();
}

/**
 * The object this memory is, or null if the library has nothing close.
 *
 * `used` lets the caller keep the page varied: among candidates that tie at the
 * top score, one that is not already on the wall wins. Ties below that are
 * broken by the memory's own id, so a marble-or-cookie decision is the same on
 * every load and for every visitor -- the same promise the marble colours make.
 */
export function matchItem(memory, used = new Set()) {
  const hay = words(memory);
  if (!hay) return null;

  let best = null;
  let bestScore = 0;
  for (const item of catalogue) {
    if (!item.tags) continue;
    let score = 0;
    for (const t of item.tags.strong) if (hay.includes(t)) score += STRONG;
    for (const t of item.tags.weak) if (hay.includes(t)) score += WEAK;
    if (score < THRESHOLD) continue;

    // fresh beats repeated; then a stable coin-flip on the memory's own id
    const fresher = !used.has(item.id) && used.has(best?.id);
    const luckier = mulberry32(hashText(memory.id + item.id))() > 0.5;
    if (score > bestScore || (score === bestScore && (fresher || (!used.has(item.id) === !used.has(best?.id) && luckier)))) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

// --------------------------------------------------------------- filler ---

/**
 * The object in a cell no memory took. Seeded by the cell's own coordinates
 * rather than by an index, so adding a memory in one corner does not reshuffle
 * the whole page underneath it.
 *
 * Filler lies at any angle and is inert in every sense -- no pointer, no focus,
 * no hover. What tells a memory apart from the junk is not what it is a picture
 * of, it is that it answers when you touch it.
 */
export function fillerItem(col, row, salt = 0) {
  const rng = mulberry32(((col + 1) * 73856093) ^ ((row + 1) * 19349663) ^ (salt * 83492791));
  const item = catalogue[Math.floor(rng() * catalogue.length)];
  if (!item) return null;
  return {
    item,
    turn: (rng() - 0.5) * 260,
    // well under the cell on purpose: what is left over is the jitter, and
    // without a decent margin the page snaps back into rows you can read
    scale: 0.42 + rng() * 0.38,
    jx: rng(),
    jy: rng(),
    flip: rng() < 0.5,
  };
}

// -------------------------------------------------------------- geometry ---

/**
 * How big the picture may be drawn, given a square box it must stay inside once
 * it has been turned. An unrotated 1:1 fit is not enough: a cut-out spun 45deg
 * sweeps up to sqrt(2) times its own width, which is exactly how objects end up
 * touching on a page whose whole rule is that nothing touches.
 */
export function fitRotated(item, box, turnDeg) {
  const long = 1;
  const short = Math.min(item.w, item.h) / Math.max(item.w, item.h);
  const portrait = item.h >= item.w;
  const w = portrait ? short : long;
  const h = portrait ? long : short;
  const a = (turnDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const span = Math.max(w * c + h * s, w * s + h * c);
  const k = box / span;
  return { w: w * k, h: h * k };
}

export const itemSrc = (item) => `/images/items/${item.id}.png`;

/** FNV-1a, so a tie-break can be seeded from a string id. */
function hashText(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
