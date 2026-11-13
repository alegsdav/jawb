/**
 * The scheduling core of useAutosaveWithRetry, with no React or DOM, so it can be unit-tested and
 * reused (e.g. for one-off writes that must retry until they land).
 *
 * - `push(v)` remembers the latest value and saves it after `delay` ms (debounce); a newer push
 *   replaces a value that hasn't been handed to `save` yet.
 * - Saves run one at a time, in order, so an older value never lands after a newer one.
 * - A failed save keeps its value (unless something newer was pushed meanwhile) and retries by itself
 *   after `retryDelays` (3s, 10s, then every 30s by default). `flush()` / `retry()` save right away.
 * - Status: "unsaved" after a push, "saving" while writing, "saved" when nothing is left, "error"
 *   from the first failure until a save lands (no flicker back to "saving" while recovering).
 */

export type SaveState = "saved" | "saving" | "unsaved" | "error";

/** Automatic retries after a failed save, in ms (the last delay repeats). */
export const RETRY_DELAYS = [3000, 10000, 30000];

export type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export type SaveQueue<T> = {
  /** A new value to save after the debounce delay (`delay` overrides the default for this push). */
  push: (v: T, delay?: number) => void;
  /** Save whatever is pending now (also used for "Retry now"). */
  flush: () => void;
  /** True while a value is waiting or a save is running (e.g. to warn before closing the tab). */
  busy: () => boolean;
  /** True while a value is waiting to be saved (not yet handed to `save`). */
  hasPending: () => boolean;
  /** Resolves when every save started so far has settled. */
  idle: () => Promise<void>;
  /** Stop timers (call `flush()` first to keep pending edits). */
  dispose: () => void;
};

export function createSaveQueue<T>(opts: {
  save: (v: T) => Promise<unknown>;
  onStatus?: (s: SaveState) => void;
  delay?: number;
  retryDelays?: number[];
  timers?: Timers;
  onError?: (e: unknown) => void;
}): SaveQueue<T> {
  const timers = opts.timers ?? realTimers;
  const delays = opts.retryDelays?.length ? opts.retryDelays : RETRY_DELAYS;
  const status = (s: SaveState) => opts.onStatus?.(s);
  let pending: { v: T } | null = null;
  let inFlight = 0;
  let chain: Promise<unknown> = Promise.resolve();
  let timer: unknown = null;
  let retryTimer: unknown = null;
  let failures = 0;

  const clearTimers = () => {
    if (timer !== null) timers.clear(timer);
    if (retryTimer !== null) timers.clear(retryTimer);
    timer = retryTimer = null;
  };

  const flush = () => {
    clearTimers();
    const p = pending;
    if (!p) return;
    pending = null;
    inFlight++;
    status(failures ? "error" : "saving");
    chain = chain
      .catch(() => {})
      .then(() => opts.save(p.v))
      .then(
        () => {
          inFlight--;
          failures = 0;
          if (!pending && !inFlight) status("saved");
        },
        (e) => {
          inFlight--;
          opts.onError?.(e);
          // Keep the value so a retry, the next edit, navigation or tab close saves it.
          if (!pending) pending = p;
          status("error");
          if (retryTimer === null && timer === null) {
            const wait = delays[Math.min(failures, delays.length - 1)];
            failures++;
            retryTimer = timers.set(() => {
              retryTimer = null;
              flush();
            }, wait);
          }
        },
      );
  };

  return {
    push(v, delay = opts.delay ?? 800) {
      pending = { v };
      if (!failures) status("unsaved");
      if (timer !== null) timers.clear(timer);
      timer = timers.set(() => {
        timer = null;
        flush();
      }, delay);
    },
    flush,
    busy: () => !!pending || inFlight > 0,
    hasPending: () => !!pending,
    idle: () => chain.then(
      () => {},
      () => {},
    ),
    dispose: clearTimers,
  };
}
