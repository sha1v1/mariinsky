// The rest of the i-spy page.
//
// A spread out of an i-spy book is *dense*: the whole page is objects, edge to
// edge, and the thing you are hunting for is hidden among them. A wall with
// eleven memories on it is not that -- it is eleven marbles floating in a lot of
// paper, and it reads as an empty app rather than as a page.
//
// So the cells the memories did not take get a trinket instead. They are flat,
// they are not clickable, they are not in the tab order, and they are never
// mistaken for a memory: a memory is a sphere with a swirl inside it and a name
// that wraps around it, and none of these are round.
//
// Every trinket is drawn on a 100x100 grid so one placement routine can size
// them all, and every one is deterministic in the cell it sits in -- the same
// screen gives you the same page twice, which is the whole promise of "mine is
// the green one near the top".

import { mulberry32 } from './rng.js';

/* Each entry is [name, markup]. Colours are literal rather than themed: an
   i-spy page is a jumble of real objects, and a palette applied across all of
   them would turn the jumble into a diagram. */
const TRINKETS = [
  ['paperclip', `<path d="M32 78V32a16 16 0 0 1 32 0v46a26 26 0 0 1-52 0V30" fill="none" stroke="#b9c0c9" stroke-width="7" stroke-linecap="round"/>`],
  ['button', `<circle cx="50" cy="50" r="34" fill="#e34b52"/><circle cx="50" cy="50" r="34" fill="none" stroke="#b8353c" stroke-width="3"/><circle cx="40" cy="42" r="5.5" fill="#8f2229"/><circle cx="60" cy="42" r="5.5" fill="#8f2229"/><circle cx="40" cy="60" r="5.5" fill="#8f2229"/><circle cx="60" cy="60" r="5.5" fill="#8f2229"/>`],
  ['die', `<rect x="18" y="18" width="64" height="64" rx="14" fill="#f7f5ef" stroke="#d6d1c4" stroke-width="3"/><circle cx="36" cy="36" r="6" fill="#26242c"/><circle cx="64" cy="36" r="6" fill="#26242c"/><circle cx="50" cy="50" r="6" fill="#26242c"/><circle cx="36" cy="64" r="6" fill="#26242c"/><circle cx="64" cy="64" r="6" fill="#26242c"/>`],
  ['key', `<circle cx="30" cy="42" r="18" fill="none" stroke="#c9a03c" stroke-width="9"/><path d="M44 50l38 26" stroke="#c9a03c" stroke-width="9" stroke-linecap="round"/><path d="M64 62l-8 12M74 69l-7 11" stroke="#c9a03c" stroke-width="8" stroke-linecap="round"/>`],
  ['pin', `<path d="M26 74c-14-14-14-38 0-48 12-9 22 3 22 14v34c0 8 6 12 12 12s12-4 12-13V32" fill="none" stroke="#aab2bc" stroke-width="7" stroke-linecap="round"/><circle cx="72" cy="26" r="8" fill="#aab2bc"/>`],
  ['star', `<path d="M50 14l11 24 26 3-19 18 5 26-23-13-23 13 5-26-19-18 26-3z" fill="#f2c53d" stroke="#d3a521" stroke-width="3" stroke-linejoin="round"/>`],
  ['leaf', `<path d="M20 80C22 40 48 18 82 18c2 36-20 62-62 62z" fill="#6f9c4a"/><path d="M76 24C56 40 38 58 24 78" fill="none" stroke="#4f7533" stroke-width="4" stroke-linecap="round"/>`],
  ['coin', `<circle cx="50" cy="50" r="33" fill="#cbb46a"/><circle cx="50" cy="50" r="33" fill="none" stroke="#a3893f" stroke-width="4"/><circle cx="50" cy="50" r="21" fill="none" stroke="#a3893f" stroke-width="3"/>`],
  ['tack', `<path d="M38 20h24l-4 26 16 14v6H26v-6l16-14z" fill="#d0453f"/><path d="M50 66v20" stroke="#8c8c92" stroke-width="5" stroke-linecap="round"/>`],
  ['pencil', `<path d="M22 78l6-18 44-44 12 12-44 44z" fill="#f0c23a" stroke="#c99a1e" stroke-width="3" stroke-linejoin="round"/><path d="M22 78l6-18 8 8z" fill="#e8e3d5"/><path d="M22 78l3-9 6 6z" fill="#2b2a30"/><path d="M64 24l12 12" stroke="#c99a1e" stroke-width="3"/>`],
  ['eraser', `<rect x="18" y="36" width="64" height="30" rx="6" fill="#f39ab4" transform="rotate(-12 50 50)"/><rect x="18" y="36" width="64" height="30" rx="6" fill="none" stroke="#d16f8e" stroke-width="3" transform="rotate(-12 50 50)"/>`],
  ['bandaid', `<rect x="10" y="38" width="80" height="26" rx="13" fill="#e7c9a4" transform="rotate(-20 50 50)"/><rect x="10" y="38" width="80" height="26" rx="13" fill="none" stroke="#c9a67d" stroke-width="3" transform="rotate(-20 50 50)"/><rect x="35" y="39" width="30" height="24" rx="4" fill="#f4e3ce" transform="rotate(-20 50 50)"/>`],
  ['jack', `<g stroke="#8d949d" stroke-width="9" stroke-linecap="round"><path d="M50 18v64M22 34l56 32M78 34L22 66"/></g><circle cx="50" cy="18" r="7" fill="#8d949d"/><circle cx="50" cy="82" r="7" fill="#8d949d"/>`],
  ['domino', `<rect x="30" y="12" width="40" height="76" rx="6" fill="#f8f6f0" stroke="#d5cfc0" stroke-width="3"/><path d="M32 50h36" stroke="#d5cfc0" stroke-width="3"/><circle cx="50" cy="30" r="5" fill="#26242c"/><circle cx="42" cy="62" r="5" fill="#26242c"/><circle cx="58" cy="72" r="5" fill="#26242c"/>`],
  ['shell', `<path d="M50 82C26 82 10 62 14 42c4-18 20-26 36-26s32 8 36 26c4 20-12 40-36 40z" fill="#f6d9cc" stroke="#dcb09c" stroke-width="3"/><g fill="none" stroke="#dcb09c" stroke-width="3"><path d="M50 82V18M50 82L24 34M50 82l26-48M50 82L36 24M50 82l14-58"/></g>`],
  ['acorn', `<path d="M32 46h36c0 22-8 36-18 36s-18-14-18-36z" fill="#b07a3e"/><path d="M26 34c0-8 10-14 24-14s24 6 24 14c0 6-10 10-24 10s-24-4-24-10z" fill="#7c5228"/><path d="M50 20v-8" stroke="#7c5228" stroke-width="5" stroke-linecap="round"/>`],
  ['clothespin', `<path d="M40 14h20v72H40z" fill="#e3c98f"/><path d="M40 14h20v72H40z" fill="none" stroke="#c2a464" stroke-width="3"/><path d="M32 44h36" stroke="#9aa1aa" stroke-width="6"/><path d="M50 14v72" stroke="#c2a464" stroke-width="2.5"/>`],
  ['gummy', `<path d="M50 16c6 0 9 4 9 8 8 0 13 5 13 12 0 5-3 8-6 10 5 3 8 9 8 16 0 11-10 20-24 20s-24-9-24-20c0-7 3-13 8-16-3-2-6-5-6-10 0-7 5-12 13-12 0-4 3-8 9-8z" fill="#5bb04a"/><circle cx="43" cy="42" r="3" fill="#2f6b25"/><circle cx="57" cy="42" r="3" fill="#2f6b25"/>`],
  ['apple', `<path d="M50 30c8-8 26-8 32 6 6 16-4 46-18 50-6 2-10-2-14-2s-8 4-14 2C22 82 12 52 18 36c6-14 24-14 32-6z" fill="#d8453c"/><path d="M50 30c0-8 2-14 8-18" fill="none" stroke="#6b4a2a" stroke-width="5" stroke-linecap="round"/><path d="M52 16c8-6 16-4 18 0-4 6-12 8-18 0z" fill="#5f9440"/>`],
  ['chip', `<circle cx="50" cy="50" r="34" fill="#d2453f"/><circle cx="50" cy="50" r="34" fill="none" stroke="#a52f2a" stroke-width="3"/><circle cx="50" cy="50" r="20" fill="#f7f4ee"/><g fill="#f7f4ee"><rect x="46" y="12" width="8" height="12" rx="2"/><rect x="46" y="76" width="8" height="12" rx="2"/><rect x="12" y="46" width="12" height="8" rx="2"/><rect x="76" y="46" width="12" height="8" rx="2"/></g>`],
  ['bead', `<circle cx="50" cy="50" r="30" fill="#7b6bd0"/><circle cx="50" cy="50" r="9" fill="#efeaf8"/><ellipse cx="39" cy="38" rx="8" ry="5" fill="#fff" opacity=".55" transform="rotate(-30 39 38)"/>`],
  ['ribbon', `<path d="M50 50c-14-18-34-18-34-4 0 12 20 14 34 4zM50 50c14-18 34-18 34-4 0 12-20 14-34 4z" fill="#e56aa0"/><path d="M50 50l-10 34M50 50l12 32" fill="none" stroke="#e56aa0" stroke-width="8" stroke-linecap="round"/><circle cx="50" cy="50" r="7" fill="#c94b83"/>`],
  ['screw', `<path d="M50 16l10 10-10 8-10-8z" fill="#9aa1aa"/><path d="M42 30h16l-4 54-4 8-4-8z" fill="#9aa1aa"/><g stroke="#7b828b" stroke-width="3"><path d="M42 42h16M42 54h16M42 66h16"/></g>`],
  ['peanut', `<path d="M34 20c12 0 18 8 18 16s-6 12-6 18 8 8 8 16-8 12-18 12-20-10-20-24 6-14 6-20-2-18 12-18z" fill="#d1a45f" transform="rotate(28 50 50)"/><g fill="none" stroke="#a9803f" stroke-width="2.5" transform="rotate(28 50 50)"><path d="M28 34c8 4 16 4 22 0M26 62c8 4 18 4 24 0"/></g>`],
];

/**
 * Which trinket goes in a cell, and how it sits there. Seeded by the cell's own
 * coordinates rather than by its index, so adding a memory in the corner does
 * not reshuffle the whole page underneath it.
 */
export function trinketFor(col, row, salt = 0) {
  const rng = mulberry32(((col + 1) * 73856093) ^ ((row + 1) * 19349663) ^ (salt * 83492791));
  const [name, art] = TRINKETS[Math.floor(rng() * TRINKETS.length)];
  return {
    name,
    art,
    turn: (rng() - 0.5) * 260,          // trinkets lie at any angle; marbles do not
    scale: 0.62 + rng() * 0.5,
    jx: rng(),
    jy: rng(),
    flip: rng() < 0.5,
  };
}

/** One trinket, ready to drop on the page. Inert by construction. */
export function trinketEl(t, size, x, y) {
  const el = document.createElement('span');
  el.className = 'trinket';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `
    left:${x}px; top:${y}px;
    width:${size}px; height:${size}px;
    --turn:${t.turn.toFixed(1)}deg;
    --flip:${t.flip ? -1 : 1};`;
  el.innerHTML = `<svg viewBox="0 0 100 100">${t.art}</svg>`;
  return el;
}

export const TRINKET_COUNT = TRINKETS.length;
