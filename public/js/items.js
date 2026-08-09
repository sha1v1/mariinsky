// The objects on the page.
//
// Every object lying on the paper is a memory, and every memory is a
// photographic cut-out out of `public/images/items/`, built from the asset
// library by `scripts/items.mjs`. Nothing on the page is filler any more: if
// you can see it, there is a record behind it and clicking it opens something.
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
//
// On top of the score sits a **spread** rule, which matters more the fuller the
// wall gets: a hundred memories mentioning a birthday would otherwise be a
// hundred identical slices of cake. Among candidates within a point of the best
// score, the one that lands furthest from another copy of itself -- and from
// anything in the same family, so two kinds of leaf do not end up side by side
// either -- wins. Repetition is allowed; repetition *in the same glance* is
// what makes a page of objects read as wallpaper.

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
  'button':               { strong: ['button'], weak: ['sewing', 'cardigan', 'coat', 'shirt', 'jar', 'ordinary', 'nothing happened', 'plain', 'tuesday'] },
  'cherry':               { strong: ['cherry', 'cherries'], weak: ['blossom', 'pie', 'orchard', 'stem'] },
  'chestnut':             { strong: ['chestnut', 'conker'], weak: ['roast', 'autumn', 'fall'] },
  'chocolate-chip-cookie': { strong: ['cookie', 'biscuit'], weak: ['baking', 'bake', 'dough', 'oven', 'chocolate', 'kitchen'] },
  'coin':                 { strong: ['coin', 'penny', 'pennies', 'quarter'], weak: ['money', 'change', 'pocket', 'allowance', 'wishing well', 'shop', 'saved up'] },
  'coral':                { strong: ['coral', 'reef'], weak: ['snorkel', 'diving', 'tropical', 'ocean'] },
  'crayon':               { strong: ['crayon'], weak: ['colouring', 'coloring', 'drawing', 'drew', 'kindergarten', 'school'] },
  'cupcake':              { strong: ['cupcake'], weak: ['frosting', 'icing', 'sprinkles', 'bake sale'] },
  'daisy':                { strong: ['daisy', 'daisies'], weak: ['flower', 'meadow', 'field', 'spring', 'chain', 'garden', 'wedding', 'bouquet'] },
  'dandelion':            { strong: ['dandelion'], weak: ['wish', 'blowing', 'seeds', 'lawn', 'weeds', 'puff', 'sunny', 'afternoon'] },
  'donut':                { strong: ['donut', 'doughnut'], weak: ['glazed', 'sprinkles', 'coffee'] },
  'driftwood':            { strong: ['driftwood'], weak: ['beach', 'shore', 'tide', 'washed up', 'lake', 'log', 'river'] },
  'feather':              { strong: ['feather'], weak: ['bird', 'wing', 'pigeon', 'nest', 'flying', 'flight'] },
  'four-leaf-clover':     { strong: ['clover', 'four-leaf'], weak: ['luck', 'lucky', 'grass', 'fortune', 'wish'] },
  'gummy-bear':           { strong: ['gummy'], weak: ['candy', 'sweets', 'corner shop', 'sour', 'pick and mix'] },
  'ice-cream-cone':       { strong: ['ice cream', 'ice-cream', 'icecream', 'gelato'], weak: ['cone', 'summer', 'melting', 'scoop', 'van', 'shop'] },
  'key':                  { strong: ['key', 'keys'], weak: ['door', 'lock', 'moving', 'apartment', 'flat', 'my own place', 'hallway', 'house', 'porch'] },
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
  'river-rock':           { strong: ['pebble', 'river rock'], weak: ['rock', 'stone', 'river', 'stream', 'creek', 'brook', 'skipping', 'lake', 'still', 'water'] },
  'sand-dollar':          { strong: ['sand dollar'], weak: ['beach', 'sand', 'shore', 'tide', 'ocean'] },
  'seashell':             { strong: ['seashell', 'sea shell'], weak: ['shell', 'beach', 'ocean', 'sea', 'shore', 'holiday', 'coast'] },
  'snail-shell':          { strong: ['snail'], weak: ['slug', 'garden', 'after the rain', 'slow', 'damp'] },
  'starfish':             { strong: ['starfish', 'sea star'], weak: ['tide pool', 'ocean', 'beach', 'star'] },
  'strawberry':           { strong: ['strawberr'], weak: ['berries', 'picking', 'jam', 'shortcake', 'summer', 'garden'] },
  'thread':               { strong: ['thread', 'spool'], weak: ['sewing', 'needle', 'mending', 'knitting', 'stitch', 'grandmother'] },
  'twig':                 { strong: ['twig'], weak: ['stick', 'branch', 'kindling', 'fetch', 'walk', 'forest', 'woods', 'tree', 'dog'] },
  'watermelon-slice':     { strong: ['watermelon'], weak: ['melon', 'picnic', 'barbecue', 'bbq', 'summer', 'seeds'] },
  'wishbone':             { strong: ['wishbone'], weak: ['thanksgiving', 'turkey', 'roast', 'luck', 'wish', 'dinner'] },
};

