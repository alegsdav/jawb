import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Analysis, Fact, Resume } from "@/lib/types";
import {
  diffFactTexts, factRow, factsForGuard, factsForPrompt, freshFacts, importedBulletFacts, legacyFacts, planMirror, relevantFacts,
} from "@/lib/facts";
import { factListWriter, insertFacts, loadFacts, mirrorFacts, unlinkResumeFacts } from "@/lib/factStore";
import { saveAnswersInOrder } from "@/lib/analysis";
import { checkExtractedFacts } from "@/lib/coaching";

let n = 0;
const fact = (text: string, over: Partial<Fact> = {}): Fact => ({
  id: `f${++n}`, text, source: "manual", active: !/\[[^\]\n]+\]/.test(text), resume_id: null, bullet_id: null, entry_id: null,
  created_at: `2026-01-01T00:00:${String(n).padStart(2, "0")}Z`, updated_at: "", ...over,
});

const resume = (bullets: Record<string, string[]>): Resume => ({
  version: 2,
  header: { name: "Ann", contact: "" },
  sections: [
    {
      id: "s",
      title: "Experience",
      items: Object.entries(bullets).map(([iid, texts]) => ({
        id: iid, title: iid, subtitle: "", location: "", dates: "",
        bullets: texts.map((t, i) => ({ id: `${iid}b${i}`, text: t })),
      })),
    },
  ],
});

/** Fake Supabase `facts` table (select/insert/update/delete with eq/in), like the real RLS-scoped one. */
function factsDb(initial: Fact[] = [], opts: { missing?: boolean; failUpdate?: boolean } = {}) {
  const rows = initial.map((f) => ({ ...f }));
  const calls: { op: string; patch?: unknown; filter?: unknown }[] = [];
  const client = {
    from(table: string) {
      expect(table).toBe("facts");
      let op = "select";
      let payload: unknown = null;
      const filters: [string, unknown, "eq" | "in"][] = [];
      const match = (r: Record<string, unknown>) =>
        filters.every(([k, v, how]) => (how === "eq" ? r[k] === v : (v as unknown[]).includes(r[k])));
      const q = {
        select: () => q,
        order: () => q,
        insert: (v: unknown) => ((op = "insert"), (payload = v), q),
        update: (v: unknown) => ((op = "update"), (payload = v), q),
        delete: () => ((op = "delete"), q),
        eq: (k: string, v: unknown) => (filters.push([k, v, "eq"]), q),
        in: (k: string, v: unknown[]) => (filters.push([k, v, "in"]), q),
        then: (res: (v: unknown) => unknown) => {
          if (opts.missing) return Promise.resolve({ data: null, error: { code: "42P01", message: 'relation "public.facts" does not exist' } }).then(res);
          calls.push({ op, patch: payload, filter: filters.map(([k, v]) => [k, v]) });
          if (op === "select") return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(res);
          if (op === "insert") {
            const made = (payload as Record<string, unknown>[]).map((p) => fact(String(p.text), p as Partial<Fact>));
            rows.push(...made);
            return Promise.resolve({ data: made, error: null }).then(res);
          }
          if (op === "update") {
            if (opts.failUpdate) return Promise.resolve({ data: null, error: { message: "fetch failed" } }).then(res);
            for (const r of rows) if (match(r as unknown as Record<string, unknown>)) Object.assign(r, payload);
            return Promise.resolve({ data: null, error: null }).then(res);
          }
          for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i] as unknown as Record<string, unknown>)) rows.splice(i, 1);
          return Promise.resolve({ data: null, error: null }).then(res);
        },
      };
      return q;
    },
  };
  return { rows, calls, client: client as unknown as SupabaseClient };
}

beforeEach(() => {
  n = 0;
});

