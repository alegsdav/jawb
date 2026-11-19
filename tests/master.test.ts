import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isReplacement, keepMineVersion, mergeDocs, mergeResumes, sameJson, saveMasterDocument, updateMaster } from "@/lib/master";
import { addFacts } from "@/lib/facts";
import { buildDoc, flattenDoc, insertParagraphsAfter, paragraph, paragraphText, removeParagraphs, setParagraphText } from "@/lib/doc/model";
import type { FlatEntry } from "@/lib/doc/model";
import type { DocParagraph } from "@/lib/doc/types";
import { reconcileIds, resumeDoc, withDoc } from "@/lib/resume";
import type { Resume } from "@/lib/types";

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

// ---------- document fixtures ----------

/** A plain paragraph (a line, or a heading when its text is all caps). */
const L = (id: string, text: string): FlatEntry => ({ node: paragraph(text, { attrs: { id } }), listType: null, depth: 0, bullet: false });
/** A bullet: the first line of a list item. */
const B = (id: string, text: string): FlatEntry => ({
  node: paragraph(text, { attrs: { id } }),
  listType: "bulletList",
  depth: 1,
  bullet: true,
});

/** Name, contact, Experience (Acme: b1-b3, Beta: b4), Education (State U: g1). */
const baseEntries = (): FlatEntry[] => [
  L("name", "Ada Lovelace"),
  L("contact", "ada@example.com"),
  L("h-exp", "EXPERIENCE"),
  L("acme", "Acme\tNew York"),
  L("acme-sub", "Intern\t2025"),
  B("b1", "Built a dashboard"),
  B("b2", "Wrote tests"),
  B("b3", "Fixed bugs"),
  L("beta", "Beta\tBoston"),
  B("b4", "Ran a study"),
  L("h-edu", "EDUCATION"),
  L("uni", "State U"),
  B("g1", "GPA 3.9"),
];

const resumeOf = (entries: FlatEntry[]): Resume => withDoc({ header: { name: "", contact: "" }, sections: [] }, buildDoc(entries));
const baseResume = (): Resume => resumeOf(baseEntries());

/** The Acme bullets, in the fixture's order. */
const BULLETS = ["b1", "b2", "b3"];

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const lines = (r: Resume) => flattenDoc(resumeDoc(r)).map((p) => p.text);
const ids = (r: Resume) => flattenDoc(resumeDoc(r)).map((p) => p.id);
const textOf = (r: Resume, id: string) => flattenDoc(resumeDoc(r)).find((p) => p.id === id)?.text;

/** Paragraph `id` with new text (its formatting kept). */
const withText = (r: Resume, id: string, text: string): Resume => withDoc(r, setParagraphText(resumeDoc(r), id, text));
/** Paragraph `id` replaced by `fn(node)` (same list placement). */
const mapPara = (r: Resume, id: string, fn: (node: DocParagraph) => DocParagraph): Resume =>
  withDoc(r, buildDoc(flattenDoc(resumeDoc(r)).map((p) => (p.id === id ? { ...p, node: fn(p.node) } : p))));
const withoutIds = (r: Resume, drop: string[]): Resume => withDoc(r, removeParagraphs(resumeDoc(r), drop));
const insertAfter = (r: Resume, afterId: string, entries: FlatEntry[]): Resume =>
  withDoc(r, insertParagraphsAfter(resumeDoc(r), afterId, entries));
/** The entries with the paragraphs `ids` put in the reverse of their current order (their slots stay). */
const reverseIn = (entries: FlatEntry[], wanted: string[]): FlatEntry[] => {
  const byId = new Map(entries.map((e) => [e.node.attrs.id, e] as const));
  const slots = entries.flatMap((e, i) => (wanted.includes(e.node.attrs.id) ? [i] : []));
  const out = [...entries];
  const rev = [...wanted].reverse();
  slots.forEach((slot, k) => (out[slot] = byId.get(rev[k])!));
  return out;
};

// ---------- mergeResumes ----------

