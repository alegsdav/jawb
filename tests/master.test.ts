import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeFacts, mergeResumes, sameJson, saveMasterDocument, updateMaster } from "@/lib/master";
import { addFacts } from "@/lib/facts";
import type { Item, Resume } from "@/lib/types";

// ---------- fake Supabase client: one `resumes` row, conditional updates like PostgREST ----------

type Call = { op: "select" | "update"; values?: { content: Resume }; filters: Record<string, unknown> };

function fakeDb(initial: { content: Resume; updated_at: string } | null, opts: { failWith?: { code?: string; message: string } } = {}) {
  const row = initial ? { id: "m1", ...initial } : null;
  let version = 0;
  /** Runs before an update is checked, to simulate another tab saving in between. */
  const hooks: (() => void)[] = [];
  const calls: Call[] = [];
  const handle = (c: Call) => {
    calls.push(c);
    if (opts.failWith) return { data: null, error: opts.failWith };
    if (c.op === "select") return { data: row ? { ...row } : null, error: null };
    hooks.shift()?.();
    if (!row || c.filters.id !== row.id || c.filters.updated_at !== row.updated_at) return { data: [], error: null };
    row.content = c.values!.content;
    row.updated_at = `t-saved-${++version}`;
    return { data: [{ updated_at: row.updated_at }], error: null };
  };
  const client = {
    from() {
      const call: Call = { op: "select", filters: {} };
      const b = {
        select: () => b,
        update: (values: { content: Resume }) => ((call.op = "update"), (call.values = values), b),
        eq: (k: string, v: unknown) => ((call.filters[k] = v), b),
        maybeSingle: () => b,
        single: () => b,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(handle(call)).then(res, rej),
      };
      return b;
    },
  } as unknown as SupabaseClient;
  /** Another device saves `content` now. */
  const otherSaves = (content: Resume) => {
    row!.content = content;
    row!.updated_at = `t-other-${++version}`;
  };
  return { client, row, calls, hooks, otherSaves };
}

// ---------- resume builders ----------

const item = (id: string, title: string, bullets: [string, string][], extra: Partial<Item> = {}): Item => ({
  id, title, subtitle: "", location: "", dates: "", bullets: bullets.map(([bid, text]) => ({ id: bid, text })), ...extra,
});

/** Two sections: Experience (Acme: b1, b2, b3; Beta: b4) and Skills (one inline item). */
const baseDoc = (): Resume => ({
  version: 2,
  header: { name: "Ada Lovelace", contact: "ada@example.com" },
  sections: [
    {
      id: "s1",
      title: "Experience",
      items: [
        item("i1", "Acme", [["b1", "Built a dashboard"], ["b2", "Wrote tests"], ["b3", "Fixed bugs"]], { subtitle: "Intern", dates: "2025" }),
        item("i2", "Beta", [["b4", "Ran a study"]]),
      ],
    },
    { id: "s2", title: "Skills", items: [item("i3", "Languages", [], { subtitle: "Python, SQL" })] },
  ],
  facts: ["Speaks Spanish", "Eagle Scout"],
});

const clone = (r: Resume): Resume => JSON.parse(JSON.stringify(r));
/** Copy of `r` with `fn` applied to a deep clone. */
const edit = (r: Resume, fn: (d: Resume) => void): Resume => {
  const d = clone(r);
  fn(d);
  return d;
};
const bullets = (r: Resume, itemId: string) =>
  r.sections.flatMap((s) => s.items).find((it) => it.id === itemId)?.bullets.map((b) => b.text);
const findItem = (r: Resume, itemId: string) => r.sections.flatMap((s) => s.items).find((it) => it.id === itemId);
const setBullet = (d: Resume, bid: string, text: string) => {
  for (const s of d.sections) for (const it of s.items) for (const b of it.bullets) if (b.id === bid) b.text = text;
};

// ---------- mergeResumes ----------

