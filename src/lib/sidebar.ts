/**
 * Cookie holding the desktop sidebar's collapsed choice ("1" = collapsed). The (app) layout reads it on the
 * server so the shell renders right from the first paint; AppShell writes it on toggle.
 * A plain module (not the client AppShell file), so the server layout gets the real string.
 */
export const SIDEBAR_COOKIE = "jawb_sidebar_collapsed";
