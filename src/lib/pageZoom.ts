/**
 * The page's zoom arithmetic, pure so it can be tested without the DOM (ZoomFrame draws it). The page is always laid
 * out at its own width; only the scale and the phone reflow change with the window.
 */

/** Letter page width at 96dpi; matches `.doc-page` max-width and the PDF. */
export const PAGE_W = 816;
/** Below this window width the page reflows for phones (globals.css: max-width 639px), so it is never scaled. */
const REFLOW_W = 640;
/** The space kept between a fitted page and the canvas edges (24px each side). */
const FIT_GUTTER_PX = 48;

/** Whether a window this wide reflows the page for a phone instead of scaling it. An unmeasured window (0) does not. */
export function reflowsAt(viewportPx: number): boolean {
  return viewportPx > 0 && viewportPx < REFLOW_W;
}

/** The scale "Fit" gives a canvas this wide: the page shrinks to the column, never grows past 100%. */
export function fitScale(columnPx: number): number {
  return columnPx > 0 ? Math.min(1, (columnPx - FIT_GUTTER_PX) / PAGE_W) : 1;
}

/**
 * The scale the page is drawn at for a zoom choice (1 = 100%, 0 = Fit) in a canvas this wide. A page the user zoomed
 * to 100% or more stays that size and scrolls, so the text never re-wraps at a narrow window.
 */
export function pageScale(zoom: number, columnPx: number): number {
  return zoom > 0 ? zoom : fitScale(columnPx);
}
