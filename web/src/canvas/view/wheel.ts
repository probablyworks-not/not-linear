/** Only consume gestures that can actually move content; pinch belongs to the scene. */
export function canScroll(el: HTMLElement, dx: number, dy: number): boolean {
  return (dy < 0 && el.scrollTop > 0) || (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1)
    || (dx < 0 && el.scrollLeft > 0) || (dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
}
export function cardWheel(el: HTMLElement, e: WheelEvent): void {
  if (!e.ctrlKey && canScroll(el, e.deltaX, e.deltaY)) e.stopPropagation();
}
