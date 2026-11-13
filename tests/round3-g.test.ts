import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addAllFromMaster, addFromMaster, applyPull, cloneForJob, dismissAdditions, HEADER_CONTACT, HEADER_NAME, makeBaseline,
  missingOptionalColumns, planPull, resolveRemoval,
} from "@/lib/tailor";
import {
  answerFact, carryClientState, guardAnalysisNumbers, guardNumbers, missingAnswerFacts, normalizeAnalysis, saveAnswersInOrder,
} from "@/lib/analysis";
import { createSaveQueue, type SaveState, type Timers } from "@/lib/saveQueue";
import { friendlyError, GENERIC_MESSAGE, NETWORK_MESSAGE, postApi, SERVER_DOWN_MESSAGE, SIGNED_OUT_MESSAGE } from "@/lib/api";
import { MIGRATION_HINT, OPTIONAL_JOB_COLUMNS } from "@/lib/db";
import { bulletTextMap } from "@/lib/resume";
import type { Analysis, Item, Resume } from "@/lib/types";

// ---------- fixtures ----------

const item = (id: string, title: string, bullets: Record<string, string>): Item => ({
  id, title, subtitle: "", location: "", dates: "", bullets: Object.entries(bullets).map(([bid, text]) => ({ id: bid, text })),
});

const master1 = (): Resume => ({
  version: 2,
  header: { name: "Ann", contact: "ann@x.com" },
  sections: [
    { id: "exp", title: "Experience", items: [item("acme", "Acme", { a: "A1", b: "B1" }), item("beta", "Beta", { c: "C1" })] },
    { id: "edu", title: "Education", items: [item("uni", "State U", { g: "GPA 3.9" })] },
  ],
  facts: ["secret"],
});

const ids = (r: Resume) => r.sections.map((s) => `${s.id}(${s.items.map((it) => `${it.id}:${it.bullets.map((b) => b.id).join("")}`).join(",")})`).join(" ");

// ---------- pull: additions, removals, three-way header ----------

describe("pull from master: new content", () => {
  it("offers new bullets, entries and sections the copy lacks, and adds them in the master's position", () => {
    const copy = cloneForJob(master1());
    const m2 = master1();
    m2.sections[0].items[0].bullets.splice(1, 0, { id: "a2", text: "New Acme bullet" });
    m2.sections[0].items.splice(1, 0, item("gamma", "Gamma", { x: "X1" }));
    m2.sections.splice(1, 0, { id: "awards", title: "Awards", items: [item("prize", "Hackathon winner", {})] });

    const plan = planPull(copy, m2);
    expect(plan.total).toBe(0);
    expect(plan.additions).toEqual([
      { kind: "bullet", id: "a2", itemId: "acme", text: "New Acme bullet", where: "Acme" },
      { kind: "item", id: "gamma", sectionId: "exp", label: "Gamma", where: "Experience", bullets: 1 },
      { kind: "section", id: "awards", label: "Awards", items: 1 },
    ]);

    const one = addFromMaster(copy, m2, plan.additions[1]);
    expect(ids(one)).toBe("exp(acme:ab,gamma:x,beta:c) edu(uni:g)");
    expect(one.baseline?.["item:gamma"]).toBe("Gamma");
    expect(one.baseline?.x).toBe("X1");
    expect(planPull(one, m2).additions.map((a) => a.id)).toEqual(["a2", "awards"]);

    const all = addAllFromMaster(copy, m2);
    expect(ids(all)).toBe("exp(acme:aa2b,gamma:x,beta:c) awards(prize:) edu(uni:g)");
    expect(planPull(all, m2).additions).toEqual([]);
    expect(all.facts).toBeUndefined(); // facts never come along
  });

  it("doesn't offer what the user deleted in this copy", () => {
    const copy = cloneForJob(master1());
    copy.sections[0].items[0].bullets = copy.sections[0].items[0].bullets.filter((b) => b.id !== "b");
    copy.sections[0].items = copy.sections[0].items.filter((it) => it.id !== "beta");
    copy.sections = copy.sections.filter((s) => s.id !== "edu");
    expect(planPull(copy, master1()).additions).toEqual([]);
  });

  it("'Leave out' stops offering additions without changing the copy", () => {
    const copy = cloneForJob(master1());
    const m2 = master1();
    m2.sections[1].items.push(item("uni2", "College", {}));
    const plan = planPull(copy, m2);
    expect(plan.additions).toHaveLength(1);
    const left = dismissAdditions(copy, m2, plan.additions);
    expect(left.sections).toEqual(copy.sections);
    expect(planPull(left, m2).additions).toEqual([]);
  });

  it("old baselines without sections/entries still detect a new entry by its bullets, and get upgraded by a pull", () => {
    const m1 = master1();
    const legacy = { ...cloneForJob(m1), baseline: Object.fromEntries(Object.entries(makeBaseline(m1)).filter(([k]) => !k.includes(":"))) };
    const m2 = master1();
    m2.sections[0].items.push(item("delta", "Delta", { d: "D1" }));
    m2.header.name = "Ann Lee";
    expect(planPull(legacy, m2).additions.map((a) => a.id)).toEqual(["delta"]);
    const pulled = applyPull(legacy, m2).resume;
    expect(pulled.baseline?.["section:exp"]).toBe("Experience");
    expect(pulled.baseline?.["item:delta"]).toBeUndefined(); // still to be offered
    expect(planPull(pulled, m2).additions.map((a) => a.id)).toEqual(["delta"]);
  });
});

