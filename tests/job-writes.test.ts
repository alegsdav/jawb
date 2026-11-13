import { describe, expect, it } from "vitest";
import {
  bindPageLifecycle, createJobWrites, type DbError, type JobRowValues, type JobWriteBackend, type RowSaveState,
} from "@/lib/jobWrites";
import type { Timers } from "@/lib/saveQueue";
import type { Job } from "@/lib/types";

/** Manual clock: timers run only when the test advances time. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => {
      pending.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clear: (h) => void pending.delete(h as number),
  };
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      pending.delete(next[0]);
      now = next[1].at;
      next[1].fn();
      await settle();
    }
    now = until;
    await settle();
  };
  return { timers, advance, delays: () => [...pending.values()].map((p) => p.at - now) };
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

type Row = Record<string, unknown> & { id: string; updated_at: string };

/**
 * A stateful fake of the jobs table: conditional updates bump `updated_at` (like the trigger), and it
 * can fail, hold, or let "another device" write in between.
 */
function fakeDb(initial: Row[]) {
  let clock = 100;
  const rows = new Map(initial.map((r) => [r.id, { ...r }]));
  const log: string[] = [];
  const state = {
    fail: null as DbError | null,
    hold: null as Promise<void> | null,
  };
  const backend: JobWriteBackend = {
    async update(id, body, ifUpdatedAt) {
      log.push(`update ${id} ${JSON.stringify(body)} if=${ifUpdatedAt}`);
      if (state.hold) await state.hold;
      if (state.fail) return { error: state.fail, matched: false, updatedAt: null };
      const row = rows.get(id);
      if (!row || (ifUpdatedAt && row.updated_at !== ifUpdatedAt)) return { error: null, matched: false, updatedAt: null };
      Object.assign(row, body, { updated_at: `t${++clock}` });
      return { error: null, matched: true, updatedAt: row.updated_at };
    },
    async read(id) {
      log.push(`read ${id}`);
      if (state.fail) return { error: state.fail, row: null };
      const row = rows.get(id);
      return { error: null, row: row ? { ...row } : null };
    },
  };
  /** Another tab or device writes directly. */
  const external = (id: string, patch: Record<string, unknown>) => Object.assign(rows.get(id)!, patch, { updated_at: `t${++clock}` });
  return { rows, backend, log, state, external };
}

const job = (patch: Partial<Job> = {}): Job =>
  ({
    id: "j1",
    status: "to_apply",
    deadline: null,
    date_applied: null,
    follow_up_date: null,
    updated_at: "t1",
    ...patch,
  }) as Job;

function setup(initial: Row[] = [{ id: "j1", status: "to_apply", deadline: null, follow_up_date: null, updated_at: "t1" }]) {
  const db = fakeDb(initial);
  const clock = fakeTimers();
  const shown: { id: string; values: JobRowValues }[] = [];
  const gone: string[] = [];
  let states: ReadonlyMap<string, RowSaveState> = new Map();
  const w = createJobWrites({
    backend: db.backend,
    onRowValues: (id, values) => shown.push({ id, values }),
    onGone: (id) => gone.push(id),
    onStates: (s) => (states = s),
    timers: clock.timers,
  });
  return { db, clock, w, shown, gone, states: () => states };
}