describe("mergeResumes", () => {
  const base = baseDoc();

  it("returns the other side unchanged when only one side changed", () => {
    const local = edit(base, (d) => setBullet(d, "b1", "Built a React dashboard"));
    expect(mergeResumes(base, local, clone(base))).toEqual({ merged: local, conflicts: [] });
    expect(mergeResumes(base, clone(base), local)).toEqual({ merged: local, conflicts: [] });
    expect(mergeResumes(base, local, clone(local)).conflicts).toEqual([]);
  });

  it("merges edits to different bullets from both sides", () => {
    const local = edit(base, (d) => setBullet(d, "b1", "Built a React dashboard"));
    const server = edit(base, (d) => setBullet(d, "b3", "Fixed 40 bugs"));
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(bullets(merged, "i1")).toEqual(["Built a React dashboard", "Wrote tests", "Fixed 40 bugs"]);
  });

  it("reports a conflict when both sides changed the same bullet differently (merged keeps mine)", () => {
    const local = edit(base, (d) => setBullet(d, "b2", "Wrote unit tests"));
    const server = edit(base, (d) => setBullet(d, "b2", "Wrote integration tests"));
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([{ where: 'Bullet in "Acme"', local: "Wrote unit tests", server: "Wrote integration tests" }]);
    expect(bullets(merged, "i1")?.[1]).toBe("Wrote unit tests");
  });

  it("is not a conflict when both sides made the same change", () => {
    const local = edit(base, (d) => setBullet(d, "b2", "Same"));
    const server = edit(base, (d) => {
      setBullet(d, "b2", "Same");
      d.header.name = "Ada L.";
    });
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(merged.header.name).toBe("Ada L.");
    expect(bullets(merged, "i1")?.[1]).toBe("Same");
  });

  it("merges header fields independently and flags a header conflict", () => {
    const local = edit(base, (d) => (d.header.name = "Ada King"));
    const server = edit(base, (d) => (d.header.contact = "ada@new.com"));
    expect(mergeResumes(base, local, server).merged.header).toEqual({ name: "Ada King", contact: "ada@new.com" });
    const server2 = edit(base, (d) => (d.header.name = "Countess Ada"));
    expect(mergeResumes(base, local, server2).conflicts).toEqual([{ where: "Name", local: "Ada King", server: "Countess Ada" }]);
  });

  it("merges entry fields (title, subtitle, location, dates) field by field", () => {
    const local = edit(base, (d) => (d.sections[0].items[0].dates = "2024 – 2025"));
    const server = edit(base, (d) => {
      d.sections[0].items[0].location = "Boston, MA";
      d.sections[0].items[0].subtitle = "Data Intern";
    });
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(findItem(merged, "i1")).toMatchObject({ title: "Acme", subtitle: "Data Intern", location: "Boston, MA", dates: "2024 – 2025" });

    const server2 = edit(base, (d) => (d.sections[0].items[0].dates = "Summer 2025"));
    expect(mergeResumes(base, local, server2).conflicts).toEqual([{ where: 'Dates of "Acme"', local: "2024 – 2025", server: "Summer 2025" }]);
  });

  it("merges section titles and flags a title conflict", () => {
    const local = edit(base, (d) => (d.sections[1].title = "Technical Skills"));
    const server = edit(base, (d) => setBullet(d, "b4", "Ran a 3-month study"));
    const m = mergeResumes(base, local, server);
    expect(m.conflicts).toEqual([]);
    expect(m.merged.sections.map((s) => s.title)).toEqual(["Experience", "Technical Skills"]);
    const server2 = edit(base, (d) => (d.sections[1].title = "Skills & Tools"));
    expect(mergeResumes(base, local, server2).conflicts).toEqual([
      { where: 'Section title "Technical Skills"', local: "Technical Skills", server: "Skills & Tools" },
    ]);
  });

  it("keeps bullets added on both sides, in a sensible position", () => {
    const local = edit(base, (d) => d.sections[0].items[0].bullets.splice(1, 0, { id: "L1", text: "Mine, after b1" }));
    const server = edit(base, (d) => d.sections[0].items[0].bullets.push({ id: "S1", text: "Theirs, at the end" }));
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(bullets(merged, "i1")).toEqual(["Built a dashboard", "Mine, after b1", "Wrote tests", "Fixed bugs", "Theirs, at the end"]);
  });

  it("keeps a bullet the server added at the start", () => {
    const server = edit(base, (d) => d.sections[0].items[0].bullets.unshift({ id: "S0", text: "First" }));
    const local = edit(base, (d) => setBullet(d, "b3", "Fixed many bugs"));
    expect(bullets(mergeResumes(base, local, server).merged, "i1")).toEqual(["First", "Built a dashboard", "Wrote tests", "Fixed many bugs"]);
  });

  it("keeps whole entries and sections added on either side", () => {
    const local = edit(base, (d) => d.sections[0].items.push(item("iL", "Gamma", [["bL", "New job"]])));
    const server = edit(base, (d) => d.sections.push({ id: "sS", title: "Awards", items: [item("iS", "Dean's List", [])] }));
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(merged.sections.map((s) => s.title)).toEqual(["Experience", "Skills", "Awards"]);
    expect(merged.sections[0].items.map((i) => i.title)).toEqual(["Acme", "Beta", "Gamma"]);
  });

  it("applies a deletion when the other side didn't touch that bullet", () => {
    const local = edit(base, (d) => d.sections[0].items[0].bullets.splice(1, 1)); // delete b2
    const server = edit(base, (d) => setBullet(d, "b1", "Built a React dashboard"));
    expect(bullets(mergeResumes(base, local, server).merged, "i1")).toEqual(["Built a React dashboard", "Fixed bugs"]);
    // ...and the same from the server's side.
    expect(bullets(mergeResumes(base, server, local).merged, "i1")).toEqual(["Built a React dashboard", "Fixed bugs"]);
  });

  it("keeps an edited bullet that the other side deleted", () => {
    const local = edit(base, (d) => setBullet(d, "b2", "Wrote 200 tests"));
    const server = edit(base, (d) => d.sections[0].items[0].bullets.splice(1, 1));
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(bullets(merged, "i1")).toEqual(["Built a dashboard", "Wrote 200 tests", "Fixed bugs"]);
    expect(bullets(mergeResumes(base, server, local).merged, "i1")).toEqual(["Built a dashboard", "Wrote 200 tests", "Fixed bugs"]);
  });

  it("deletes an entry or section the other side didn't edit, keeps one it did", () => {
    const local = edit(base, (d) => d.sections[0].items.splice(1, 1)); // delete Beta
    const server = edit(base, (d) => setBullet(d, "b1", "x"));
    expect(mergeResumes(base, local, server).merged.sections[0].items.map((i) => i.id)).toEqual(["i1"]);
    const serverEditsBeta = edit(base, (d) => setBullet(d, "b4", "Ran a big study"));
    expect(mergeResumes(base, local, serverEditsBeta).merged.sections[0].items.map((i) => i.id)).toEqual(["i1", "i2"]);
    const noSkills = edit(base, (d) => d.sections.splice(1, 1));
    expect(mergeResumes(base, noSkills, server).merged.sections.map((s) => s.id)).toEqual(["s1"]);
  });

  it("drops something both sides deleted", () => {
    const local = edit(base, (d) => {
      d.sections[0].items[0].bullets.splice(0, 1);
      d.header.name = "A";
    });
    const server = edit(base, (d) => {
      d.sections[0].items[0].bullets.splice(0, 1);
      d.header.contact = "c";
    });
    expect(bullets(mergeResumes(base, local, server).merged, "i1")).toEqual(["Wrote tests", "Fixed bugs"]);
  });

  it("takes the server's reorder when only the server reordered", () => {
    const server = edit(base, (d) => d.sections[0].items[0].bullets.reverse());
    const local = edit(base, (d) => setBullet(d, "b1", "Built a React dashboard"));
    expect(bullets(mergeResumes(base, local, server).merged, "i1")).toEqual(["Fixed bugs", "Wrote tests", "Built a React dashboard"]);
  });

  it("keeps the local order when both reordered", () => {
    const server = edit(base, (d) => d.sections[0].items[0].bullets.reverse());
    const local = edit(base, (d) => {
      const b = d.sections[0].items[0].bullets;
      [b[0], b[1]] = [b[1], b[0]];
    });
    expect(bullets(mergeResumes(base, local, server).merged, "i1")).toEqual(["Wrote tests", "Built a dashboard", "Fixed bugs"]);
  });

  it("flags a bullet moved to another entry on one side and edited on the other, without duplicating it", () => {
    // Local moves b3 from Acme to Beta; the server edits b3 in place.
    const local = edit(base, (d) => {
      const [b3] = d.sections[0].items[0].bullets.splice(2, 1);
      d.sections[0].items[1].bullets.push(b3);
    });
    const server = edit(base, (d) => setBullet(d, "b3", "Fixed 40 bugs"));
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts.map((c) => c.where)).toContain("A line moved on one device and edited on the other");
    const ids = merged.sections.flatMap((s) => s.items.flatMap((i) => i.bullets.map((b) => b.id)));
    expect(ids.filter((x) => x === "b3")).toHaveLength(1);
  });

  it("merges facts as sets: additions from both sides, deletions stick", () => {
    const local = edit(base, (d) => (d.facts = ["Speaks Spanish", "Ran a 5k"])); // deleted "Eagle Scout", added one
    const server = edit(base, (d) => (d.facts = ["Speaks Spanish", "Eagle Scout", "Knows Excel"])); // added one
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(merged.facts).toEqual(["Speaks Spanish", "Ran a 5k", "Knows Excel"]);
  });

  it("a fact deleted on the server stays deleted even though this page still has it", () => {
    const server = edit(base, (d) => (d.facts = ["Speaks Spanish"]));
    const local = edit(base, (d) => setBullet(d, "b1", "Built a React dashboard"));
    const { merged } = mergeResumes(base, local, server);
    expect(merged.facts).toEqual(["Speaks Spanish"]);
    expect(bullets(merged, "i1")?.[0]).toBe("Built a React dashboard");
  });

  it("an edited fact is a delete plus an add on that side", () => {
    const local = edit(base, (d) => (d.facts = ["Speaks fluent Spanish", "Eagle Scout"]));
    const server = edit(base, (d) => (d.facts = ["Speaks Spanish", "Eagle Scout", "New"]));
    expect(mergeResumes(base, local, server).merged.facts).toEqual(["Speaks fluent Spanish", "Eagle Scout", "New"]);
  });

  it("handles a server copy replaced by 'Save as master' (same ids, new wording) without losing local edits elsewhere", () => {
    // A job page saved its tailored copy as the master: b1 reworded, a bullet added, facts kept.
    const server = edit(base, (d) => {
      setBullet(d, "b1", "Built a Tableau dashboard used by 30 analysts");
      d.sections[0].items[0].bullets.push({ id: "t1", text: "Automated a weekly report" });
    });
    const local = edit(base, (d) => setBullet(d, "b4", "Ran a 3-month user study"));
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(bullets(merged, "i1")).toEqual([
      "Built a Tableau dashboard used by 30 analysts", "Wrote tests", "Fixed bugs", "Automated a weekly report",
    ]);
    expect(bullets(merged, "i2")).toEqual(["Ran a 3-month user study"]);
  });

  it("does not mutate its inputs", () => {
    const local = edit(base, (d) => setBullet(d, "b1", "L"));
    const server = edit(base, (d) => setBullet(d, "b2", "S"));
    const [b0, l0, s0] = [clone(base), clone(local), clone(server)];
    mergeResumes(base, local, server);
    expect([base, local, server]).toEqual([b0, l0, s0]);
  });
});

