/**
 * Cookie holding the desktop sidebar's collapsed choice ("1" = collapsed). The (app) layout reads it on the
 * server so the shell renders right from the first paint; AppShell writes it on toggle.
 * A plain module (not the client AppShell file), so the server layout gets the real string.
 */
export const SIDEBAR_COOKIE = "jawb_sidebar_collapsed";

/**
 * Cookie holding the desktop sidebar's width in px (a plain number). The (app) layout reads it on the server so the
 * first paint has the right width; the rail's drag handle writes it when a drag or a keyboard step ends.
 */
export const SIDEBAR_WIDTH_COOKIE = "jawb_sidebar_width";
export const SIDEBAR_WIDTH_DEFAULT = 248;
export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 360;
/** How far an arrow key moves the rail's edge. */
export const SIDEBAR_WIDTH_STEP = 8;

/** A width in px, rounded and kept between the min and max. A non-number (NaN, Infinity) gives the default. Pure. */
export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(px)));
}

/** The width from a cookie value: a number, clamped. Missing, empty or not a number gives the default. Pure. */
export function parseSidebarWidth(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === "") return SIDEBAR_WIDTH_DEFAULT;
  return clampSidebarWidth(Number(raw));
}
