import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertPublicUrl, fetchJobFromUrl, isBlockedIp, JobFetchError, MAX_RESPONSE_BYTES, parseJobUrl, readCapped } from "@/lib/fetch-job";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns", () => {
  const promises = { lookup };
  return { promises, default: { promises } };
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

  it("explains an invalid link instead of throwing a raw TypeError", async () => {
    await expect(fetchJobFromUrl("not a url")).rejects.toThrow(
      "That doesn't look like a link. Paste the full address starting with https://",
    );
    await expect(fetchJobFromUrl("https://")).rejects.toBeInstanceOf(JobFetchError);
    await expect(fetchJobFromUrl("ftp://example.com/job")).rejects.toThrow("Only http(s) links");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes an abort signal to every fetch and explains a timeout", async () => {
    fetchMock.mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    await expect(fetchJobFromUrl("https://slow.example.com/job", 20)).rejects.toThrow("took too long to respond");
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("explains a network failure without raw text", async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(fetchJobFromUrl("https://down.example.com/job")).rejects.toThrow("Couldn't reach that site");
  });

  it("doesn't show raw HTTP text for an error status", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("<h1>Internal Server Error</h1>", { status: 500 }));
    const err = await fetchJobFromUrl("https://broken.example.com/job").catch((e) => e);
    expect(err).toBeInstanceOf(JobFetchError);
    expect(err.message).toBe("The site returned HTTP 500. Paste the job description and keep the link.");
  });

  it("reads at most 2 MB of a page", async () => {
    const big = "<html><body>" + "<p>Build data pipelines in Python and SQL.</p>".repeat(60000) + "</body></html>";
    expect(big.length).toBeGreaterThan(MAX_RESPONSE_BYTES);
    fetchMock.mockImplementationOnce(async () => new Response(big));
    const job = await fetchJobFromUrl("https://huge.example.com/job");
    expect(job.description.length).toBeLessThanOrEqual(20000);
    const capped = await readCapped(new Response(big));
    expect(capped.length).toBe(MAX_RESPONSE_BYTES);
    expect(await readCapped(new Response("short"))).toBe("short");
  });

  it("only treats real greenhouse.io hosts as Greenhouse (anchored host check)", async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).startsWith("https://boards-api.greenhouse.io/")
        ? new Response(JSON.stringify({ title: "X", content: "&lt;p&gt;Real&lt;/p&gt;" }))
        : new Response("<html><body>short</body></html>"),
    );
    await expect(fetchJobFromUrl("https://evilgreenhouse.io/acme/jobs/1")).rejects.toThrow("Paste the job description");
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual(["https://evilgreenhouse.io/acme/jobs/1"]);
    fetchMock.mockClear();
    expect((await fetchJobFromUrl("https://job-boards.greenhouse.io/acme/jobs/1")).description).toBe("Real");
    fetchMock.mockReset();
  });
});

describe("parseJobUrl", () => {
  it("accepts http(s) and rejects everything else with a plain sentence", () => {
    expect(parseJobUrl("  https://jobs.example.com/1 ").href).toBe("https://jobs.example.com/1");
    expect(() => parseJobUrl("jobs.example.com/1")).toThrow("Paste the full address starting with https://");
    expect(() => parseJobUrl("javascript:alert(1)")).toThrow("Only http(s) links");
  });
});