describe("planMirror: linked facts follow their bullet", () => {
  const r = resume({ i1: ["Built a tool for 300 students", "Led a team of [N]"], i2: ["Tutored calculus"] });

  it("mirrors an edited bullet's text into its fact", () => {
    const f = fact("Built a tool", { resume_id: "R", bullet_id: "i1b0", entry_id: "i1", source: "resume" });
    expect(planMirror([f], "R", r)).toEqual([{ id: f.id, patch: { text: "Built a tool for 300 students" } }]);
  });

  it("an emptied or deleted bullet unlinks the fact and keeps its last text", () => {
    const emptied = resume({ i1: ["   ", "Led a team of [N]"], i2: ["Tutored calculus"] });
    const f = fact("Built a tool for 300 students", { resume_id: "R", bullet_id: "i1b0", entry_id: "i1" });
    expect(planMirror([f], "R", emptied)).toEqual([{ id: f.id, patch: { resume_id: null, bullet_id: null } }]);
    const deleted = resume({ i2: ["Tutored calculus"] });
    expect(planMirror([f], "R", deleted)).toEqual([{ id: f.id, patch: { resume_id: null, bullet_id: null, entry_id: null } }]);
  });

  it("a draft with a [placeholder] becomes active once the bullet is filled in, and a draft again if one comes back", () => {
    const f = fact("Led a team of [N]", { resume_id: "R", bullet_id: "i1b1", entry_id: "i1", source: "coaching" });
    expect(f.active).toBe(false);
    const filled = resume({ i1: ["Built a tool for 300 students", "Led a team of 6"], i2: [] });
    expect(planMirror([f], "R", filled)).toEqual([{ id: f.id, patch: { text: "Led a team of 6", active: true } }]);
    const back = fact("Led a team of 6", { resume_id: "R", bullet_id: "i1b1", entry_id: "i1" });
    expect(planMirror([back], "R", r)).toEqual([{ id: back.id, patch: { text: "Led a team of [N]", active: false } }]);
  });

  it("follows a bullet moved to another entry, ignores other resumes, and is quiet when nothing changed", () => {
    const moved = resume({ i1: [], i2: ["Tutored calculus"] });
    moved.sections[0].items[1].bullets.push({ id: "i1b0", text: "Built a tool for 300 students" });
    const f = fact("Built a tool for 300 students", { resume_id: "R", bullet_id: "i1b0", entry_id: "i1" });
    expect(planMirror([f], "R", moved)).toEqual([{ id: f.id, patch: { entry_id: "i2" } }]);
    const other = fact("Something", { resume_id: "OTHER", bullet_id: "i1b0" });
    expect(planMirror([other], "R", r)).toEqual([]);
    const same = fact("Tutored calculus", { resume_id: "R", bullet_id: "i2b0", entry_id: "i2" });
    expect(planMirror([same], "R", r)).toEqual([]);
  });

  it("a fact linked only to an entry is unlinked when the entry is deleted", () => {
    const f = fact("Ran the club's budget", { resume_id: "R", entry_id: "gone", source: "builder" });
    expect(planMirror([f], "R", r)).toEqual([{ id: f.id, patch: { resume_id: null, entry_id: null } }]);
  });
});

describe("saving with mirroring", () => {
  it("mirrorFacts writes the plan and returns the updated list (a failed write throws so autosave retries)", async () => {
    const f = fact("Old wording", { resume_id: "R", bullet_id: "i1b0", entry_id: "i1" });
    const db = factsDb([f]);
    const r = resume({ i1: ["New wording"] });
    const next = await mirrorFacts(db.client, [f], "R", r);
    expect(next[0].text).toBe("New wording");
    expect(db.rows[0].text).toBe("New wording");
    expect(await mirrorFacts(db.client, next, "R", r)).toBe(next); // nothing to do: no write
    const failing = factsDb([f], { failUpdate: true });
    await expect(mirrorFacts(failing.client, [f], "R", r)).rejects.toThrow("Couldn't save. Check your connection; we'll keep retrying.");
  });

  it("deleting a job turns its coached facts into standalone facts", async () => {
    const coached = fact("Cut grading time by 40%", { resume_id: "TAILORED", bullet_id: "b9", source: "coaching" });
    const other = fact("Speaks Spanish");
    const db = factsDb([coached, other]);
    await unlinkResumeFacts(db.client, "TAILORED");
    expect(db.rows.find((x) => x.id === coached.id)).toMatchObject({ text: "Cut grading time by 40%", resume_id: null, bullet_id: null });
    // ...and the database does the same on delete (trigger + "on delete set null").
    const sql = readFileSync("supabase/migrations/0005_facts.sql", "utf8");
    expect(sql).toMatch(/resume_id uuid references public\.resumes\(id\) on delete set null/);
    expect(sql).toMatch(/if new\.resume_id is null then new\.bullet_id = null; end if;/);
  });
});