describe("pull from master: header is three-way", () => {
  it("takes the master's change only where the copy still matches the baseline", () => {
    const copy = cloneForJob(master1());
    copy.header.contact = "ann@x.com • for Acme"; // edited only in the copy
    const m2 = master1();
    m2.header = { name: "Ann Lee", contact: "ann@new.com" };
    const plan = planPull(copy, m2);
    expect(plan).toMatchObject({ header: true, headerKept: true, total: 1 });
    const r = applyPull(copy, m2);
    expect(r.resume.header).toEqual({ name: "Ann Lee", contact: "ann@x.com • for Acme" });
    expect(r.resume.baseline?.[HEADER_NAME]).toBe("Ann Lee");
    expect(r.resume.baseline?.[HEADER_CONTACT]).toBe("ann@new.com");
    expect(planPull(r.resume, m2)).toMatchObject({ header: false, headerKept: false, total: 0 });
  });

  it("an edit in the copy alone is never an update", () => {
    const copy = cloneForJob(master1());
    copy.header.contact = "mine";
    expect(planPull(copy, master1())).toMatchObject({ header: false, headerKept: false, total: 0 });
    expect(applyPull(copy, master1()).resume.header.contact).toBe("mine");
  });
});

describe("pull from master: removed content", () => {
  const removedMaster = () => {
    const m2 = master1();
    m2.sections[0].items[0].bullets = m2.sections[0].items[0].bullets.filter((b) => b.id !== "b"); // bullet gone
    m2.sections[0].items = m2.sections[0].items.filter((it) => it.id !== "beta"); // entry gone
    m2.sections = m2.sections.filter((s) => s.id !== "edu"); // section gone
    return m2;
  };

  it("lists them once each (not their contents) and never deletes them automatically", () => {
    const copy = cloneForJob(master1());
    const m2 = removedMaster();
    const plan = planPull(copy, m2);
    expect(plan.removals).toEqual([
      { kind: "bullet", id: "b", label: "B1" },
      { kind: "item", id: "beta", label: "Beta" },
      { kind: "section", id: "edu", label: "Education" },
    ]);
    const pulled = applyPull(copy, m2).resume;
    expect(ids(pulled)).toBe(ids(copy));
    // Still listed after an automatic pull: the baseline keeps their old entries.
    expect(planPull(pulled, m2).removals.map((r) => r.id)).toEqual(["b", "beta", "edu"]);
  });

  it("'Remove here' deletes from the copy; 'Keep' keeps it as added here; both stop the listing", () => {
    const copy = cloneForJob(master1());
    const m2 = removedMaster();
    const [bullet, entry, section] = planPull(copy, m2).removals;
    let r = resolveRemoval(copy, bullet, "remove");
    r = resolveRemoval(r, section, "remove");
    r = resolveRemoval(r, entry, "keep");
    expect(ids(r)).toBe("exp(acme:a,beta:c)");
    expect(planPull(r, m2).removals).toEqual([]);
    expect(r.baseline?.["item:beta"]).toBeUndefined();
    expect(r.baseline?.c).toBeUndefined(); // now counts as "added in this tailored copy"
  });
});

// ---------- answers reach the master's facts ----------