describe("mergeResumes", () => {
  const base = baseResume();

  it("returns the other side unchanged when only one side changed", () => {
    const local = withText(base, "b1", "Built a React dashboard");
    expect(mergeResumes(base, local, clone(base))).toEqual({ merged: local, conflicts: [] });
    expect(mergeResumes(base, clone(base), local)).toEqual({ merged: local, conflicts: [] });
    expect(mergeResumes(base, local, clone(local)).conflicts).toEqual([]);
  });

  it("concurrent edits to different paragraphs both survive (bullets, an entry line, a heading)", () => {
    const local = withText(base, "b1", "Built a React dashboard");
    const server = withText(withText(base, "acme-sub", "Intern\t2024 – 2025"), "h-edu", "EDUCATION & HONOURS");
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(textOf(merged, "b1")).toBe("Built a React dashboard");
    expect(textOf(merged, "acme-sub")).toBe("Intern\t2024 – 2025");
    expect(textOf(merged, "h-edu")).toBe("EDUCATION & HONOURS");
  });

  it("the same paragraph changed differently: local wins and the conflict is reported", () => {
    const local = withText(base, "b2", "Wrote unit tests");
    const server = withText(base, "b2", "Wrote integration tests");
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(textOf(merged, "b2")).toBe("Wrote unit tests");
    expect(conflicts).toEqual([{ where: 'Line "Wrote unit tests"', local: "Wrote unit tests", server: "Wrote integration tests" }]);
  });

  it("the same change on both sides is not a conflict", () => {
    const local = withText(base, "b2", "Same");
    const server = withText(base, "b2", "Same");
    expect(mergeResumes(base, local, server).conflicts).toEqual([]);
  });

  it("the name line and the contact line merge independently; the same name line changed differently is a conflict", () => {
    const local = withText(base, "name", "Ada King");
    const server = withText(base, "contact", "ada@new.com");
    expect(lines(mergeResumes(base, local, server).merged).slice(0, 2)).toEqual(["Ada King", "ada@new.com"]);
    const server2 = withText(base, "name", "Countess Ada");
    expect(mergeResumes(base, local, server2).conflicts).toEqual([{ where: 'Line "Ada King"', local: "Ada King", server: "Countess Ada" }]);
  });

  it("a heading renamed on one side and a bullet edited on the other both survive", () => {
    const local = withText(base, "h-exp", "WORK EXPERIENCE");
    const server = withText(base, "b1", "Built a React dashboard");
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(textOf(merged, "h-exp")).toBe("WORK EXPERIENCE");
    expect(textOf(merged, "b1")).toBe("Built a React dashboard");
  });

  it("bullets added on both sides land after their neighbours", () => {
    const local = insertAfter(base, "b1", [B("L1", "Mine, after b1")]);
    const server = insertAfter(base, "b3", [B("S1", "Theirs, after b3")]);
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(lines(merged).slice(5, 10)).toEqual(["Built a dashboard", "Mine, after b1", "Wrote tests", "Fixed bugs", "Theirs, after b3"]);
  });

  it("a bullet the server added at the start of a list lands before the first bullet, and local edits survive", () => {
    const server = insertAfter(base, "acme-sub", [B("S0", "First")]);
    const local = withText(base, "b3", "Fixed many bugs");
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(lines(merged).slice(4, 9)).toEqual(["Intern\t2025", "First", "Built a dashboard", "Wrote tests", "Fixed many bugs"]);
  });

  it("entries and sections added on either side are kept, in place", () => {
    const local = insertAfter(base, "b4", [L("gam", "Gamma\tDenver"), B("bL", "New job")]);
    const server = insertAfter(base, "g1", [L("h-awd", "AWARDS"), L("dean", "Dean's List")]);
    expect(ids(mergeResumes(base, local, server).merged)).toEqual([
      "name", "contact", "h-exp", "acme", "acme-sub", "b1", "b2", "b3", "beta", "b4", "gam", "bL", "h-edu", "uni", "g1", "h-awd", "dean",
    ]);
  });

  it("a paragraph deleted on one side and not edited on the other stays deleted", () => {
    const local = withoutIds(base, ["b2"]);
    const server = withText(base, "b1", "Built a React dashboard");
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(ids(merged)).not.toContain("b2");
    expect(textOf(merged, "b1")).toBe("Built a React dashboard");
    expect(ids(mergeResumes(base, server, local).merged)).not.toContain("b2");
  });

  it("a paragraph edited on one side and deleted on the other is kept (conflict)", () => {
    const local = withText(base, "b2", "Wrote 200 tests");
    const server = withoutIds(base, ["b2"]);
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(textOf(merged, "b2")).toBe("Wrote 200 tests");
    expect(conflicts).toEqual([{ where: 'Line "Wrote 200 tests"', local: "Wrote 200 tests", server: "" }]);
  });

  it("an entry deleted here, while the other side edited one of its bullets, keeps that edit (conflict)", () => {
    const local = withoutIds(base, ["beta", "b4"]);
    const server = withText(base, "b4", "Ran a big study");
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(ids(merged)).not.toContain("beta");
    expect(textOf(merged, "b4")).toBe("Ran a big study");
    expect(conflicts).toHaveLength(1);
  });

  it("drops something both sides deleted", () => {
    const local = withoutIds(base, ["b2"]);
    const server = withoutIds(base, ["b2", "b3"]);
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(ids(merged)).not.toContain("b2");
    expect(ids(merged)).not.toContain("b3");
    expect(conflicts).toEqual([]);
  });

  it("takes the server's order when only the server reordered, keeping local edits", () => {
    const server = resumeOf(reverseIn(baseEntries(), ["b1", "b2", "b3"]));
    const local = withText(base, "b1", "Built a React dashboard");
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(ids(merged).filter((id) => BULLETS.includes(id))).toEqual(["b3", "b2", "b1"]);
    expect(textOf(merged, "b1")).toBe("Built a React dashboard");
  });

  it("keeps the local order when both reordered", () => {
    const server = resumeOf(reverseIn(baseEntries(), ["b1", "b2", "b3"]));
    const local = resumeOf(reverseIn(baseEntries(), ["b1", "b2"]));
    expect(ids(mergeResumes(base, local, server).merged).filter((id) => BULLETS.includes(id))).toEqual(["b2", "b1", "b3"]);
  });

  it("a paragraph moved on one side and edited on the other appears once, with the edit, where it was moved", () => {
    const moved = [...baseEntries().filter((e) => e.node.attrs.id !== "b3")];
    moved.splice(moved.findIndex((e) => e.node.attrs.id === "b4") + 1, 0, B("b3", "Fixed bugs"));
    const server = resumeOf(moved);
    const local = withText(base, "b3", "Fixed 40 bugs");
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(ids(merged).filter((id) => id === "b3")).toHaveLength(1);
    expect(textOf(merged, "b3")).toBe("Fixed 40 bugs");
    expect(ids(merged).indexOf("b3")).toBeGreaterThan(ids(merged).indexOf("b4"));
  });

  it("the legacy facts JSON is carried as the row has it, never merged", () => {
    const withFacts = { ...base, facts: ["Speaks Spanish", "Eagle Scout"] };
    const local = { ...withText(withFacts, "b2", "Wrote unit tests"), facts: ["Speaks Spanish", "Ran a 5k"] };
    const server = { ...withText(withFacts, "b3", "Fixed 40 bugs"), facts: ["Speaks Spanish"] };
    expect(mergeResumes(withFacts, local, server).merged.facts).toEqual(["Speaks Spanish"]);
    expect(mergeResumes(base, withText(base, "b2", "x"), withText(base, "b3", "y")).merged).not.toHaveProperty("facts");
  });

  it("page setup is local if it changed relative to base, else the server's", () => {
    const withPage = (r: Resume, marginTop: number) => ({ ...r, page: { marginTop, marginBottom: 0.5, marginLeft: 0.6, marginRight: 0.6 } });
    const b = withPage(base, 0.5);
    expect(mergeResumes(b, withPage(b, 0.8), withText(b, "b1", "x")).merged.page?.marginTop).toBe(0.8);
    expect(mergeResumes(b, withText(b, "b1", "x"), withPage(b, 0.9)).merged.page?.marginTop).toBe(0.9);
  });

  it("does not mutate its inputs", () => {
    const local = withText(base, "b1", "L");
    const server = withText(base, "b2", "S");
    const before = JSON.stringify([base, local, server]);
    mergeResumes(base, local, server);
    expect(JSON.stringify([base, local, server])).toBe(before);
  });
});