describe("mergeFacts", () => {
  it("is case/whitespace-insensitive and handles missing lists", () => {
    expect(mergeFacts(["A"], ["a ", "B"], ["A", "C"])).toEqual(["a ", "B", "C"]);
    expect(mergeFacts(undefined, undefined, undefined)).toBeUndefined();
    expect(mergeFacts(undefined, undefined, ["X"])).toEqual(["X"]);
    expect(mergeFacts(["X"], [], ["X"])).toEqual([]);
  });
});

describe("sameJson", () => {
  it("ignores key order and undefined keys", () => {
    expect(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameJson({ a: 1, x: undefined }, { a: 1 })).toBe(true);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson({ a: null }, { a: 0 })).toBe(false);
  });
});

// ---------- updateMaster (job page: facts, "Save as master") ----------

describe("updateMaster", () => {
  const doc = (facts: string[]) => ({ ...baseDoc(), facts });

  it("re-reads and retries when someone else saved in between, keeping both changes", async () => {
    const db = fakeDb({ content: doc(["Speaks Spanish"]), updated_at: "t0" });
    db.hooks.push(() => {
      db.row!.content = doc(["Speaks Spanish", "Eagle Scout"]);
      db.row!.updated_at = "t-other";
    });
    const res = await updateMaster(db.client, (cur) => addFacts(cur, ["Ran a 5k"]));
    expect(res.ok).toBe(true);
    expect(db.row!.content.facts).toEqual(["Speaks Spanish", "Eagle Scout", "Ran a 5k"]);
    expect(db.calls.map((c) => c.op)).toEqual(["select", "update", "select", "update"]);
    expect(db.calls[1].filters).toEqual({ id: "m1", updated_at: "t0" });
    expect(db.calls[3].filters).toEqual({ id: "m1", updated_at: "t-other" });
  });

  it("gives up with an error after 3 retries", async () => {
    const db = fakeDb({ content: doc([]), updated_at: "t0" });
    for (let i = 0; i < 4; i++) db.hooks.push(() => void (db.row!.updated_at = `t-other-${i}`));
    const res = await updateMaster(db.client, (cur) => addFacts(cur, ["x"]));
    expect(res).toEqual({ ok: false, error: expect.stringContaining("kept changing") });
    expect(db.calls.filter((c) => c.op === "update")).toHaveLength(4);
  });

  it("skips the write when nothing changes, and reports a missing master", async () => {
    const db = fakeDb({ content: doc(["A"]), updated_at: "t0" });
    expect((await updateMaster(db.client, (cur) => addFacts(cur, ["a"]))).ok).toBe(true);
    expect(db.calls.map((c) => c.op)).toEqual(["select"]);
    const none = await updateMaster(fakeDb(null).client, (cur) => cur);
    expect(none.ok).toBe(false);
  });

  it("never returns raw backend text", async () => {
    const db = fakeDb({ content: doc([]), updated_at: "t0" }, { failWith: { message: "TypeError: Failed to fetch" } });
    const res = await updateMaster(db.client, (cur) => addFacts(cur, ["x"]));
    expect(res).toEqual({ ok: false, error: "Couldn't load your data. Check your connection and reload the page." });
  });
});