/**
 * Objects that read as "the same kind of thing" at a glance. Two of these near
 * each other is the repetition the spread rule is really guarding against --
 * nobody notices a cookie beside a key, everybody notices a maple leaf beside
 * an oak leaf. Anything not listed is its own family.
 */
const FAMILIES = {
  leaf:   ['maple-leaf', 'oak-leaf'],
  shore:  ['seashell', 'snail-shell', 'sand-dollar', 'starfish', 'coral', 'driftwood'],
  sweet:  ['birthday-cake-slice', 'cupcake', 'donut', 'chocolate-chip-cookie', 'lollipop', 'gummy-bear', 'ice-cream-cone'],
  fruit:  ['cherry', 'blueberry', 'strawberry', 'lemon', 'orange-slice', 'watermelon-slice'],
  forest: ['twig', 'pinecone', 'acorn', 'chestnut'],
  disc:   ['coin', 'poker-chip', 'button'],
  bloom:  ['daisy', 'dandelion', 'four-leaf-clover'],
  stone:  ['river-rock', 'quartz-crystal'],
  bug:    ['ladybug', 'monarch-butterfly'],
};
const FAMILY_OF = new Map();
for (const [family, ids] of Object.entries(FAMILIES)) for (const id of ids) FAMILY_OF.set(id, family);

let catalogue = [];          // every usable item, in index order
let byId = new Map();

/**
 * Read the generated index once. Items without an entry in TAGS never match a
 * memory, so adding a photograph to the library is a one-line change and
 * tagging it is what makes it reachable.
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
 * Rank every object this memory could be, best first. Empty means the library
 * has nothing close and the memory stays a marble.
 */
function candidates(memory) {
  const hay = words(memory);
  if (!hay) return [];
  const out = [];
  for (const item of catalogue) {
    if (!item.tags) continue;
    let score = 0;
    for (const t of item.tags.strong) if (hay.includes(t)) score += STRONG;
    for (const t of item.tags.weak) if (hay.includes(t)) score += WEAK;
    if (score >= THRESHOLD) out.push({ item, score });
  }
  return out.sort((a, b) => b.score - a.score
    || hashText(memory.id + a.item.id) - hashText(memory.id + b.item.id));
}

/**
 * Give every memory on the page an object, or a marble if nothing fits.
 *
 * `spots` is the placed position of each memory, in page pixels and in the same
 * order -- the whole point of doing this in one pass rather than per memory is
 * that the choice depends on what is already lying nearby. Among candidates
 * within `NEAR_SCORE` of the memory's best, the one that lands furthest from
 * another copy of itself (and from its own family) wins, so a wall full of
 * birthdays is still a wall you can hunt through.
 *
 * Returns an array of items-or-null, aligned with the input.
 */
const NEAR_SCORE = 1;
const FAMILY_WEIGHT = 0.55;   // sharing a family is most of a clash, not all of it

export function assignItems(memories, spots) {
  const placed = [];   // { id, family, x, y }
  return memories.map((memory, i) => {
    const ranked = candidates(memory);
    if (!ranked.length) return null;

    const top = ranked[0].score;
    const near = ranked.filter((c) => c.score >= top - NEAR_SCORE);
    const here = spots[i] || { x: 0, y: 0 };

    let best = near[0].item;
    let bestRoom = -1;
    for (const { item } of near) {
      const family = FAMILY_OF.get(item.id) || item.id;
      let room = Infinity;
      for (const p of placed) {
        const same = p.id === item.id ? 1 : p.family === family ? FAMILY_WEIGHT : 0;
        if (!same) continue;
        const d = Math.hypot(p.x - here.x, p.y - here.y) / same;
        if (d < room) room = d;
      }
      if (room > bestRoom) { bestRoom = room; best = item; }
    }

    placed.push({ id: best.id, family: FAMILY_OF.get(best.id) || best.id, x: here.x, y: here.y });
    return best;
  });
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
