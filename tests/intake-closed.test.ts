import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  fetchImpl: null as null | ((url: string) => Promise<unknown>),
  fetched: [] as string[],
  /** What the AI page check (geminiJSON) answers; throws when set to an Error. */
  ai: null as null | ((prompt: string) => unknown),
  aiPrompts: [] as string[],
}));

/** Fake Supabase: no existing jobs, inserts recorded, AI budget always has room. */
function fakeSupabase() {
  return {
    rpc: async (name: string) => ({ data: name === "reserve_ai_call" ? "reservation" : null, error: null }),
    from() {
      let insert: Record<string, unknown> | null = null;
      const b = {
        select: () => b,
        order: () => b,
        eq: () => b,
        single: () => b,
        insert: (v: Record<string, unknown>) => ((insert = v), b),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          let out: unknown;
          if (insert) {
            h.inserted.push(insert);
            out = { data: { id: "new" }, error: null };
          } else out = { data: [], error: null };
          return Promise.resolve(out).then(res, rej);
        },
      };
      return b;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  requireUser: async () => ({ supabase: fakeSupabase(), user: { id: "u", email: "a@b.c" } }),
}));
vi.mock("@/lib/gemini", () => ({
  geminiJSON: async (prompt: string) => {
    h.aiPrompts.push(prompt);
    if (!h.ai) throw new Error("AI not configured in this test");
    return h.ai(prompt);
  },
}));
vi.mock("@/lib/fetch-job", async (orig) => {
  const real = await orig<typeof import("@/lib/fetch-job")>();
  return {
    ...real,
    fetchJobFromUrl: async (url: string) => {
      h.fetched.push(url);
      if (!h.fetchImpl) throw new Error("fetch not set up in this test");
      return h.fetchImpl(url);
    },
  };
});

import { POST as intake } from "@/app/api/intake/route";
import { checkJobPagePrompt } from "@/lib/prompts";
import { CLOSED_MESSAGE, JobClosedError, LISTING_MESSAGE } from "@/lib/fetch-job";

const req = (body: unknown) => new Request("http://x/api/intake", { method: "POST", body: JSON.stringify(body) });
const LINK = "https://jobs.example.com/acme/roles/42";

const pageJob = (over: Record<string, unknown> = {}) => ({
  description: "Data analyst intern. Build dashboards for the team.",
  company: "",
  title: "Data Analyst Intern",
  location: "",
  source: "page",
  ...over,
});

beforeEach(() => {
  h.inserted = [];
  h.fetched = [];
  h.fetchImpl = null;
  h.ai = null;
  h.aiPrompts = [];
});

describe("POST /api/intake closed postings", () => {
  it("a closed link from the fetch answers 410 with closed: true and inserts nothing", async () => {
    h.fetchImpl = async () => {
      throw new JobClosedError(CLOSED_MESSAGE);
    };
    const res = await intake(req({ url: LINK }));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: CLOSED_MESSAGE, closed: true });
    expect(h.inserted).toEqual([]);
    expect(h.aiPrompts).toEqual([]);
  });

  it("a page the AI reads as closed answers 410 with the closed message and inserts nothing", async () => {
    h.fetchImpl = async () => pageJob();
    h.ai = () => ({ status: "closed", company: "", title: "", location: "" });
    const res = await intake(req({ url: LINK }));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: CLOSED_MESSAGE, closed: true });
    expect(h.inserted).toEqual([]);
  });

  it("a page the AI reads as not_a_posting answers 410 with the listing message", async () => {
    h.fetchImpl = async () => pageJob({ title: "Jobs at Gallup" });
    h.ai = () => ({ status: "not_a_posting", company: "", title: "", location: "" });
    const res = await intake(req({ url: LINK }));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: LISTING_MESSAGE, closed: true });
    expect(h.inserted).toEqual([]);
  });
});

