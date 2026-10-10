/**
 * Top of `el` inside `scroller`'s scrollable content, from offsetTop so CSS
 * transforms are ignored (the zoom animation briefly scales the grid, which
 * would throw getBoundingClientRect-based positions off by thousands of px).
 */
export function offsetWithin(el: HTMLElement, scroller: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== scroller) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  if (node === scroller) return top;
  // The scroller isn't an offsetParent (not positioned): fall back to layout boxes.
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
}