describe("saveAnswersInOrder", () => {
  const analysis = (answers: Record<string, string> = {}): Analysis => ({
    ...normalizeAnalysis({}),
    questions: [
      { id: "q1", question: "How many users?", why: "" },
      { id: "q2", question: "Which tools?", why: "" },
    ],
    answers,
  });

  /** In-memory master behind an updateMaster-like writer that can be told to fail. */
  function fakeMaster(facts: string[]) {
    const state = { content: { ...master1(), facts } as Resume, fail: false, calls: [] as string[] };
    const writeMaster = async (mutate: (m: Resume) => Resume) => {
      state.calls.push("master");
      if (state.fail) return { ok: false as const, error: "upstream connect error or disconnect/reset before headers" };
      state.content = mutate(state.content);
      return { ok: true as const, content: state.content };
    };
    return { state, writeMaster };
  }

  it("writes the master first and only then persists the answers", async () => {
    const { state, writeMaster } = fakeMaster([]);
    const persist = vi.fn(() => void state.calls.push("answers"));
    const res = await saveAnswersInOrder({ analysis: analysis(), answers: { q1: "300", q2: " " }, writeMaster, persist });
    expect(state.calls).toEqual(["master", "answers"]);
    expect(res).toMatchObject({ ok: true, added: 1 });
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ answers: { q1: "300" } }));
    expect(state.content.facts).toEqual(["300 (re: How many users?)"]);
  });

  it("persists nothing when the master write fails, and a retry repairs the gap", async () => {
    const { state, writeMaster } = fakeMaster(["older"]);
    const persist = vi.fn();
    state.fail = true;
    const failed = await saveAnswersInOrder({ analysis: analysis(), answers: { q1: "300" }, writeMaster, persist });
    expect(failed).toMatchObject({ ok: false, stage: "master" });
    expect(persist).not.toHaveBeenCalled();
    expect(missingAnswerFacts(analysis().questions, { q1: "300" }, state.content.facts)).toEqual(["q1"]);

    state.fail = false;
    const ok = await saveAnswersInOrder({ analysis: analysis(), answers: { q1: "300" }, writeMaster, persist });
    expect(ok.ok).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(state.content.facts).toEqual(["older", answerFact("How many users?", "300")]);
    expect(missingAnswerFacts(analysis().questions, { q1: "300" }, state.content.facts)).toEqual([]);
  });

  it("repairs an answer stored on the job whose fact never reached the master (old behavior)", async () => {
    const { state, writeMaster } = fakeMaster([]);
    const stored = analysis({ q1: "300" });
    expect(missingAnswerFacts(stored.questions, stored.answers, state.content.facts)).toEqual(["q1"]);
    const res = await saveAnswersInOrder({ analysis: stored, answers: { q1: "300" }, writeMaster, persist: () => {} });
    expect(res).toMatchObject({ ok: true, added: 1 });
    expect(state.content.facts).toEqual(["300 (re: How many users?)"]);
  });

  it("an edited answer replaces its old fact; reports a failed answer write as stage 'answers'", async () => {
    const { state, writeMaster } = fakeMaster(["300 (re: How many users?)", "other"]);
    const res = await saveAnswersInOrder({
      analysis: analysis({ q1: "300" }),
      answers: { q1: "350" },
      writeMaster,
      persist: async () => {
        throw new Error("Failed to fetch");
      },
    });
    expect(res).toMatchObject({ ok: false, stage: "answers" });
    expect(state.content.facts).toEqual(["other", "350 (re: How many users?)"]);
  });
});

// ---------- re-analyze keeps drafts ----------

describe("carryClientState", () => {
  const prev: Analysis = {
    ...normalizeAnalysis({}),
    questions: [
      { id: "q1", question: "How many users?", why: "" },
      { id: "q2", question: "Which tools?", why: "" },
      { id: "q3", question: "Team size?", why: "" },
    ],
    answers: { q1: "300" },
  };

  it("matches drafts to the new questions by text and keeps drafts whose question wasn't asked again", () => {
    const fresh: Analysis = {
      ...normalizeAnalysis({}),
      questions: [
        { id: "q1", question: "How many users?", why: "" },
        { id: "n1", question: "  which TOOLS? ", why: "" },
      ],
      answers: { q1: "300" },
    };
    const out = carryClientState(prev, fresh, { q1: "300", q2: "Figma (draft)", q3: "4 people" });
    expect(out.drafts).toEqual({ q1: "300", n1: "Figma (draft)", q3: "4 people" });
    expect(out.analysis.questions.map((q) => q.id)).toEqual(["q1", "n1", "q3"]);
    expect(out.analysis.answers).toEqual({ q1: "300" }); // drafts stay drafts
    expect(out.changed).toBe(true); // q3 was appended, so the page must save
  });

  it("nothing changes when the server already has everything", () => {
    const fresh: Analysis = { ...prev, questions: [...prev.questions] };
    const out = carryClientState(prev, fresh, { q1: "300" });
    expect(out.changed).toBe(false);
    expect(out.drafts).toEqual({ q1: "300" });
  });

  it("carries answers the server didn't see yet (saved on the page, still being written)", () => {
    const fresh: Analysis = { ...normalizeAnalysis({}), questions: [{ id: "x", question: "How many users?", why: "" }], answers: {} };
    const out = carryClientState(prev, fresh, {});
    expect(out.analysis.answers).toEqual({ x: "300" });
    expect(out.changed).toBe(true);
  });
});