describe("createJobWrites", () => {
  it("writes conditionally on updated_at and remembers the new version", async () => {
    const { db, w } = setup();
    w.queue(job(), { status: "applied" });
    await w.idle();
    w.queue(job({ status: "applied" }), { deadline: "2026-12-01" });
    await w.idle();
    expect(db.log).toEqual([
      'update j1 {"status":"applied"} if=t1',
      'update j1 {"deadline":"2026-12-01"} if=t101',
    ]);
    expect(db.rows.get("j1")).toMatchObject({ status: "applied", deadline: "2026-12-01", updated_at: "t102" });
    expect(w.busy()).toBe(false);
  });

  it("merges changes made while a write is in flight into the next write", async () => {
    const { db, w } = setup();
    let release!: () => void;
    db.state.hold = new Promise((r) => (release = r));
    w.queue(job(), { status: "applied" });
    w.queue(job(), { deadline: "2026-12-01" });
    w.queue(job(), { follow_up_date: "2026-12-05" });
    await settle();
    expect(db.log).toHaveLength(1);
    db.state.hold = null;
    release();
    await w.idle();
    expect(db.log).toEqual([
      'update j1 {"status":"applied"} if=t1',
      'update j1 {"deadline":"2026-12-01","follow_up_date":"2026-12-05"} if=t101',
    ]);
  });

  it("retries a failed write after 3s, 10s, then every 30s, keeping the values", async () => {
    const { db, clock, w, states } = setup();
    db.state.fail = { message: "upstream connect error or disconnect/reset before headers" };
    w.queue(job(), { status: "applied" });
    await settle();
    expect(states().get("j1")).toBe("error");
    expect(clock.delays()).toEqual([3000]);
    await clock.advance(3000);
    expect(clock.delays()).toEqual([10000]);
    await clock.advance(10000);
    expect(clock.delays()).toEqual([30000]);
    w.queue(job(), { deadline: "2026-12-01" }); // a newer edit while failing is merged, not lost
    await settle();
    db.state.fail = null;
    await clock.advance(30000);
    expect(db.rows.get("j1")).toMatchObject({ status: "applied", deadline: "2026-12-01" });
    expect(states().size).toBe(0);
    expect(clock.delays()).toEqual([]);
  });

  it("Discard puts back the saved values and drops the unsaved change", async () => {
    const { db, w, shown, states, clock } = setup();
    db.state.fail = { message: "Failed to fetch" };
    w.queue(job({ deadline: "2026-11-30" }), { deadline: "2026-12-01", status: "applied" });
    await settle();
    expect(w.discard("j1")).toBe(true);
    expect(shown).toEqual([{ id: "j1", values: { deadline: "2026-11-30", status: "to_apply" } }]);
    expect(states().size).toBe(0);
    expect(clock.delays()).toEqual([]);
    db.state.fail = null;
    w.flushAll();
    await w.idle();
    expect(db.log.filter((l) => l.startsWith("update"))).toHaveLength(1); // nothing re-sent after Discard
  });

  it("Discard is refused while the row is being written", async () => {
    const { db, w } = setup();
    db.state.hold = new Promise(() => {});
    w.queue(job(), { status: "applied" });
    await settle();
    expect(w.discard("j1")).toBe(false);
  });

  it("another device changed the row: re-read, show their fields, re-apply only ours", async () => {
    const { db, w, shown } = setup([{ id: "j1", status: "to_apply", deadline: null, follow_up_date: null, updated_at: "t1" }]);
    // The phone marks it Applied after this tab loaded the list.
    db.external("j1", { status: "applied", follow_up_date: "2026-11-23" });
    // The laptop (this tab, still at t1) sets the deadline.
    w.queue(job(), { deadline: "2026-12-01" });
    await w.idle();
    expect(db.log).toEqual([
      'update j1 {"deadline":"2026-12-01"} if=t1',
      "read j1",
      'update j1 {"deadline":"2026-12-01"} if=t101',
    ]);
    expect(db.rows.get("j1")).toMatchObject({ status: "applied", follow_up_date: "2026-11-23", deadline: "2026-12-01" });
    // Their values show here; this tab's own field isn't overwritten by the re-read.
    expect(shown).toEqual([{ id: "j1", values: { id: "j1", status: "applied", follow_up_date: "2026-11-23", updated_at: "t101" } }]);
    expect(w.version("j1")).toBe("t102");
  });

  it("after a conflict, Discard goes back to the other device's value", async () => {
    const { db, w, shown } = setup();
    db.external("j1", { deadline: "2026-11-20" });
    let calls = 0;
    const update = db.backend.update;
    db.backend.update = async (...args) => (++calls === 1 ? update(...args) : { error: { message: "Failed to fetch" }, matched: false, updatedAt: null });
    w.queue(job(), { deadline: "2026-12-01" });
    await w.idle();
    expect(w.discard("j1")).toBe(true);
    expect(shown.at(-1)).toEqual({ id: "j1", values: { deadline: "2026-11-20" } });
  });

  it("a job deleted elsewhere drops its writes", async () => {
    const { db, w, gone, states } = setup();
    db.rows.delete("j1");
    w.queue(job(), { status: "applied" });
    await w.idle();
    expect(gone).toEqual(["j1"]);
    expect(states().size).toBe(0);
    expect(w.busy()).toBe(false);
  });

  it("strips missing columns and retries at once", async () => {
    const db = fakeDb([{ id: "j1", status: "to_apply", updated_at: "t1" }]);
    const missing = new Set<string>();
    const update = db.backend.update;
    db.backend.update = async (id, body, v) =>
      "deadline" in body ? { error: { code: "PGRST204", message: "Could not find the 'deadline' column" }, matched: false, updatedAt: null } : update(id, body, v);
    const w = createJobWrites({
      backend: db.backend,
      strip: (p) => Object.fromEntries(Object.entries(p).filter(([k]) => !missing.has(k))),
      onMissingColumn: () => (missing.has("deadline") ? false : (missing.add("deadline"), true)),
      onRowValues: () => {},
    });
    w.queue(job(), { status: "applied", deadline: "2026-12-01" });
    await w.idle();
    expect(db.rows.get("j1")).toMatchObject({ status: "applied" });
    expect(w.busy()).toBe(false);
  });
});

