// The rest of the i-spy page.
//
// A spread out of an i-spy book is *dense*: the whole page is objects, edge to
// edge, and the thing you are hunting for is hidden among them. A wall with
// eleven memories on it is not that -- it is eleven marbles floating in a lot of
// paper, and it reads as an empty app rather than as a page.
//
// So the cells the memories did not take get a trinket instead. They come out of
// the same photographic library the memories do (`items.js`), which is the whole
// reason the hunt works: when the junk is hand-drawn and the memories are
// photographs, finding a memory is not looking, it is spotting the odd one out.
//
// Trinkets are inert by construction -- no pointer, no focus, no hover, not in
// the tab order. That, and not what they are a picture of, is what tells them
// apart from a memory: a memory answers when you touch it.

import { fillerItem, fitRotated, itemSrc } from './items.js';

export { fillerItem as trinketFor };

/** One trinket, ready to drop on the page. `box` is the square it must stay in. */
export function trinketEl(t, box, x, y) {
  const el = document.createElement('span');
  el.className = 'trinket';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `left:${x}px; top:${y}px; width:${box}px; height:${box}px;`;

  const { w, h } = fitRotated(t.item, box, t.turn);
  const img = document.createElement('img');
  img.src = itemSrc(t.item);
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.draggable = false;
  img.style.cssText = `
    width:${w.toFixed(1)}px; height:${h.toFixed(1)}px;
    --turn:${t.turn.toFixed(1)}deg;
    --flip:${t.flip ? -1 : 1};`;
  el.appendChild(img);
  return el;
}
