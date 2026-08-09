// The inside of a marble. Six different makes, picked deterministically from
// the memory's id, so the collection looks like a real jar — the kind where no
// two are quite the same — rather than one design in different colours.
//
// These are SVG rather than CSS pseudo-elements: two pseudos only ever get you
// two shapes, and a corkscrew is not a cat's-eye with the numbers changed.

import { mulberry32, range } from './rng.js';
import { hashId } from './marble.js';

export const SWIRLS = ['catseye', 'ribbon', 'corkscrew', 'wisp', 'bands', 'petal'];

/** Which make of marble this memory is. Stable for the life of the memory. */
export function swirlKind(id) {
  const rng = mulberry32(hashId(id) ^ 0x1d872b41);
  return SWIRLS[Math.floor(rng() * SWIRLS.length)];
}

const C = 'style="fill:var(--marble)"';
const CS = 'style="stroke:var(--marble)"';
const LIGHT = 'style="fill:#fff" opacity=".5"';

/**
 * Returns the interior as SVG markup on a 100×100 field. Everything stays
 * inside r≈44 so the glass edge is never touched by the colour.
 */
export function swirlSvg(id) {
  const kind = swirlKind(id);
  const rng = mulberry32(hashId(id) ^ 0x77aa33);
  const a = Math.round(range(rng, 0, 180));
  const g = (body) => `<svg class="marble-swirl" viewBox="0 0 100 100" aria-hidden="true">${body}</svg>`;

  if (kind === 'catseye') {
    const w = range(rng, 10, 16).toFixed(1);
    return g(`
      <ellipse cx="50" cy="50" rx="43" ry="${w}" transform="rotate(${a} 50 50)" ${C}/>
      <ellipse cx="50" cy="50" rx="34" ry="${(w * 0.34).toFixed(1)}" transform="rotate(${a + 57} 50 50)" ${LIGHT}/>`);
  }

  if (kind === 'ribbon') {
    // one wide fold of colour, like a sweet wrapper caught in the glass
    return g(`
      <g transform="rotate(${a} 50 50)">
        <path d="M10 60 C28 26 72 74 90 40" fill="none" stroke-width="17" stroke-linecap="round" ${CS}/>
        <path d="M14 57 C30 30 70 70 86 43" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".45"/>
      </g>`);
  }

  if (kind === 'corkscrew') {
    const t = range(rng, 6, 9).toFixed(1);
    return g(`
      <g transform="rotate(${a} 50 50)">
        <path d="M16 50 C26 22 74 22 84 50" fill="none" stroke-width="${t}" stroke-linecap="round" ${CS}/>
        <path d="M16 50 C26 78 74 78 84 50" fill="none" stroke-width="${t}" stroke-linecap="round" ${CS} opacity=".72"/>
        <path d="M24 50 C32 36 68 36 76 50" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".4"/>
      </g>`);
  }

  if (kind === 'wisp') {
    // barely there — a breath of colour suspended off-centre
    const x = range(rng, 38, 58).toFixed(0);
    const y = range(rng, 40, 60).toFixed(0);
    return g(`
      <g transform="rotate(${a} 50 50)">
        <ellipse cx="${x}" cy="${y}" rx="30" ry="20" ${C} opacity=".72"/>
        <ellipse cx="${Number(x) + 12}" cy="${Number(y) - 11}" rx="17" ry="12" ${C} opacity=".5"/>
        <ellipse cx="${Number(x) - 13}" cy="${Number(y) + 9}" rx="13" ry="9" ${C} opacity=".42"/>
        <ellipse cx="${Number(x) - 4}" cy="${Number(y) - 6}" rx="9" ry="5" ${LIGHT}/>
      </g>`);
  }

  if (kind === 'bands') {
    return g(`
      <g transform="rotate(${a} 50 50)">
        <path d="M8 38 C34 26 66 50 92 38" fill="none" stroke-width="9" stroke-linecap="round" ${CS}/>
        <path d="M8 52 C34 40 66 64 92 52" fill="none" stroke-width="13" stroke-linecap="round" ${CS}/>
        <path d="M12 66 C36 56 64 76 88 66" fill="none" stroke-width="6" stroke-linecap="round" ${CS} opacity=".6"/>
        <path d="M14 49 C36 39 64 61 86 49" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".4"/>
      </g>`);
  }

  // petal: four narrow leaves through the middle
  return g(`
    <g transform="rotate(${a} 50 50)">
      <ellipse cx="50" cy="50" rx="40" ry="9" ${C}/>
      <ellipse cx="50" cy="50" rx="40" ry="9" transform="rotate(45 50 50)" ${C} opacity=".82"/>
      <ellipse cx="50" cy="50" rx="40" ry="9" transform="rotate(90 50 50)" ${C} opacity=".7"/>
      <ellipse cx="50" cy="50" rx="40" ry="9" transform="rotate(135 50 50)" ${C} opacity=".82"/>
      <circle cx="50" cy="50" r="7" ${LIGHT}/>
    </g>`);
}