describe("bindPageLifecycle (flush on hide)", () => {
  function env() {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    return { window: win, document: doc };
  }

  it("sends pending writes when the page is hidden, on pagehide and when back online", async () => {
    const { db, clock, w } = setup();
    const e = env();
    const unbind = bindPageLifecycle(w, e);
    db.state.fail = { message: "Failed to fetch" };
    w.queue(job(), { status: "applied" });
    await settle();
    expect(clock.delays()).toEqual([3000]);
    db.state.fail = null;
    e.document.visibilityState = "hidden";
    e.document.dispatchEvent(new Event("visibilitychange"));
    await w.idle();
    expect(db.rows.get("j1")).toMatchObject({ status: "applied" });

    db.state.fail = { message: "Failed to fetch" };
    w.queue(job({ status: "applied", updated_at: "t101" }), { deadline: "2026-12-01" });
    await settle();
    db.state.fail = null;
    e.window.dispatchEvent(new Event("online"));
    await w.idle();
    expect(db.rows.get("j1")).toMatchObject({ deadline: "2026-12-01" });

    db.state.fail = { message: "Failed to fetch" };
    w.queue(job(), { follow_up_date: "2026-12-05" });
    await settle();
    db.state.fail = null;
    e.window.dispatchEvent(new Event("pagehide"));
    await w.idle();
    expect(db.rows.get("j1")).toMatchObject({ follow_up_date: "2026-12-05" });
    unbind();
  });

  it("asks before closing the tab only while something is unsaved", async () => {
    const { db, w } = setup();
    const e = env();
    const unbind = bindPageLifecycle(w, e);
    const close = () => {
      const ev = new Event("beforeunload", { cancelable: true });
      e.window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(close()).toBe(false);
    db.state.hold = new Promise(() => {});
    w.queue(job(), { status: "applied" });
    expect(close()).toBe(true);
    unbind();
  });

  it("leaving the page sends what's pending", async () => {
    const { db, w } = setup();
    const e = env();
    const unbind = bindPageLifecycle(w, e);
    db.state.fail = { message: "Failed to fetch" };
    w.queue(job(), { status: "applied" });
    await settle();
    db.state.fail = null;
    unbind();
    w.stop();
    await w.idle();
    expect(db.rows.get("j1")).toMatchObject({ status: "applied" });
  });
});