// ---------- honesty: invented numbers become placeholders ----------

describe("guardNumbers", () => {
  const resume = "Built a dashboard used by 300 students. Cut costs by 15 percent. Managed a $2,500 budget.";

  it("replaces numbers that aren't in the sources", () => {
    expect(guardNumbers("Cut load time by 40%", [resume]).text).toBe("Cut load time by [X%]");
    expect(guardNumbers("Raised $5,000 from sponsors", [resume]).text).toBe("Raised [$X] from sponsors");
    expect(guardNumbers("Grew to 10K users, 3x faster", [resume]).text).toBe("Grew to [NK] users, [N]x faster");
    expect(guardNumbers("Led 4 engineers", [resume]).text).toBe("Led [N] engineers");
    expect(guardNumbers("Served 1,200+ users", [resume])).toEqual({ text: "Served [N+] users", placeholders: ["[N+]"] });
  });

  it("keeps numbers the candidate gave, in any spelling", () => {
    expect(guardNumbers("Dashboard for 300 students, cut costs 15%, $2,500 budget", [resume]).text).toBe(
      "Dashboard for 300 students, cut costs 15%, $2,500 budget",
    );
    expect(guardNumbers("Reached 10K users", ["10,000 users (re: How many users?)"]).text).toBe("Reached 10K users");
    expect(guardNumbers("Reached 2.5k signups", ["2500 signups"]).text).toBe("Reached 2.5k signups");
  });

  it("leaves placeholders and tokens that aren't quantities alone", () => {
    const t = "Deployed on EC2 for a B2B tool with 24/7 uptime, 1st place, served [N users]";
    expect(guardNumbers(t, [])).toEqual({ text: t, placeholders: [] });
  });

  it("guardAnalysisNumbers rewrites suggestions and asks for the real value", () => {
    const a = guardAnalysisNumbers(
      {
        ...normalizeAnalysis({}),
        bullets: [
          { bullet_id: "b1", rating: "weak", note: "", rewrite: "Cut load time by 40% for 300 students" },
          { bullet_id: "b2", rating: "strong", note: "", rewrite: "" },
        ],
      },
      [resume],
    );
    expect(a.bullets[0].rewrite).toBe("Cut load time by [X%] for 300 students");
    expect(a.questions).toEqual([
      expect.objectContaining({ bullet_id: "b1", placeholder: "[X%]", question: expect.stringContaining("[X%]") }),
    ]);
  });
});

// ---------- the autosave scheduler ----------

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
      await flushPromises();
    }
    now = until;
    await flushPromises();
  };
  return { timers, advance, delays: () => [...pending.values()].map((p) => p.at - now) };
}
const flushPromises = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

describe("createSaveQueue (useAutosaveWithRetry's scheduler)", () => {
  it("debounces: only the latest value is saved", async () => {
    const clock = fakeTimers();
    const saved: string[] = [];
    const statuses: SaveState[] = [];
    const q = createSaveQueue<string>({ save: async (v) => void saved.push(v), onStatus: (s) => statuses.push(s), delay: 800, timers: clock.timers });
    q.push("a");
    await clock.advance(500);
    q.push("ab");
    await clock.advance(799);
    expect(saved).toEqual([]);
    await clock.advance(1);
    expect(saved).toEqual(["ab"]);
    expect(statuses).toEqual(["unsaved", "unsaved", "saving", "saved"]);
  });

  it("runs saves one at a time, in order", async () => {
    const clock = fakeTimers();
    const log: string[] = [];
    const first = deferred();
    const q = createSaveQueue<string>({
      save: async (v) => {
        log.push(`start ${v}`);
        if (v === "1") await first.promise;
        log.push(`end ${v}`);
      },
      timers: clock.timers,
    });
    q.push("1");
    q.flush();
    q.push("2");
    q.flush(); // while "1" is still in flight
    await flushPromises();
    expect(log).toEqual(["start 1"]);
    first.resolve();
    await flushPromises();
    expect(log).toEqual(["start 1", "end 1", "start 2", "end 2"]);
    expect(q.busy()).toBe(false);
  });

  it("keeps a failed value, stays 'error' while recovering, and retries after 3s, 10s, then every 30s", async () => {
    const clock = fakeTimers();
    let failuresLeft = 4;
    const saved: string[] = [];
    const statuses: SaveState[] = [];
    const q = createSaveQueue<string>({
      save: async (v) => {
        if (failuresLeft-- > 0) throw new Error("upstream connect error");
        saved.push(v);
      },
      onStatus: (s) => statuses.push(s),
      timers: clock.timers,
    });
    q.push("x");
    q.flush();
    await flushPromises();
    expect(clock.delays()).toEqual([3000]);
    await clock.advance(3000);
    expect(clock.delays()).toEqual([10000]);
    await clock.advance(10000);
    expect(clock.delays()).toEqual([30000]);
    await clock.advance(30000);
    expect(clock.delays()).toEqual([30000]);
    expect(q.hasPending()).toBe(true);
    await clock.advance(30000);
    expect(saved).toEqual(["x"]);
    expect(statuses.filter((s) => s === "saving")).toHaveLength(1); // no flicker back to "saving"
    expect(statuses.at(-1)).toBe("saved");
  });

  it("a newer edit during a failure replaces the failed value; retry() saves now", async () => {
    const clock = fakeTimers();
    let fail = true;
    const saved: string[] = [];
    const q = createSaveQueue<string>({
      save: async (v) => {
        if (fail) throw new Error("offline");
        saved.push(v);
      },
      timers: clock.timers,
    });
    q.push("old");
    q.flush();
    await flushPromises();
    q.push("new");
    fail = false;
    q.flush();
    await flushPromises();
    expect(saved).toEqual(["new"]);
    expect(q.busy()).toBe(false);
    expect(clock.delays()).toEqual([]);
  });
});

