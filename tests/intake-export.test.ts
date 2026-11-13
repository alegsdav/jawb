import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  selectError: null as null | { message: string; code?: string },
  fetched: [] as string[],
}));

/** Fake Supabase: `jobs` rows for the duplicate check, inserts recorded; selects can be made to fail. */
function fakeSupabase() {
  return {
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
          } else out = { data: h.selectError ? null : h.jobs, error: h.selectError };
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
  geminiJSON: async () => ({ company: "Globex", title: "Software Engineer Intern", location: "Remote" }),
}));
vi.mock("@/lib/fetch-job", async (orig) => {
  const real = await orig<typeof import("@/lib/fetch-job")>();
  return {
    ...real,
    fetchJobFromUrl: async (url: string) => {
      h.fetched.push(url);
      return { description: "A posting", company: "Acme", title: "Data Analyst Intern", location: "Boston" };
    },
  };
});

import { POST as intake } from "@/app/api/intake/route";
import { GET as exportAll } from "@/app/api/export/route";
import { dbErrorMessage, friendlyError } from "@/lib/db";
import { friendlyError as friendlyFromApi } from "@/lib/api";

const req = (body: unknown) => new Request("http://x/api/intake", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  h.jobs = [
    { id: "j1", url: "https://boards.greenhouse.io/acme/jobs/1?gh_src=abc", company: "Acme", title: "Data Analyst Intern", created_at: "2026-11-01T15:00:00Z" },
  ];
  h.inserted = [];
  h.selectError = null;
  h.fetched = [];
});

describe("POST /api/intake duplicates", () => {
  it("the same link (ignoring query, hash and trailing slash) is a duplicate, found before fetching", async () => {
    const res = await intake(req({ url: "https://boards.greenhouse.io/acme/jobs/1/#apply" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "You already added this job.",
      duplicate: { id: "j1", created_at: "2026-11-01T15:00:00Z" },
    });
    expect(h.fetched).toEqual([]);
    expect(h.inserted).toEqual([]);
  });

  it("the same company and title (read from the posting) is a duplicate", async () => {
    h.jobs[0] = { ...h.jobs[0], url: "", company: "Globex", title: "software engineer intern" };
    const res = await intake(req({ text: "Globex is hiring a Software Engineer Intern" }));
    expect(res.status).toBe(409);
    expect(h.inserted).toEqual([]);
  });

  it("force: true adds it anyway; a different job is added", async () => {
    expect((await intake(req({ url: "https://boards.greenhouse.io/acme/jobs/1", force: true }))).status).toBe(200);
    expect((await intake(req({ url: "https://boards.greenhouse.io/acme/jobs/2" }))).status).toBe(409); // same company + title
    h.jobs = [];
    expect((await intake(req({ url: "https://boards.greenhouse.io/acme/jobs/2" }))).status).toBe(200);
    expect(h.inserted).toHaveLength(2);
  });

  it("a failed duplicate lookup never blocks adding", async () => {
    h.selectError = { message: "upstream connect error" };
    expect((await intake(req({ url: "https://boards.greenhouse.io/acme/jobs/1" }))).status).toBe(200);
  });
});

describe("one error wording", () => {
  it("dbErrorMessage and friendlyError agree on sign-outs and missing migrations", () => {
    for (const e of [{ code: "PGRST301", message: "JWT expired" }, { message: "Auth session missing!" }, { code: "42703", message: "x" }]) {
      expect(dbErrorMessage(e, "save")).toBe(friendlyError(e));
    }
    expect(friendlyError).toBe(friendlyFromApi);
  });
});

describe("GET /api/export", () => {
  it("never returns raw database messages", async () => {
    h.selectError = { message: 'relation "public.jobs" does not exist', code: "42P01" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await exportAll();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Couldn't load your data. Check your connection and reload the page.");
    expect(JSON.stringify(body)).not.toMatch(/relation|42P01/);
    spy.mockRestore();
  });
});
