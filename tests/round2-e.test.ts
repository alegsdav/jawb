import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveMasterDocument, updateMaster } from "@/lib/master";
import { addFacts } from "@/lib/facts";
import { addDays, applyDates, localToday } from "@/lib/dates";
import { statusChangePatch } from "@/lib/status";
import { assertPublicUrl, fetchJobFromUrl, isBlockedIp } from "@/lib/fetch-job";
import type { Resume } from "@/lib/types";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns", () => {
  const promises = { lookup };
  return { promises, default: { promises } };
});

// ---------- fake Supabase client: one `resumes` row, conditional updates like PostgREST ----------

type Call = { op: "select" | "update"; values?: { content: Resume }; filters: Record<string, unknown> };

function fakeDb(initial: { content: Resume; updated_at: string } | null) {
  const row = initial ? { id: "m1", ...initial } : null;
  let version = 0;
  /** Runs before an update is checked, to simulate another tab saving in between. */
  const hooks: (() => void)[] = [];
  const calls: Call[] = [];
  const handle = (c: Call) => {
    calls.push(c);
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
  return { client, row, calls, hooks };
}

const doc = (facts: string[], name = "Ada"): Resume => ({
  version: 2,
  header: { name, contact: "" },
  sections: [{ id: "s", title: "Experience", items: [{ id: "i", title: "Acme", subtitle: "Intern", location: "", dates: "", bullets: [{ id: "b", text: "Did things" }] }] }],
  facts,
});

describe("updateMaster", () => {
  it("re-reads and retries when someone else saved in between, keeping both changes", async () => {
    const db = fakeDb({ content: doc(["Speaks Spanish"]), updated_at: "t0" });
    // Another tab adds a fact after our first read, before our first write.
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
    if (res.ok) expect(res.content.facts).toEqual(db.row!.content.facts);
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
});

describe("saveMasterDocument (master page autosave)", () => {
  it("on a conflict keeps the local document and unions the server's facts", async () => {
    const db = fakeDb({ content: doc(["Shared", "Added on phone"], "Server name"), updated_at: "t-phone" });
    const local = doc(["Shared", "Added on laptop"], "Local name");
    const out = await saveMasterDocument(db.client, "m1", local, "t-stale");
    expect(db.row!.content.header.name).toBe("Local name");
    expect(db.row!.content.facts).toEqual(["Shared", "Added on laptop", "Added on phone"]);
    expect(out.content).not.toBe(local); // tells the page to merge the facts into its copy
    expect(out.updatedAt).toBe(db.row!.updated_at);
    expect(db.calls.map((c) => c.op)).toEqual(["update", "select", "update"]);
  });

  it("returns the same object when there was no conflict", async () => {
    const db = fakeDb({ content: doc([]), updated_at: "t0" });
    const local = doc(["New"]);
    const out = await saveMasterDocument(db.client, "m1", local, "t0");
    expect(out.content).toBe(local);
    expect(db.calls.map((c) => c.op)).toEqual(["update"]);
  });
});

// ---------- local calendar dates ----------

describe("dates", () => {
  const tz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tz;
  });

  it("applyDates uses the local day, not UTC (US evening)", () => {
    process.env.TZ = "America/Los_Angeles";
    const evening = new Date("2026-11-14T03:30:00Z"); // Nov 13, 7:30pm in Los Angeles
    expect(evening.toISOString().slice(0, 10)).toBe("2026-11-14");
    expect(localToday(evening)).toBe("2026-11-13");
    expect(applyDates(evening)).toEqual({ date_applied: "2026-11-13", follow_up_date: "2026-11-23" });
  });

  it("adds calendar days across DST and month ends", () => {
    process.env.TZ = "America/New_York";
    expect(addDays("2026-03-05", 10)).toBe("2026-03-15"); // DST starts Mar 8
    expect(addDays("2026-10-28", 10)).toBe("2026-11-07"); // DST ends Nov 1
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04");
  });
});

// ---------- status changes on the tracker ----------

describe("statusChangePatch", () => {
  const now = new Date(2026, 10, 13, 20, 0);
  const sent = { date_applied: "2026-11-01", submitted_at: "2026-11-01T15:00:00Z" };

  it("clears the submission when moving back to an unsent status and the user confirms", () => {
    const ask = vi.fn(() => true);
    expect(statusChangePatch(sent, "to_apply", ask)).toEqual({
      status: "to_apply",
      submitted_resume: null,
      submitted_at: null,
      submitted_tailored: null,
      date_applied: null,
      follow_up_date: null,
    });
    expect(ask).toHaveBeenCalledOnce();
  });

  it("only changes the status when the user declines", () => {
    expect(statusChangePatch(sent, "skipped", () => false)).toEqual({ status: "skipped" });
  });

  it("doesn't ask when moving between sent statuses or when nothing was submitted", () => {
    const ask = vi.fn(() => true);
    expect(statusChangePatch(sent, "interview", ask)).toEqual({ status: "interview" });
    expect(statusChangePatch({ date_applied: null, submitted_at: null }, "skipped", ask)).toEqual({ status: "skipped" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("stamps local applied/follow-up dates on the first move to Applied", () => {
    expect(statusChangePatch({ date_applied: null, submitted_at: null }, "applied", () => true, now)).toEqual({
      status: "applied",
      date_applied: "2026-11-13",
      follow_up_date: "2026-11-23",
    });
    // A manually entered applied date is kept.
    expect(statusChangePatch({ date_applied: "2026-11-02", submitted_at: null }, "applied", () => true, now)).toEqual({
      status: "applied",
    });
  });
});

// ---------- SSRF guard ----------

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1", "127.8.9.10", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.2.1",
    "::", "::1", "[::1]", "fe80::1", "fe80::1%eth0", "fc00::1", "fd12:3456::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:10.0.0.1", "64:ff9b::a9fe:a9fe", "2002:c0a8:101::1",
    "2001:db8::1", "not-an-ip",
  ])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:4700::6810:84e5", "::ffff:8.8.8.8", "2002:808:808::1"])(
    "allows %s",
    (ip) => expect(isBlockedIp(ip)).toBe(false),
  );
});

