import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDraftResume, builderFacts, builderStepErrors, emptyBuilder, newExperience, parseBuilderInput, readBuilder, type BuilderState,
} from "@/lib/builder";
import { flattenDoc } from "@/lib/doc/model";
import { resumeDoc } from "@/lib/resume";
import { HARVARD_PAGE } from "@/lib/template";
import type { Resume } from "@/lib/types";

const h = vi.hoisted(() => ({
  reply: null as unknown,
  prompt: "",
  inserted: [] as Record<string, unknown>[],
  rpcs: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/server", () => ({
  requireUser: async () => ({
    user: { id: "u", email: "a@b.c" },
    supabase: {
      rpc: async (name: string, args: Record<string, unknown>) => (h.rpcs.push({ name, ...args }), { data: name === "reserve_ai_call" ? "r" : null, error: null }),
      from(table: string) {
        let insert: Record<string, unknown>[] | null = null;
        const q = {
          select: () => q,
          eq: () => q,
          order: () => q,
          maybeSingle: () => q,
          insert: (v: Record<string, unknown>[]) => ((insert = v), q),
          then: (res: (v: unknown) => unknown) => {
            if (insert) {
              const rows = insert.map((r, i) => ({ id: `f${i}`, created_at: "", updated_at: "", ...r }));
              h.inserted.push(...rows);
              return Promise.resolve({ data: rows, error: null }).then(res);
            }
            if (table === "resumes") return Promise.resolve({ data: { id: "MASTER" }, error: null }).then(res);
            return Promise.resolve({ data: [], error: null }).then(res);
          },
        };
        return q;
      },
    },
  }),
}));
vi.mock("@/lib/gemini", () => ({ geminiJSON: async (prompt: string) => ((h.prompt = prompt), h.reply) }));

import { POST } from "@/app/api/builder/draft/route";

const answers = (): BuilderState => ({
  ...emptyBuilder("jo@college.edu"),
  step: 3,
  about: {
    name: "Jordan Lee", email: "jo@college.edu", phone: "555-010-2000", location: "Boston, MA", links: "github.com/jlee",
    school: "Northeastern University", degree: "B.S.", major: "Data Science", graduation: "May 2027", gpa: "3.7",
  },
  experiences: [
    { id: "x1", type: "job", org: "Learning Center", role: "Math Tutor", start: "Sep 2024", end: "", location: "Boston, MA", what: "I tutor about 20 students a week in calculus and made study guides." },
    { id: "x2", type: "project", org: "Bus Tracker", role: "Python, Flask", start: "", end: "Spring 2025", location: "", what: "Built a web app that shows when campus shuttles arrive." },
    { id: "x3", type: "club", org: "Robotics Club", role: "Treasurer", start: "2024", end: "2025", location: "", what: "Managed the club budget and ordered parts for the team." },
  ],
  skills: { languages: "Python, SQL", tools: "Excel, Git", other: "" },
});

/** The paragraph whose text is `text` (the builder's lines are unique). */
const paraNamed = (r: Resume, text: string) => {
  const p = flattenDoc(resumeDoc(r)).find((x) => x.text === text);
  if (!p) throw new Error(`no paragraph "${text}"`);
  return p;
};
/** The font mark every Harvard line carries. */
const TIMES = (size: string) => [{ type: "textStyle", attrs: { fontFamily: "Times New Roman", fontSize: size } }];

