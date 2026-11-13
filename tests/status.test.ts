import { describe, expect, it, vi } from "vitest";
import {
  applyStatusChange, findDuplicateJob, normalizeJobUrl, placeholderQuestion, UNSUBMIT_QUESTION, visibleTexts,
} from "@/lib/status";
import { plural } from "@/lib/facts";
import { reachedInterview, snapshotPatch, tailoringStats } from "@/lib/outcomes";
import type { Job, JobStatus, Resume } from "@/lib/types";

const now = new Date(2026, 10, 13, 20, 0); // Nov 13, 8pm local

const resume = (bullet: string, extra: Partial<Resume> = {}): Resume => ({
  version: 2,
  header: { name: "Ada", contact: "ada@example.com" },
  sections: [
    { id: "s", title: "Experience", items: [{ id: "i", title: "Acme", subtitle: "Intern", location: "", dates: "", bullets: [{ id: "b", text: bullet }] }] },
  ],
  ...extra,
});

const master = resume("Built a dashboard", { facts: ["Secret fact"] });
const tailored = resume("Built a React dashboard", { baseline: { b: "Built a dashboard" } });

type J = Pick<Job, "status" | "submitted_at" | "date_applied" | "reached_interview">;
const fresh: J = { status: "to_apply", submitted_at: null, date_applied: null, reached_interview: false };
const sent: J = { status: "applied", submitted_at: "2026-11-01T15:00:00Z", date_applied: "2026-11-01", reached_interview: false };

const change = (job: J, next: JobStatus, opts: { sentResume?: Resume | null; master?: Resume | null; answer?: boolean | boolean[] } = {}) => {
  const answers = Array.isArray(opts.answer) ? [...opts.answer] : null;
  const confirm = vi.fn(async (message: string): Promise<boolean> => (void message, answers ? answers.shift() ?? true : (opts.answer as boolean | undefined) ?? true));
  const p = applyStatusChange({
    job,
    next,
    sentResume: opts.sentResume === undefined ? tailored : opts.sentResume,
    master: opts.master === undefined ? master : opts.master,
    confirm,
    now,
  });
  return { p, confirm };
};