// ---------- saveMasterDocument (master page autosave) ----------

describe("saveMasterDocument", () => {
  it("writes directly when nobody else saved", async () => {
    const base = baseDoc();
    const db = fakeDb({ content: base, updated_at: "t0" });
    const local = edit(base, (d) => setBullet(d, "b1", "New"));
    const out = await saveMasterDocument(db.client, "m1", local, { content: base, updatedAt: "t0" });
    expect(out).toEqual({ kind: "saved", content: local, updatedAt: "t-saved-1", merged: false });
    if (out.kind === "saved") expect(out.content).toBe(local);
    expect(db.calls.map((c) => c.op)).toEqual(["update"]);
  });

  it("two devices editing different bullets: merges, saves, and reports merged", async () => {
    const base = baseDoc();
    const db = fakeDb({ content: base, updated_at: "t0" });
    db.otherSaves(edit(base, (d) => setBullet(d, "b3", "Fixed 40 bugs (phone)")));
    const local = edit(base, (d) => setBullet(d, "b1", "Built a dashboard (laptop)"));
    const out = await saveMasterDocument(db.client, "m1", local, { content: base, updatedAt: "t0" });
    expect(out.kind).toBe("saved");
    if (out.kind !== "saved") return;
    expect(out.merged).toBe(true);
    expect(bullets(db.row!.content, "i1")).toEqual(["Built a dashboard (laptop)", "Wrote tests", "Fixed 40 bugs (phone)"]);
    expect(out.content).toEqual(db.row!.content);
    expect(out.updatedAt).toBe(db.row!.updated_at);
    expect(db.calls.map((c) => c.op)).toEqual(["update", "select", "update"]);
  });

  it("'Save as master' from a job page isn't wiped by a stale master page", async () => {
    const base = baseDoc();
    const db = fakeDb({ content: base, updated_at: "t0" });
    db.otherSaves(edit(base, (d) => setBullet(d, "b1", "Tailored wording saved as master")));
    const local = edit(base, (d) => (d.header.contact = "new@example.com"));
    await saveMasterDocument(db.client, "m1", local, { content: base, updatedAt: "t0" });
    expect(bullets(db.row!.content, "i1")?.[0]).toBe("Tailored wording saved as master");
    expect(db.row!.content.header.contact).toBe("new@example.com");
  });

  it("a fact deleted on another device doesn't come back", async () => {
    const base = baseDoc();
    const db = fakeDb({ content: base, updated_at: "t0" });
    db.otherSaves(edit(base, (d) => (d.facts = ["Speaks Spanish"])));
    const local = edit(base, (d) => setBullet(d, "b2", "Wrote unit tests"));
    await saveMasterDocument(db.client, "m1", local, { content: base, updatedAt: "t0" });
    expect(db.row!.content.facts).toEqual(["Speaks Spanish"]);
  });

  it("same bullet changed on both: returns the conflict and writes nothing", async () => {
    const base = baseDoc();
    const db = fakeDb({ content: base, updated_at: "t0" });
    const theirs = edit(base, (d) => setBullet(d, "b2", "Theirs"));
    db.otherSaves(theirs);
    const before = db.row!.updated_at;
    const local = edit(base, (d) => setBullet(d, "b2", "Mine"));
    const out = await saveMasterDocument(db.client, "m1", local, { content: base, updatedAt: "t0" });
    expect(out.kind).toBe("conflict");
    if (out.kind !== "conflict") return;
    expect(out.conflicts).toEqual([{ where: 'Bullet in "Acme"', local: "Mine", server: "Theirs" }]);
    expect(out.server).toEqual(theirs);
    expect(out.serverUpdatedAt).toBe(before);
    expect(db.row!.content).toEqual(theirs);
    expect(db.calls.map((c) => c.op)).toEqual(["update", "select"]);
  });

  it("'Keep mine' = merge with mine winning, rebased on their copy: then saves over theirs", async () => {
    const base = baseDoc();
    const db = fakeDb({ content: base, updated_at: "t0" });
    const theirs = edit(base, (d) => {
      setBullet(d, "b2", "Theirs");
      setBullet(d, "b4", "Their other change");
    });
    db.otherSaves(theirs);
    const local = edit(base, (d) => setBullet(d, "b2", "Mine"));
    const first = await saveMasterDocument(db.client, "m1", local, { content: base, updatedAt: "t0" });
    if (first.kind !== "conflict") throw new Error("expected a conflict");
    const resolved = mergeResumes(base, local, first.server).merged;
    const out = await saveMasterDocument(db.client, "m1", resolved, { content: first.server, updatedAt: first.serverUpdatedAt });
    expect(out.kind).toBe("saved");
    expect(bullets(db.row!.content, "i1")?.[1]).toBe("Mine");
    expect(bullets(db.row!.content, "i2")).toEqual(["Their other change"]);
  });

  it("skips the write when the server already has everything", async () => {
    const base = baseDoc();
    const db = fakeDb({ content: base, updated_at: "t0" });
    const same = edit(base, (d) => setBullet(d, "b1", "Both"));
    db.otherSaves(same);
    const out = await saveMasterDocument(db.client, "m1", clone(same), { content: base, updatedAt: "t0" });
    expect(out).toMatchObject({ kind: "saved", updatedAt: db.row!.updated_at, merged: false });
    expect(db.calls.map((c) => c.op)).toEqual(["update", "select"]);
  });

  it("re-merges if another save lands between the merge and its write", async () => {
    const base = baseDoc();
    const db = fakeDb({ content: base, updated_at: "t0" });
    const s1 = edit(base, (d) => setBullet(d, "b3", "Phone 1"));
    db.otherSaves(s1);
    // Right before our merged write, the phone saves again.
    db.hooks.push(() => {}); // first update (stale) fails on its own
    db.hooks.push(() => db.otherSaves(edit(s1, (d) => setBullet(d, "b4", "Phone 2"))));
    const local = edit(base, (d) => setBullet(d, "b1", "Laptop"));
    const out = await saveMasterDocument(db.client, "m1", local, { content: base, updatedAt: "t0" });
    expect(out.kind).toBe("saved");
    expect(bullets(db.row!.content, "i1")).toEqual(["Laptop", "Wrote tests", "Phone 1"]);
    expect(bullets(db.row!.content, "i2")).toEqual(["Phone 2"]);
    expect(db.calls.map((c) => c.op)).toEqual(["update", "select", "update", "select", "update"]);
  });

  it("throws a plain sentence on database errors (so autosave retries)", async () => {
    const base = baseDoc();
    const db = fakeDb({ content: base, updated_at: "t0" }, { failWith: { code: "PGRST000", message: "upstream connect error" } });
    await expect(saveMasterDocument(db.client, "m1", base, { content: base, updatedAt: "t0" })).rejects.toThrow(
      "Couldn't save. Check your connection; we'll keep retrying.",
    );
  });

  it("throws when the row was deleted", async () => {
    const base = baseDoc();
    const db = fakeDb(null);
    await expect(saveMasterDocument(db.client, "m1", base, { content: base, updatedAt: "t0" })).rejects.toThrow("deleted elsewhere");
  });
});
