import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJobFromUrl, htmlToText } from "@/lib/fetch-job";

type Route = (url: string) => Response | undefined;
let routes: Route[] = [];
const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  for (const r of routes) {
    const res = r(url);
    if (res) return res;
  }
  return new Response("not found", { status: 404 });
});

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html" } });
const requested = () => fetchMock.mock.calls.map(([i]) => (typeof i === "string" ? i : i instanceof URL ? i.href : i.url));

beforeEach(() => {
  routes = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const LONG = "You will build data pipelines in Python and SQL with our analytics team. ".repeat(8);

describe("fetchJobFromUrl", () => {
  it("uses the Greenhouse API", async () => {
    routes.push((u) =>
      u === "https://boards-api.greenhouse.io/v1/boards/acme/jobs/12345"
        ? json({
            title: "Data Intern",
            company_name: "Acme",
            location: { name: "New York, NY" },
            content: "&lt;p&gt;Build &amp;amp; ship pipelines.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;",
          })
        : undefined,
    );
    const job = await fetchJobFromUrl("https://boards.greenhouse.io/acme/jobs/12345?gh_src=x");
    expect(job).toMatchObject({ title: "Data Intern", company: "Acme", location: "New York, NY" });
    expect(job.description).toContain("Build & ship pipelines.");
    expect(job.description).toContain("• Python");
    expect(requested()).toEqual(["https://boards-api.greenhouse.io/v1/boards/acme/jobs/12345"]);
  });

  it("handles Greenhouse embed links", async () => {
    routes.push((u) =>
      u === "https://boards-api.greenhouse.io/v1/boards/acme/jobs/777" ? json({ title: "SWE Intern", content: "&lt;p&gt;Code.&lt;/p&gt;" }) : undefined,
    );
    const job = await fetchJobFromUrl("https://boards.greenhouse.io/embed/job_app?for=acme&token=777");
    expect(job).toMatchObject({ title: "SWE Intern", company: "acme", description: "Code." });
  });

  it("uses the Lever API", async () => {
    routes.push((u) =>
      u === "https://api.lever.co/v0/postings/acme/abc-123"
        ? json({
            text: "Backend Intern",
            categories: { location: "Remote" },
            descriptionPlain: "Join our backend team.",
            lists: [{ text: "Requirements", content: "<li>Go</li><li>Postgres</li>" }],
            additionalPlain: "We sponsor visas.",
          })
        : undefined,
    );
    const job = await fetchJobFromUrl("https://jobs.lever.co/acme/abc-123");
    expect(job).toMatchObject({ title: "Backend Intern", company: "acme", location: "Remote" });
    expect(job.description).toContain("Join our backend team.");
    expect(job.description).toContain("Requirements");
    expect(job.description).toContain("• Go");
    expect(job.description).toContain("We sponsor visas.");
  });

  it("reads schema.org JobPosting JSON-LD from a page", async () => {
    const ld = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Ignore me" },
        {
          "@type": ["JobPosting"],
          title: "Analytics Intern",
          hiringOrganization: { name: "Globex" },
          jobLocation: [{ address: { addressLocality: "Austin", addressRegion: "TX" } }],
          description: `<p>${LONG}</p>`,
        },
      ],
    };
    routes.push((u) =>
      u === "https://careers.globex.example/jobs/42"
        ? html(`<html><head><title>Job</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>Loading…</body></html>`)
        : undefined,
    );
    const job = await fetchJobFromUrl("https://careers.globex.example/jobs/42");
    expect(job).toMatchObject({ title: "Analytics Intern", company: "Globex", location: "Austin, TX" });
    expect(job.description).toContain("data pipelines in Python");
  });

  it("falls back to page text when there is no structured data", async () => {
    routes.push((u) =>
      u === "https://jobs.initech.example/42" ? html(`<html><head><title>Intern | Initech</title></head><body><p>${LONG}</p></body></html>`) : undefined,
    );
    const job = await fetchJobFromUrl("https://jobs.initech.example/42");
    expect(job.title).toBe("Intern | Initech");
    expect(job.description).toContain("analytics team");
  });

  it("explains a login-walled page", async () => {
    routes.push((u) =>
      u === "https://jobs.hooli.example/1" ? html("<html><body><h1>Sign in</h1><p>Log in to view this job.</p></body></html>") : undefined,
    );
    await expect(fetchJobFromUrl("https://jobs.hooli.example/1")).rejects.toThrow(
      "That page needs a login or loads with JavaScript. Paste the job description and keep the link.",
    );
  });

  it("names a paste-only site without fetching it", async () => {
    await expect(fetchJobFromUrl("https://www.linkedin.com/jobs/view/123")).rejects.toThrow(
      "LinkedIn postings can't be read automatically. Paste the job description and keep the link.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports HTTP errors and rejects non-http links", async () => {
    await expect(fetchJobFromUrl("https://jobs.example.com/missing")).rejects.toThrow("HTTP 404");
    await expect(fetchJobFromUrl("ftp://example.com/job")).rejects.toThrow("Only http(s) links");
  });
});

describe("htmlToText", () => {
  it("drops scripts and styles and keeps list structure", () => {
    expect(htmlToText("<style>x{}</style><script>alert(1)</script><ul><li>One</li><li>Two &amp; three</li></ul>")).toBe(
      "• One\n• Two & three",
    );
  });
});