// ---------- plain-language errors ----------

describe("friendlyError / postApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps network, auth, server and database errors to plain sentences", () => {
    expect(friendlyError({ message: "upstream connect error or disconnect/reset before headers. reset reason: connection failure" })).toBe(
      NETWORK_MESSAGE,
    );
    expect(friendlyError(new TypeError("Failed to fetch"))).toBe(NETWORK_MESSAGE);
    expect(friendlyError(new TypeError("Load failed"))).toBe(NETWORK_MESSAGE); // Safari
    expect(friendlyError({ message: "JWT expired", code: "PGRST301" })).toBe(SIGNED_OUT_MESSAGE);
    expect(friendlyError({ code: "42703", message: 'column jobs.reached_interview does not exist' })).toBe(MIGRATION_HINT);
    expect(friendlyError("<html><body>502 Bad Gateway</body></html>")).toBe(SERVER_DOWN_MESSAGE);
    const raw = { message: 'new row violates row-level security policy for table "jobs"', code: "42501" };
    expect(friendlyError(raw, "Couldn't save.")).toBe("Couldn't save.");
    expect(friendlyError(undefined)).toBe(GENERIC_MESSAGE);
  });

  it("lets our own sentences through", () => {
    const own = "Your master resume kept changing while saving (another tab?). Try again.";
    expect(friendlyError(own)).toBe(own);
    expect(friendlyError(new Error("The AI's daily limit was reached. Try again later."))).toBe("The AI's daily limit was reached. Try again later.");
  });

  it("postApi turns network failures and HTML error pages into friendly text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await postApi("/api/x", {})).toEqual({ error: NETWORK_MESSAGE });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>upstream connect error</html>", { status: 503 })));
    expect(await postApi("/api/x", {})).toEqual({ error: SERVER_DOWN_MESSAGE });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "fetch failed" }), { status: 502 })));
    expect(await postApi("/api/x", {})).toEqual({ error: NETWORK_MESSAGE });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Not signed in" }), { status: 401 })));
    expect(await postApi("/api/x", {})).toEqual({ error: SIGNED_OUT_MESSAGE });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>login</html>", { status: 200 })));
    expect((await postApi("/api/x", {})).error).toMatch(/reload the page/i);
  });
});

describe("missingOptionalColumns", () => {
  it("names the missing column from PostgREST/Postgres errors, else assumes all", () => {
    expect(missingOptionalColumns("Could not find the 'reached_interview' column of 'jobs' in the schema cache", OPTIONAL_JOB_COLUMNS)).toEqual([
      "reached_interview",
    ]);
    expect(missingOptionalColumns('column "deadline" of relation "jobs" does not exist', OPTIONAL_JOB_COLUMNS)).toEqual(["deadline"]);
    expect(missingOptionalColumns("something else", OPTIONAL_JOB_COLUMNS)).toEqual([...OPTIONAL_JOB_COLUMNS]);
  });
});

// keep the fixture helper honest
describe("fixtures", () => {
  it("master1 has the expected bullets", () => {
    expect([...bulletTextMap(master1()).keys()]).toEqual(["a", "b", "c", "g"]);
  });
});