describe("dedupe and drafts", () => {
  it("new facts skip blanks and case/whitespace duplicates of existing ones and of each other", async () => {
    const db = factsDb([fact("Fluent in Spanish")]);
    const res = await insertFacts(
      db.client,
      [
        { text: "  fluent in  spanish ", source: "manual" },
        { text: "", source: "manual" },
        { text: "Eagle Scout", source: "manual" },
        { text: "eagle scout", source: "extracted" },
      ],
      db.rows,
    );
    expect(res.ok && res.value.map((f) => f.text)).toEqual(["Eagle Scout"]);
    expect(freshFacts([{ text: " A " }, { text: "a" }], [])).toEqual([{ text: "A" }]);
  });

  it("a fact with a [placeholder] is saved as a draft (inactive), and links need a resume", () => {
    expect(factRow({ text: "Led a team of [N]", source: "coaching", resume_id: "R", bullet_id: "b1" })).toMatchObject({ active: false, bullet_id: "b1" });
    expect(factRow({ text: "Led a team of 6", source: "coaching", bullet_id: "b1" })).toMatchObject({ active: true, resume_id: null, bullet_id: null });
  });

  it("importing a resume makes a linked fact of every non-empty bullet that has none yet", () => {
    const r = resume({ i1: ["Built a tool", "  ", "Led a team"] });
    const have = [fact("Built a tool", { resume_id: "M", bullet_id: "i1b0" })];
    expect(importedBulletFacts(r, "M", have)).toEqual([
      { text: "Led a team", source: "resume", resume_id: "M", bullet_id: "i1b2", entry_id: "i1" },
    ]);
  });
});

describe("which facts the AI sees", () => {
  const r = resume({ i1: ["Built a tool for 300 students"] });

  it("prompts get active facts only, minus any that read exactly like a bullet on the resume", () => {
    const facts = [
      fact("built a tool  for 300 students", { source: "resume", resume_id: "M", bullet_id: "i1b0" }),
      fact("Grew sign-ups by [X%]"),
      fact("Speaks Spanish"),
    ];
    expect(factsForPrompt(facts, r).map((f) => f.text)).toEqual(["Speaks Spanish"]);
  });

  it("the number guard doesn't share facts linked to one of this resume's bullets", () => {
    const linked = fact("Built a tool for 300 students used by 45 TAs", { resume_id: "M", bullet_id: "i1b0" });
    const elsewhere = fact("Mentored 12 first-years", { resume_id: "JOB2", bullet_id: "zz" });
    expect(factsForPrompt([linked, elsewhere], r)).toHaveLength(2);
    expect(factsForGuard([linked, elsewhere], r)).toEqual([elsewhere]);
  });

  it("coaching gets facts for that entry first, then the most recent others, capped", () => {
    const mine = fact("A", { entry_id: "i1" });
    const bulletFact = fact("B", { bullet_id: "i1b0", resume_id: "M" });
    const old = fact("C");
    const recent = fact("D");
    const draft = fact("E [N]");
    expect(relevantFacts([old, mine, recent, bulletFact, draft], { id: "i1", bulletIds: ["i1b0"] }, 3).map((f) => f.text)).toEqual(["A", "B", "D"]);
  });
});