describe("applyStatusChange: first move into a sent status", () => {
  it.each(["applied", "interview", "offer", "rejected"] as const)("into %s: snapshot + dates", async (next) => {
    const { p, confirm } = change(fresh, next);
    const patch = await p;
    expect(patch).toMatchObject({
      status: next,
      submitted_tailored: true,
      date_applied: "2026-11-13",
      follow_up_date: "2026-11-23",
    });
    expect(patch!.submitted_resume).toEqual({ version: 2, header: tailored.header, sections: tailored.sections });
    expect(Number.isNaN(Date.parse(patch!.submitted_at!))).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("strips both facts and baseline from the frozen copy", async () => {
    const withFacts = resume("Built a React dashboard", { facts: ["Never send this"], baseline: { b: "x" } });
    const patch = await change(fresh, "applied", { sentResume: withFacts }).p;
    expect(patch!.submitted_resume).not.toHaveProperty("facts");
    expect(patch!.submitted_resume).not.toHaveProperty("baseline");
    expect(withFacts.facts).toEqual(["Never send this"]); // input untouched
  });

  it("falls back to the master (untailored) when there's no tailored copy", async () => {
    const patch = await change(fresh, "applied", { sentResume: null }).p;
    expect(patch!.submitted_resume).toEqual({ version: 2, header: master.header, sections: master.sections });
    expect(patch!.submitted_tailored).toBe(false);
  });

  it("still sets the dates when there's no resume at all", async () => {
    const patch = await change(fresh, "applied", { sentResume: null, master: null }).p;
    expect(patch).toEqual({ status: "applied", date_applied: "2026-11-13", follow_up_date: "2026-11-23" });
  });

  it("keeps an applied date the user already entered", async () => {
    const patch = await change({ ...fresh, date_applied: "2026-11-02" }, "applied").p;
    expect(patch).not.toHaveProperty("date_applied");
    expect(patch).not.toHaveProperty("follow_up_date");
    expect(patch).toHaveProperty("submitted_at");
  });

  it("asks before freezing [placeholders]; yes goes ahead", async () => {
    const withPh = resume("Cut costs by [X%] for [N] clients");
    const { p, confirm } = change(fresh, "applied", { sentResume: withPh, answer: true });
    const patch = await p;
    expect(confirm).toHaveBeenCalledWith(
      "This tailored copy still has 2 [bracketed] placeholders. They'll be frozen into the version you sent. Mark it anyway?",
    );
    expect(patch!.submitted_resume!.sections[0].items[0].bullets[0].text).toBe("Cut costs by [X%] for [N] clients");
  });

  it("asks before freezing [placeholders]; no cancels the whole change", async () => {
    const { p, confirm } = change(fresh, "interview", { sentResume: resume("Saved [X hrs]"), answer: false });
    expect(await p).toBeNull();
    expect(confirm).toHaveBeenCalledWith(placeholderQuestion(1));
  });

  it("counts placeholders in every visible field, not only bullets", async () => {
    const r = resume("Fine", { header: { name: "Ada", contact: "[phone]" } });
    r.sections[0].items[0].dates = "[dates]";
    expect(visibleTexts(r)).toContain("[phone]");
    const { p, confirm } = change(fresh, "applied", { sentResume: r, answer: false });
    expect(await p).toBeNull();
    expect(confirm).toHaveBeenCalledWith(placeholderQuestion(2));
  });

  it("ignores brackets in facts (never sent)", async () => {
    const { p, confirm } = change(fresh, "applied", { sentResume: resume("Fine", { facts: ["[X] users"] }) });
    expect(await p).not.toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("checks the master's placeholders when it's what gets frozen", async () => {
    const { p, confirm } = change(fresh, "applied", { sentResume: null, master: resume("Led [N] people"), answer: false });
    expect(await p).toBeNull();
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("accepts a synchronous confirm", async () => {
    const patch = await applyStatusChange({ job: fresh, next: "applied", sentResume: resume("[X]"), master, confirm: () => false, now });
    expect(patch).toBeNull();
  });

  it("uses singular wording for one placeholder", () => {
    expect(placeholderQuestion(1)).toBe(
      "This tailored copy still has 1 [bracketed] placeholder. It'll be frozen into the version you sent. Mark it anyway?",
    );
  });
});

describe("applyStatusChange: already submitted", () => {
  it("doesn't re-snapshot or ask when moving between sent statuses", async () => {
    const { p, confirm } = change(sent, "rejected", { sentResume: resume("[X]") });
    expect(await p).toEqual({ status: "rejected" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("back to To apply / Skipped asks UNSUBMIT_QUESTION; yes clears the submission", async () => {
    for (const next of ["to_apply", "skipped"] as const) {
      const { p, confirm } = change(sent, next, { answer: true });
      expect(await p).toEqual({
        status: next,
        submitted_resume: null,
        submitted_at: null,
        submitted_tailored: null,
        date_applied: null,
        follow_up_date: null,
      });
      expect(confirm).toHaveBeenCalledWith(UNSUBMIT_QUESTION);
    }
  });

  it("back to To apply, no: only the status changes", async () => {
    expect(await change(sent, "to_apply", { answer: false }).p).toEqual({ status: "to_apply" });
  });

  it("never asks when nothing was submitted", async () => {
    const { p, confirm } = change(fresh, "skipped");
    expect(await p).toEqual({ status: "skipped" });
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("applyStatusChange: reached_interview", () => {
  it("sets it on Interview and Offer (first time and later)", async () => {
    expect((await change(fresh, "interview").p)!.reached_interview).toBe(true);
    expect((await change(sent, "interview").p)).toEqual({ status: "interview", reached_interview: true });
    expect((await change(sent, "offer").p)).toEqual({ status: "offer", reached_interview: true });
  });

  it("never sets it back to false", async () => {
    const was = { ...sent, status: "interview" as const, reached_interview: true };
    for (const next of ["rejected", "applied", "to_apply", "skipped"] as const) {
      const patch = await change(was, next, { answer: true }).p;
      expect(patch).not.toHaveProperty("reached_interview");
    }
    expect(await change(fresh, "applied").p).not.toHaveProperty("reached_interview");
  });

  it("is set alongside a first snapshot (placeholder warning accepted)", async () => {
    const patch = await change(fresh, "offer", { sentResume: resume("[X]"), answer: true }).p;
    expect(patch).toMatchObject({ status: "offer", reached_interview: true, submitted_tailored: true });
  });
});

describe("tailoringStats with reached_interview", () => {
  const at = "2026-10-01T00:00:00Z";
  it("Interview then Rejected still counts as reached", () => {
    const s = tailoringStats([
      { status: "rejected", submitted_at: at, submitted_tailored: true, reached_interview: true },
      { status: "rejected", submitted_at: at, submitted_tailored: true, reached_interview: false },
      { status: "applied", submitted_at: at, submitted_tailored: false },
    ]);
    expect(s).toEqual({ tailored: { applied: 2, interviews: 1 }, untailored: { applied: 1, interviews: 0 } });
  });

  it("falls back to the current status without migration 0003", () => {
    expect(reachedInterview({ status: "interview" })).toBe(true);
    expect(reachedInterview({ status: "offer", reached_interview: null })).toBe(true);
    expect(reachedInterview({ status: "rejected" })).toBe(false);
    expect(reachedInterview({ status: "rejected", reached_interview: true })).toBe(true);
  });

  it("works end to end: Interview → Rejected via applyStatusChange", async () => {
    let job: J & { submitted_tailored?: boolean | null } = { ...fresh };
    for (const next of ["applied", "interview", "rejected"] as const) {
      job = { ...job, ...(await change(job, next).p) };
    }
    expect(job.status).toBe("rejected");
    const stats = tailoringStats([job as Pick<Job, "status" | "submitted_at" | "submitted_tailored" | "reached_interview">]);
    expect(stats.tailored).toEqual({ applied: 1, interviews: 1 });
  });
});

describe("snapshotPatch", () => {
  it("strips baseline as well as facts", () => {
    const p = snapshotPatch(resume("x", { facts: ["f"], baseline: { b: "y" } }), master);
    expect(Object.keys(p.submitted_resume).sort()).toEqual(["header", "sections", "version"]);
  });
});

describe("shared helpers", () => {
  it("plural", () => {
    expect(plural(1, "placeholder")).toBe("1 placeholder");
    expect(plural(3, "placeholder")).toBe("3 placeholders");
    expect(plural(2, "entry", "entries")).toBe("2 entries");
    expect(placeholderQuestion(1)).toContain("1 [bracketed] placeholder. It'll");
    expect(placeholderQuestion(2)).toContain("2 [bracketed] placeholders. They'll");
  });
});

describe("duplicate jobs", () => {
  const jobs = [
    { id: "a", url: "https://boards.greenhouse.io/acme/jobs/1?gh_src=x", company: "Acme", title: "Data Analyst Intern" },
    { id: "b", url: "", company: "Globex", title: "Software Engineer Intern" },
  ];
  it("normalizes links: no query or hash, no trailing slash, lowercase host", () => {
    expect(normalizeJobUrl("https://Boards.Greenhouse.io/acme/jobs/1/?utm=1#apply")).toBe("https://boards.greenhouse.io/acme/jobs/1");
    expect(normalizeJobUrl("not a link")).toBe("");
    expect(normalizeJobUrl("")).toBe("");
  });
  it("matches the same link or the same company and title", () => {
    expect(findDuplicateJob(jobs, { url: "https://boards.greenhouse.io/acme/jobs/1/" })?.id).toBe("a");
    expect(findDuplicateJob(jobs, { company: " globex ", title: "software  engineer intern" })?.id).toBe("b");
    expect(findDuplicateJob(jobs, { url: "https://boards.greenhouse.io/acme/jobs/2", company: "Acme", title: "Other" })).toBeNull();
    expect(findDuplicateJob(jobs, { company: "Globex", title: "" })).toBeNull();
    expect(findDuplicateJob(jobs, {})).toBeNull();
  });
});