describe("fetchJobFromUrl SSRF protection", () => {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    void input;
    void init;
    return new Response("not found", { status: 404 });
  });
  const LONG = "<p>" + "You will build data pipelines in Python and SQL with our analytics team. ".repeat(8) + "</p>";

  beforeEach(() => {
    fetchMock.mockClear();
    lookup.mockReset();
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const BLOCKED = "That link points to a private or local network address, so it can't be fetched. Paste the job description instead.";

  it.each([
    "http://localhost:3000/admin",
    "http://app.localhost/",
    "http://127.0.0.1/",
    "http://2130706433/", // 127.0.0.1 written as a number
    "http://0x7f.1/",
    "http://[::1]/",
    "http://[::ffff:169.254.169.254]/latest/meta-data/",
    "http://169.254.169.254/latest/meta-data/",
  ])("refuses %s without fetching", async (url) => {
    await expect(fetchJobFromUrl(url)).rejects.toThrow(BLOCKED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses hostnames that resolve to a private address (any of them)", async () => {
    lookup.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ]);
    await expect(fetchJobFromUrl("https://intranet.example.com/job")).rejects.toThrow(BLOCKED);
    expect(lookup).toHaveBeenCalledWith("intranet.example.com", expect.objectContaining({ all: true }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains a host that doesn't resolve", async () => {
    lookup.mockRejectedValueOnce(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));
    await expect(fetchJobFromUrl("https://nope.invalid/job")).rejects.toThrow("Couldn't find that site");
  });

  it("re-checks every redirect hop and refuses one into a private address", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest" } }));
    await expect(fetchJobFromUrl("https://short.example.com/x")).rejects.toThrow(BLOCKED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("follows safe redirects (relative too) and reads the final page", async () => {
    fetchMock
      .mockImplementationOnce(async () => new Response(null, { status: 301, headers: { Location: "https://careers.example.com/a" } }))
      .mockImplementationOnce(async () => new Response(null, { status: 302, headers: { Location: "/jobs/42" } }))
      .mockImplementationOnce(async () => new Response(`<html><head><title>Intern</title></head><body>${LONG}</body></html>`));
    const job = await fetchJobFromUrl("https://example.com/go");
    expect(job.description).toContain("data pipelines");
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual([
      "https://example.com/go",
      "https://careers.example.com/a",
      "https://careers.example.com/jobs/42",
    ]);
  });

  it("stops after 5 redirects", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { Location: "https://loop.example.com/" } }));
    await expect(fetchJobFromUrl("https://loop.example.com/")).rejects.toThrow("redirects too many times");
    expect(fetchMock).toHaveBeenCalledTimes(6);
    fetchMock.mockReset();
  });

  it("names a login-walled site reached by a redirect", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 302, headers: { Location: "https://www.linkedin.com/jobs/view/1" } }));
    await expect(fetchJobFromUrl("https://lnkd.example.com/abc")).rejects.toThrow("LinkedIn postings can't be read automatically");
  });

  it("assertPublicUrl accepts public hosts and rejects other schemes", async () => {
    await expect(assertPublicUrl(new URL("https://jobs.example.com/1"))).resolves.toBeUndefined();
    await expect(assertPublicUrl(new URL("file:///etc/passwd"))).rejects.toThrow("Only http(s) links");
  });
});