describe("mergeDocs", () => {
  it("merges the document alone: the same result as mergeResumes' document", () => {
    const base = resumeDoc(baseResume());
    const local = resumeDoc(withText(baseResume(), "b1", "L"));
    const server = resumeDoc(withText(baseResume(), "b2", "S"));
    const { doc, conflicts } = mergeDocs(base, local, server);
    expect(conflicts).toEqual([]);
    expect(flattenDoc(doc).map((p) => paragraphText(p.node))).toEqual(
      ["Ada Lovelace", "ada@example.com", "EXPERIENCE", "Acme\tNew York", "Intern\t2025", "L", "S", "Fixed bugs", "Beta\tBoston", "Ran a study", "EDUCATION", "State U", "GPA 3.9"],
    );
  });
});

describe("sameJson", () => {
  it("ignores key order and undefined keys", () => {
    expect(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameJson({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
  });
});

// ---------- updateMaster (job page: facts, "Save as master") ----------

describe("updateMaster", () => {
  const doc = (facts: string[]): Resume => ({ ...baseResume(), facts });

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
  const base = baseResume();

  it("writes directly when nobody else saved", async () => {
    const db = fakeDb({ content: base, updated_at: "t0" });
    const local = withText(base, "b1", "New");
    const out = await saveMasterDocument(db.client, "m1", local, { content: base, updatedAt: "t0" });
    expect(out).toEqual({ kind: "saved", content: local, updatedAt: "t-saved-1", merged: false });
    if (out.kind === "saved") expect(out.content).toBe(local);
    expect(db.calls.map((c) => c.op)).toEqual(["update"]);
  });

  it("two devices editing different paragraphs: merges, saves, and reports merged", async () => {
    const db = fakeDb({ content: base, updated_at: "t0" });
    db.otherSaves(withText(base, "b3", "Fixed 40 bugs (phone)"));
    const local = withText(base, "b1", "Built a dashboard (laptop)");
    const out = await saveMasterDocument(db.client, "m1", local, { content: base, updatedAt: "t0" });
    expect(out.kind).toBe("saved");
    if (out.kind !== "saved") return;
    expect(out.merged).toBe(true);
    expect(lines(db.row!.content).slice(5, 8)).toEqual(["Built a dashboard (laptop)", "Wrote tests", "Fixed 40 bugs (phone)"]);
    expect(out.content).toEqual(db.row!.content);
    expect(out.updatedAt).toBe(db.row!.updated_at);
    expect(db.calls.map((c) => c.op)).toEqual(["update", "select", "update"]);
  });

  it("'Save as master' from a job page isn't wiped by a stale master page", async () => {
    const db = fakeDb({ content: base, updated_at: "t0" });
    db.otherSaves(withText(base, "b1", "Tailored wording saved as master"));
    const local = withText(base, "contact", "new@example.com");
    await saveMasterDocument(db.client, "m1", local, { content: base, updatedAt: "t0" });
    expect(textOf(db.row!.content, "b1")).toBe("Tailored wording saved as master");
    expect(textOf(db.row!.content, "contact")).toBe("new@example.com");
  });

  it("a fact deleted on another device doesn't come back", async () => {
    const withFacts = { ...base, facts: ["Speaks Spanish", "Eagle Scout"] };
    const db = fakeDb({ content: withFacts, updated_at: "t0" });
    db.otherSaves({ ...withFacts, facts: ["Speaks Spanish"] });
    const local = withText(withFacts, "b2", "Wrote unit tests");
    await saveMasterDocument(db.client, "m1", local, { content: withFacts, updatedAt: "t0" });
    expect(db.row!.content.facts).toEqual(["Speaks Spanish"]);
  });

  it("same paragraph changed on both: returns the conflict and writes nothing", async () => {
    const db = fakeDb({ content: base, updated_at: "t0" });
    const theirs = withText(base, "b2", "Theirs");
    db.otherSaves(theirs);
    const before = db.row!.updated_at;
    const local = withText(base, "b2", "Mine");
    const out = await saveMasterDocument(db.client, "m1", local, { content: base, updatedAt: "t0" });
    expect(out.kind).toBe("conflict");
    if (out.kind !== "conflict") return;
    expect(out.conflicts).toEqual([{ where: 'Line "Mine"', local: "Mine", server: "Theirs" }]);
    expect(out.server).toEqual(theirs);
    expect(out.serverUpdatedAt).toBe(before);
    expect(db.row!.content).toEqual(theirs);
    expect(db.calls.map((c) => c.op)).toEqual(["update", "select"]);
  });

  it("'Keep mine' = merge with mine winning, rebased on their copy: then saves over theirs", async () => {
    const db = fakeDb({ content: base, updated_at: "t0" });
    const theirs = withText(withText(base, "b2", "Theirs"), "b4", "Their other change");
    db.otherSaves(theirs);
    const local = withText(base, "b2", "Mine");
    const first = await saveMasterDocument(db.client, "m1", local, { content: base, updatedAt: "t0" });
    if (first.kind !== "conflict") throw new Error("expected a conflict");
    const resolved = mergeResumes(base, local, first.server).merged;
    const out = await saveMasterDocument(db.client, "m1", resolved, { content: first.server, updatedAt: first.serverUpdatedAt });
    expect(out.kind).toBe("saved");
    expect(textOf(db.row!.content, "b2")).toBe("Mine");
    expect(textOf(db.row!.content, "b4")).toBe("Their other change");
  });

  it("skips the write when the server already has everything", async () => {
    const db = fakeDb({ content: base, updated_at: "t0" });
    const same = withText(base, "b1", "Both");
    db.otherSaves(same);
    const out = await saveMasterDocument(db.client, "m1", clone(same), { content: base, updatedAt: "t0" });
    expect(out).toMatchObject({ kind: "saved", updatedAt: db.row!.updated_at, merged: false });
    expect(db.calls.map((c) => c.op)).toEqual(["update", "select"]);
  });

  it("re-merges if another save lands between the merge and its write", async () => {
    const db = fakeDb({ content: base, updated_at: "t0" });
    const s1 = withText(base, "b3", "Phone 1");
    db.otherSaves(s1);
    // Right before our merged write, the phone saves again.
    db.hooks.push(() => {}); // first update (stale) fails on its own
    db.hooks.push(() => db.otherSaves(withText(s1, "b4", "Phone 2")));
    const local = withText(base, "b1", "Laptop");
    const out = await saveMasterDocument(db.client, "m1", local, { content: base, updatedAt: "t0" });
    expect(out.kind).toBe("saved");
    expect(textOf(db.row!.content, "b1")).toBe("Laptop");
    expect(textOf(db.row!.content, "b3")).toBe("Phone 1");
    expect(textOf(db.row!.content, "b4")).toBe("Phone 2");
    expect(db.calls.map((c) => c.op)).toEqual(["update", "select", "update", "select", "update"]);
  });

  it("throws a plain sentence on database errors (so autosave retries)", async () => {
    const db = fakeDb({ content: base, updated_at: "t0" }, { failWith: { code: "PGRST000", message: "upstream connect error" } });
    await expect(saveMasterDocument(db.client, "m1", base, { content: base, updatedAt: "t0" })).rejects.toThrow(
      "Couldn't save. Check your connection; we'll keep retrying.",
    );
  });

  it("throws when the row was deleted", async () => {
    const db = fakeDb(null);
    await expect(saveMasterDocument(db.client, "m1", base, { content: base, updatedAt: "t0" })).rejects.toThrow("deleted elsewhere");
  });
});

// ---------- formatting travels with its text ----------

describe("mergeResumes: formatting", () => {
  const base = baseResume();
  const bold = (text: string, id: string) => paragraph(text, { attrs: { id }, marks: [{ type: "bold" }] });

  it("a formatting-only change on one side merges with a text edit on the other", () => {
    const server = mapPara(base, "b2", (n) => bold(paragraphText(n), "b2"));
    const local = withText(base, "b1", "Built a React dashboard");
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(textOf(merged, "b1")).toBe("Built a React dashboard");
    expect(flattenDoc(resumeDoc(merged)).find((p) => p.id === "b2")!.node.content?.[0]).toMatchObject({ marks: [{ type: "bold" }] });
  });

  it("paragraph spacing on one side and new wording on another paragraph both survive", () => {
    const server = mapPara(base, "b2", (n) => ({ ...n, attrs: { ...n.attrs, spaceAfter: 6 } }));
    const local = withText(base, "b1", "Built a dashboard (laptop)");
    const merged = mergeResumes(base, local, server).merged;
    const p = flattenDoc(resumeDoc(merged)).find((x) => x.id === "b2")!;
    expect(textOf(merged, "b1")).toBe("Built a dashboard (laptop)");
    expect(p.node.attrs.spaceAfter).toBe(6);
  });

  it("the same paragraph re-spaced on one side and re-worded on the other is a conflict (local kept)", () => {
    const server = mapPara(base, "b2", (n) => ({ ...n, attrs: { ...n.attrs, spaceAfter: 6 } }));
    const local = withText(base, "b2", "Wrote unit tests");
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toHaveLength(1);
    expect(textOf(merged, "b2")).toBe("Wrote unit tests");
  });

  it("bold on one side and new wording on the other is one paragraph changed twice: a conflict, local kept", () => {
    const server = withText(base, "b3", "Fixed 40 bugs");
    const local = mapPara(base, "b3", (n) => bold(paragraphText(n), "b3"));
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([{ where: 'Line "Fixed bugs"', local: "Fixed bugs", server: "Fixed 40 bugs" }]);
    expect(textOf(merged, "b3")).toBe("Fixed bugs");
  });

  it("the same text with different formatting on both sides: no conflict, local wins", () => {
    const local = mapPara(base, "b2", (n) => bold(paragraphText(n), "b2"));
    const server = mapPara(base, "b2", (n) => ({ ...n, attrs: { ...n.attrs, spaceAfter: 12 } }));
    const { merged, conflicts } = mergeResumes(base, local, server);
    expect(conflicts).toEqual([]);
    expect(flattenDoc(resumeDoc(merged)).find((p) => p.id === "b2")!.node.content?.[0]).toMatchObject({ marks: [{ type: "bold" }] });
  });
});

// ---------- replacement (another tab re-imported or rebuilt the resume) ----------

/** A different resume: new names and lines, but the same "Fixed bugs" bullet and EXPERIENCE heading as the base. */
const otherResumeEntries = (): FlatEntry[] => [
  L("x-name", "Grace Hopper"),
  L("x-contact", "grace@example.org"),
  L("x-h-exp", "EXPERIENCE"),
  L("x-navy", "Navy\tArlington"),
  L("x-navy-sub", "Programmer\t1944"),
  B("x-1", "Compiled the first compiler"),
  B("x-2", "Led a team of twelve"),
  B("x-3", "Fixed bugs"),
  L("x-h-edu", "EDUCATION"),
  L("x-vassar", "Vassar"),
  B("x-4", "Math degree"),
];

describe("isReplacement", () => {
  it("a server copy that is the same document edited is not a replacement", () => {
    expect(isReplacement(baseResume(), baseResume())).toBe(false);
    expect(isReplacement(baseResume(), withText(baseResume(), "b2", "Wrote more tests"))).toBe(false);
    // Three of thirteen paragraphs edited by the other side: still the same document.
    const edited = ["b1", "b2", "b4"].reduce((r, id) => withText(r, id, `${id} edited`), baseResume());
    expect(isReplacement(baseResume(), edited)).toBe(false);
  });

  it("a server copy that only reordered or added paragraphs is not a replacement", () => {
    expect(isReplacement(baseResume(), resumeOf(reverseIn(baseEntries(), BULLETS)))).toBe(false);
    expect(isReplacement(baseResume(), insertAfter(baseResume(), "b1", [B("new", "Added a bullet")]))).toBe(false);
  });

  it("a re-import is a replacement, even when reconcileIds reused a few ids", () => {
    const reimported = reconcileIds(baseResume(), resumeOf(otherResumeEntries()));
    // The matching bullet and heading keep their ids, so this is not caught by ids alone.
    expect(ids(reimported)).toEqual(expect.arrayContaining(["h-exp", "b3"]));
    expect(isReplacement(baseResume(), reimported)).toBe(true);
  });

  it("a completely different resume is a replacement", () => {
    expect(isReplacement(baseResume(), resumeOf(otherResumeEntries()))).toBe(true);
  });

  it("threshold: below half of the base's paragraphs unchanged is a replacement, exactly half is not", () => {
    const four = resumeOf([L("a", "A"), L("b", "B"), L("c", "C"), L("d", "D")]);
    // Two of four kept (a, b with the same text): exactly half, not a replacement.
    const half = resumeOf([L("a", "A"), L("b", "B"), L("c", "changed"), L("d", "changed")]);
    expect(isReplacement(four, half)).toBe(false);
    // One of four kept: below half.
    const quarter = resumeOf([L("a", "A"), L("c", "changed"), L("d", "changed"), L("z", "new")]);
    expect(isReplacement(four, quarter)).toBe(true);
  });

  it("a kept id with changed text, formatting or list placement does not count as kept", () => {
    const four = resumeOf([L("a", "A"), L("b", "B"), L("c", "C"), L("d", "D")]);
    const restyled = mapPara(four, "a", (n) => paragraph(paragraphText(n), { attrs: { id: "a" }, marks: [{ type: "bold" }] }));
    const asBullet = resumeOf([B("a", "A"), L("b", "B"), L("c", "C"), L("d", "D")]);
    // Three of four still match (b, c, d): not a replacement.
    expect(isReplacement(four, restyled)).toBe(false);
    // a is a bullet now: 3 of 4 still kept.
    expect(isReplacement(four, asBullet)).toBe(false);
    const twoOfFourKept = resumeOf([L("a", "A"), L("b", "B"), B("c", "C"), B("d", "D")]);
    expect(isReplacement(four, twoOfFourKept)).toBe(false);
    const oneOfFourKept = resumeOf([L("a", "A"), B("b", "B"), B("c", "C"), B("d", "D")]);
    expect(isReplacement(four, oneOfFourKept)).toBe(true);
  });

  it("a blank master that another tab filled in is a replacement, not a blend", () => {
    expect(isReplacement(resumeOf([]), baseResume())).toBe(true);
  });
});

describe("keepMineVersion", () => {
  it("against a replacement, keeps my version exactly, with none of theirs", () => {
    const base = baseResume();
    const local = withText(base, "b2", "Wrote tests for the importer");
    const server = resumeOf(otherResumeEntries());
    expect(keepMineVersion(base, local, server)).toEqual(local);
  });

  it("against a same-document edit, is the three-way merge with mine winning", () => {
    const base = baseResume();
    const local = withText(base, "b2", "Mine");
    const server = withText(withText(base, "b2", "Theirs"), "b4", "Their other change");
    expect(keepMineVersion(base, local, server)).toEqual(mergeResumes(base, local, server).merged);
    expect(lines(keepMineVersion(base, local, server))).toContain("Their other change");
  });
});

describe("saveMasterDocument: replaced resume", () => {
  it("my edit against a replaced master: a replacement conflict, nothing written", async () => {
    const base = baseResume();
    const db = fakeDb({ content: base, updated_at: "t0" });
    const theirs = resumeOf(otherResumeEntries());
    db.otherSaves(theirs);
    const before = db.row!.updated_at;
    const out = await saveMasterDocument(db.client, "m1", withText(base, "b2", "Mine"), { content: base, updatedAt: "t0" });
    expect(out).toEqual({ kind: "conflict", server: theirs, serverUpdatedAt: before, conflicts: [], replaced: true });
    expect(db.row!.content).toEqual(theirs);
  });

  it("Keep mine after a replacement saves exactly my version over theirs", async () => {
    const base = baseResume();
    const db = fakeDb({ content: base, updated_at: "t0" });
    db.otherSaves(resumeOf(otherResumeEntries()));
    const local = withText(base, "b2", "Mine");
    const first = await saveMasterDocument(db.client, "m1", local, { content: base, updatedAt: "t0" });
    if (first.kind !== "conflict") throw new Error("expected a conflict");
    const resolved = keepMineVersion(base, local, first.server);
    const out = await saveMasterDocument(db.client, "m1", resolved, { content: first.server, updatedAt: first.serverUpdatedAt });
    expect(out.kind).toBe("saved");
    expect(db.row!.content).toEqual(local);
  });

  it("I have no edits of my own: the replacement is taken as is, no conflict", async () => {
    const base = baseResume();
    const db = fakeDb({ content: base, updated_at: "t0" });
    const theirs = resumeOf(otherResumeEntries());
    db.otherSaves(theirs);
    const out = await saveMasterDocument(db.client, "m1", base, { content: base, updatedAt: "t0" });
    expect(out).toMatchObject({ kind: "saved", content: theirs, merged: true });
  });

  it("the same document edited by another tab (few paragraphs changed) still merges as before", async () => {
    const base = baseResume();
    const db = fakeDb({ content: base, updated_at: "t0" });
    db.otherSaves(withText(base, "b4", "Their change"));
    const out = await saveMasterDocument(db.client, "m1", withText(base, "b2", "Mine"), { content: base, updatedAt: "t0" });
    expect(out).toMatchObject({ kind: "saved", merged: true });
    expect(textOf(db.row!.content, "b2")).toBe("Mine");
    expect(textOf(db.row!.content, "b4")).toBe("Their change");
  });
});