describe("builder output", () => {
  it("builds a Harvard-format document from the answers; the AI only supplies bullets, number-checked per experience", () => {
    const r = buildDraftResume(answers(), {
      bullets: {
        x1: ["Tutored about 20 students a week in calculus", "Raised exam scores 30% with study guides"],
        x2: ["Built a Flask web app showing shuttle arrival times for 2,000 riders"],
        x3: [],
        stray: ["Never shown"],
      },
    });
    expect(r.version).toBe(4);
    expect(r.page).toEqual(HARVARD_PAGE);
    expect(r.header).toEqual({ name: "Jordan Lee", contact: "Boston, MA • jo@college.edu • 555-010-2000 • github.com/jlee" });
    expect(r.sections.map((s) => s.title)).toEqual(["EDUCATION", "EXPERIENCE", "PROJECTS", "LEADERSHIP & ACTIVITIES", "SKILLS"]);
    expect(r.sections[0].items[0]).toMatchObject({ title: "Northeastern University", subtitle: "B.S. in Data Science", dates: "May 2027" });
    expect(r.sections[0].items[0].bullets.map((b) => b.text)).toEqual(["GPA: 3.7"]);
    const tutor = r.sections[1].items[0];
    expect(tutor).toMatchObject({ id: "x1", title: "Learning Center", subtitle: "Math Tutor", location: "Boston, MA", dates: "Sep 2024 – Present" });
    expect(tutor.bullets.map((b) => b.text)).toEqual(["Tutored about 20 students a week in calculus", "Raised exam scores [X%] with study guides"]);
    expect(r.sections[2].items[0]).toMatchObject({ id: "x2", title: "Bus Tracker", dates: "Spring 2025" });
    expect(r.sections[2].items[0].bullets.map((b) => b.text)).toEqual(["Built a Flask web app showing shuttle arrival times for [N] riders"]);
    expect(r.sections[3].items[0].bullets.map((b) => b.text)).toEqual(["[What you did and what came of it]"]);
    expect(r.sections[4].items.map((it) => it.title)).toEqual(["Languages: Python, SQL", "Tools: Excel, Git"]);
    // Every paragraph id is present and unique.
    const ids = flattenDoc(resumeDoc(r)).map((p) => p.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the Harvard look on every line: Times New Roman, sizes, centered name, rules, tabs, italic roles, bullets", () => {
    const r = buildDraftResume(answers(), { bullets: { x1: ["Tutored about 20 students a week in calculus"] } });
    expect(paraNamed(r, "Jordan Lee")).toMatchObject({ node: { attrs: { textAlign: "center" } } });
    expect(paraNamed(r, "Jordan Lee").node.content).toEqual([{ type: "text", text: "Jordan Lee", marks: [{ type: "bold" }, ...TIMES("16pt")] }]);
    expect(paraNamed(r, "Boston, MA • jo@college.edu • 555-010-2000 • github.com/jlee").node).toMatchObject({ attrs: { textAlign: "center" } });
    const heading = paraNamed(r, "EXPERIENCE");
    expect(heading.node.attrs).toMatchObject({ borderBottom: true, spaceBefore: 10 });
    expect(heading.node.content).toEqual([{ type: "text", text: "EXPERIENCE", marks: [{ type: "bold" }, ...TIMES("11pt")] }]);
    const entry = paraNamed(r, "Learning Center\tBoston, MA");
    expect(entry.node.content?.map((n) => n.type)).toEqual(["text", "tab", "text"]);
    expect(entry.node.content?.[0]).toMatchObject({ marks: [{ type: "bold" }, ...TIMES("11pt")] });
    const role = paraNamed(r, "Math Tutor\tSep 2024 – Present");
    expect(role.node.content?.[0]).toMatchObject({ text: "Math Tutor", marks: [{ type: "italic" }, ...TIMES("11pt")] });
    expect(paraNamed(r, "Tutored about 20 students a week in calculus")).toMatchObject({ listType: "bulletList", depth: 1 });
    expect(paraNamed(r, "Languages: Python, SQL").node.content?.[0]).toMatchObject({ text: "Languages: ", marks: [{ type: "bold" }, ...TIMES("11pt")] });
  });

  it("entry ids are the experience ids, and every entry after the first in its section is spaced", () => {
    const a = answers();
    a.experiences = [a.experiences[0], { ...a.experiences[0], id: "x4", org: "Second Co", role: "Analyst", start: "", end: "", location: "" }];
    const r = buildDraftResume(a, "nonsense");
    expect(r.sections[1].items.map((it) => [it.id, it.title])).toEqual([["x1", "Learning Center"], ["x4", "Second Co"]]);
    expect(paraNamed(r, "Second Co\t").node.attrs).toMatchObject({ spaceBefore: 4 });
    expect(paraNamed(r, "Learning Center\tBoston, MA").node.attrs?.spaceBefore).toBeUndefined();
  });

  it("copes with a junk reply and leaves out empty sections", () => {
    const a = answers();
    a.experiences = [a.experiences[0]];
    a.skills = { languages: "", tools: "", other: "" };
    a.about.gpa = "";
    const r = buildDraftResume(a, "nonsense");
    expect(r.sections.map((s) => s.title)).toEqual(["EDUCATION", "EXPERIENCE"]);
    expect(r.sections[0].items[0].bullets).toEqual([]);
    expect(r.sections[1].items[0].bullets.map((b) => b.text)).toEqual(["[What you did and what came of it]"]);
  });

  it("raw answers become builder facts linked to their entries on the master", () => {
    expect(builderFacts(answers(), "M")[0]).toEqual({
      text: "Math Tutor, Learning Center: I tutor about 20 students a week in calculus and made study guides.",
      source: "builder",
      resume_id: "M",
      entry_id: "x1",
    });
    expect(builderFacts(answers(), null)[0]).toMatchObject({ resume_id: null, entry_id: null });
  });
});

describe("wizard steps", () => {
  it("step 1 needs name, a valid email, school, degree, major and graduation; GPA is optional", () => {
    const s = emptyBuilder("");
    expect(Object.keys(builderStepErrors(s, 1)).sort()).toEqual(["degree", "email", "graduation", "major", "name", "school"]);
    expect(builderStepErrors(answers(), 1)).toEqual({});
    const bad = answers();
    bad.about.gpa = "four";
    expect(builderStepErrors(bad, 1)).toEqual({ gpa: "Enter a GPA like 3.6, or leave it empty." });
  });

  it("step 2 needs at least one experience, each with a name and a few sentences", () => {
    const s = answers();
    expect(builderStepErrors(s, 2)).toEqual({});
    s.experiences = [{ ...newExperience(), org: "", what: "Did stuff" }];
    expect(builderStepErrors(s, 2)).toEqual({
      "exp0.org": "Enter the organization.",
      "exp0.what": "Write a few sentences about what you actually did.",
    });
    s.experiences = [];
    expect(builderStepErrors(s, 2)).toHaveProperty("experiences");
    expect(builderStepErrors(s, 3)).toEqual({});
  });

  it("saved answers come back after a refresh; junk is ignored", () => {
    const saved = JSON.stringify({ ...answers(), step: 2 });
    expect(readBuilder(saved)).toMatchObject({ step: 2, about: { name: "Jordan Lee" } });
    expect(readBuilder("{not json")).toBeNull();
    expect(readBuilder(JSON.stringify({ step: 9 }))).toBeNull();
    expect(readBuilder(null)).toBeNull();
  });

  it("the server reads the answers defensively", () => {
    expect(parseBuilderInput({ about: { name: "" }, experiences: [] })).toBeNull();
    const p = parseBuilderInput({ ...answers(), experiences: [...answers().experiences, { type: "spy", org: "X", what: "Y" }, { org: "", what: "" }] })!;
    expect(p.experiences.map((x) => x.type)).toEqual(["job", "project", "club", "job"]);
  });
});

describe("POST /api/builder/draft", () => {
  beforeEach(() => {
    h.inserted = [];
    h.rpcs = [];
    h.reply = { bullets: { x1: ["Tutored about 20 students a week in calculus"] } };
  });

  it("is a heavy call, returns the resume, and saves the raw answers as builder facts", async () => {
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify(answers()) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resume.sections[1].items[0].bullets[0].text).toBe("Tutored about 20 students a week in calculus");
    expect(h.rpcs.find((r) => r.name === "reserve_ai_call")).toMatchObject({ p_action: "builder_draft", p_weight: "heavy" });
    expect(h.inserted.map((f) => [f.source, f.resume_id, f.entry_id])).toEqual([
      ["builder", "MASTER", "x1"],
      ["builder", "MASTER", "x2"],
      ["builder", "MASTER", "x3"],
    ]);
    expect(h.prompt).toMatch(/Use ONLY what the student wrote for THAT experience/);
  });

  it("400 without a name or any experience", async () => {
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ about: {}, experiences: [] }) }));
    expect(res.status).toBe(400);
  });
});