describe("POST /api/intake AI page check", () => {
  it("an open schema.org page fills an empty company from the AI and keeps the fetched title", async () => {
    h.fetchImpl = async () => pageJob({ source: "jsonld", company: "", title: "Data Analyst Intern", location: "" });
    h.ai = () => ({ status: "open", company: "Belvedere Trading", title: "Other title", location: "Boston" });
    const res = await intake(req({ url: LINK }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "new" });
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]).toMatchObject({
      url: LINK,
      company: "Belvedere Trading",
      title: "Data Analyst Intern",
      location: "Boston",
    });
  });

  it("the AI's company is cleaned (entities and careers-page suffix dropped)", async () => {
    h.fetchImpl = async () => pageJob({ company: "" });
    h.ai = () => ({ status: "open", company: "Perpay - Career&#x27;s Page", title: "", location: "" });
    await intake(req({ url: LINK }));
    expect(h.inserted[0]).toMatchObject({ company: "Perpay" });
  });

  it("a schema.org company is kept over the AI's", async () => {
    h.fetchImpl = async () => pageJob({ source: "jsonld", company: "Acme" });
    h.ai = () => ({ status: "open", company: "Someone Else", title: "", location: "" });
    await intake(req({ url: LINK }));
    expect(h.inserted[0]).toMatchObject({ company: "Acme" });
  });

  it("on a scraped page the AI's title and company win over the browser-tab title", async () => {
    h.fetchImpl = async () => pageJob({ company: "", title: "Data Analyst Intern | Acme Careers", location: "" });
    h.ai = () => ({ status: "open", company: "Acme Corp", title: "Data Analyst Intern", location: "Boston" });
    await intake(req({ url: LINK }));
    expect(h.inserted[0]).toMatchObject({ company: "Acme Corp", title: "Data Analyst Intern", location: "Boston" });
  });

  it("when the AI call fails, the job is still added with the fetched fields", async () => {
    h.fetchImpl = async () => pageJob({ company: "Acme", title: "Data Analyst Intern", location: "Remote" });
    h.ai = () => {
      throw new Error("AI is down");
    };
    const res = await intake(req({ url: LINK }));
    expect(res.status).toBe(200);
    expect(h.inserted[0]).toMatchObject({ company: "Acme", title: "Data Analyst Intern", location: "Remote" });
  });

  it("a board link (API hit) skips the AI check", async () => {
    h.fetchImpl = async () => ({
      description: "Role text",
      company: "Acme",
      title: "Data Analyst Intern",
      location: "Boston",
      source: "board",
    });
    const res = await intake(req({ url: LINK }));
    expect(res.status).toBe(200);
    expect(h.aiPrompts).toEqual([]);
    expect(h.inserted[0]).toMatchObject({ company: "Acme", title: "Data Analyst Intern", location: "Boston" });
  });

  it("a page without the AI check's answer does not run the old meta call either", async () => {
    // A page with no company and no title: the check replaces the meta call, so only one AI call is made.
    h.fetchImpl = async () => pageJob({ company: "", title: "" });
    h.ai = () => ({ status: "open", company: "Acme", title: "Analyst", location: "" });
    await intake(req({ url: LINK }));
    expect(h.aiPrompts).toHaveLength(1);
    expect(h.aiPrompts[0]).toContain("PAGE TEXT:");
    expect(h.inserted[0]).toMatchObject({ company: "Acme", title: "Analyst" });
  });
});

describe("checkJobPagePrompt", () => {
  it("includes the page title and the page text, capped, and asks for the JSON shape", () => {
    const text = "x".repeat(7000);
    const p = checkJobPagePrompt(text, "Analyst - Acme");
    expect(p).toContain("PAGE TITLE: Analyst - Acme");
    expect(p).toContain("x".repeat(6000));
    expect(p).not.toContain("x".repeat(6001));
    expect(p).toContain('{"status": "open" | "closed" | "not_a_posting", "company": "", "title": "", "location": ""}');
  });

  it("uses (none) when the page has no title", () => {
    expect(checkJobPagePrompt("text", "")).toContain("PAGE TITLE: (none)");
  });
});