describe("legacy facts (migration 0005)", () => {
  it("maps the old content.facts list like the migration: strings, trimmed, no blanks, no duplicates", () => {
    expect(legacyFacts({ facts: [" Speaks Spanish ", "speaks  spanish", 42, null, "", "Eagle Scout"] })).toEqual(["Speaks Spanish", "Eagle Scout"]);
    expect(legacyFacts({ sections: [] })).toEqual([]);
    expect(legacyFacts(null)).toEqual([]);
  });

  it("the migration copies them once (idempotent), as 'legacy', drafts inactive, master only, and leaves the JSON alone", () => {
    const sql = readFileSync("supabase/migrations/0005_facts.sql", "utf8");
    expect(sql).toMatch(/'legacy'/);
    expect(sql).toMatch(/where r\.is_master/);
    expect(sql).toMatch(/jsonb_typeof\(e\.item\) = 'string'/);
    expect(sql).toMatch(/btrim\(f\.value\) !~ '\\\[\[\^\]\\n\]\+\\\]'/);
    expect(sql).toMatch(/and not exists \(/);
    expect(sql).not.toMatch(/update public\.resumes/);
    expect(sql).toMatch(/alter table public\.facts enable row level security/);
  });

  it("without the facts table, loading says so instead of failing", async () => {
    expect(await loadFacts(factsDb([], { missing: true }).client)).toEqual({ facts: [], missing: true, error: null });
  });
});

describe("answers as facts (saveAnswersInOrder over the facts table)", () => {
  const analysis: Analysis = {
    fit: "possible", verdict: "", keywords: { matched: [], missing: [] }, strengths: [], gaps: [], bullets: [],
    questions: [{ id: "q1", question: "Have you used SQL in any class?", why: "" }],
  };

  it("adds the answer's fact, replaces it when the answer changes, and never deletes facts that follow a bullet", async () => {
    const linked = fact("Used SQL in any class: Yes", { resume_id: "M", bullet_id: "b1" });
    const db = factsDb([linked]);
    const write = factListWriter(db.client, "answer");
    const first = await saveAnswersInOrder({ analysis, answers: { q1: "Yes, in DS 3000" }, writeMaster: write, persist: () => {} });
    expect(first.ok).toBe(true);
    expect(db.rows.map((f) => [f.text, f.source])).toEqual([
      ["Used SQL in any class: Yes", "manual"],
      ["Used SQL in any class: Yes, in DS 3000", "answer"],
    ]);
    const prevAnalysis = { ...analysis, answers: { q1: "Yes, in DS 3000" } };
    const second = await saveAnswersInOrder({ analysis: prevAnalysis, answers: { q1: "Yes" }, writeMaster: write, persist: () => {} });
    expect(second.ok).toBe(true);
    // The old answer's fact is gone; "Yes" already exists as a (linked) fact, so it isn't added twice.
    expect(db.rows.map((f) => f.text)).toEqual(["Used SQL in any class: Yes"]);
    expect(db.rows[0].id).toBe(linked.id);
  });

  it("before migration 0005, saving answers stops with the database-update message and saves no answers", async () => {
    const persist = vi.fn();
    const res = await saveAnswersInOrder({
      analysis, answers: { q1: "Yes" }, writeMaster: factListWriter(factsDb([], { missing: true }).client, "answer"), persist,
    });
    expect(res).toMatchObject({ ok: false, stage: "master", error: expect.stringMatching(/^Database update needed/) });
    expect(persist).not.toHaveBeenCalled();
  });

  it("diffFactTexts compares normalized text", () => {
    expect(diffFactTexts(["A", "b"], ["a ", "C"])).toEqual({ add: ["C"], remove: ["b"] });
  });
});

describe("extracted facts", () => {
  const answer = "I tutored about 20 students a week in calc, for two semesters, using Desmos.";

  it("keeps facts that only restate the answer's numbers and drops any with an invented number", () => {
    const { kept, dropped } = checkExtractedFacts(
      {
        facts: [
          "Tutored about 20 students a week in calculus",
          "Tutored calculus for two semesters",
          "Raised average exam scores by 15%", // invented
          "Tutored 25 students", // changed number
          "Tutored dozens of students", // invented number word
          "Used Desmos to teach graphing",
          "Tutored about 20 students a week in calculus", // duplicate
          "Helped [N] students", // placeholder
          42,
        ],
      },
      answer,
    );
    expect(kept).toEqual(["Tutored about 20 students a week in calculus", "Tutored calculus for two semesters", "Used Desmos to teach graphing"]);
    expect(dropped).toBe(3);
  });

  it("copes with junk replies", () => {
    expect(checkExtractedFacts(null, answer)).toEqual({ kept: [], dropped: 0 });
    expect(checkExtractedFacts({ facts: "nope" }, answer)).toEqual({ kept: [], dropped: 0 });
    expect(checkExtractedFacts(["Used Desmos"], answer).kept).toEqual(["Used Desmos"]);
  });
});
