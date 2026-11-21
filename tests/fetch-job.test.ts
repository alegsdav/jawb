import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanCompany,
  cleanField,
  CLOSED_MESSAGE,
  companyFromLeverTitle,
  decodeEntities,
  fetchJobFromUrl,
  htmlToText,
  isListingTitle,
  JobClosedError,
  LISTING_MESSAGE,
} from "@/lib/fetch-job";

// Every hostname resolves to a public address here (the SSRF guard looks hosts up before fetching).
vi.mock("node:dns", () => {
  const promises = { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) };
  return { promises, default: { promises } };
});

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
const redirect = (location: string) => new Response(null, { status: 302, headers: { Location: location } });
const requested = () => fetchMock.mock.calls.map(([i]) => (typeof i === "string" ? i : i instanceof URL ? i.href : i.url));
/** Serve `res` for exactly one URL. */
const on = (url: string, res: () => Response) => routes.push((u) => (u === url ? res() : undefined));

beforeEach(() => {
  routes = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const LONG = "You will build data pipelines in Python and SQL with our analytics team. ".repeat(8);

/** Rejects with a JobClosedError carrying `message`; fails the test if the fetch succeeds. */
async function closedError(url: string) {
  const err = await fetchJobFromUrl(url).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(JobClosedError);
  return err as JobClosedError;
}

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

  it("treats a Greenhouse 404 as a closed posting and doesn't scrape the page", async () => {
    const err = await closedError("https://boards.greenhouse.io/gallup/jobs/999");
    expect(err.message).toBe(CLOSED_MESSAGE);
    expect(requested()).toEqual(["https://boards-api.greenhouse.io/v1/boards/gallup/jobs/999"]);
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
    // The Lever page isn't routed here, so the company falls back to the prettified slug.
    expect(job).toMatchObject({ title: "Backend Intern", company: "Acme", location: "Remote" });
    expect(job.description).toContain("Join our backend team.");
    expect(job.description).toContain("Requirements");
    expect(job.description).toContain("• Go");
    expect(job.description).toContain("We sponsor visas.");
  });

  it("takes a Lever company name from the posting page's title", async () => {
    on("https://api.lever.co/v0/postings/belvederetrading/abc-123", () =>
      json({ text: "Backend Intern", descriptionPlain: "Join our backend team." }),
    );
    on("https://jobs.lever.co/belvederetrading/abc-123", () =>
      html("<html><head><title>Belvedere Trading - Backend Intern</title></head><body>Apply</body></html>"),
    );
    const job = await fetchJobFromUrl("https://jobs.lever.co/belvederetrading/abc-123");
    expect(job).toMatchObject({ source: "board", company: "Belvedere Trading" });
  });

  it("falls back to the prettified Lever slug when the page title doesn't name the company", async () => {
    on("https://api.lever.co/v0/postings/protective/p1", () => json({ text: "Backend Intern", descriptionPlain: "Join." }));
    on("https://jobs.lever.co/protective/p1", () =>
      html("<html><head><title>Protective - Careers</title></head><body>Apply</body></html>"),
    );
    expect((await fetchJobFromUrl("https://jobs.lever.co/protective/p1")).company).toBe("Protective");

    on("https://api.lever.co/v0/postings/shield-ai/p2", () => json({ text: "ML Intern", descriptionPlain: "Join." }));
    expect((await fetchJobFromUrl("https://jobs.lever.co/shield-ai/p2")).company).toBe("Shield Ai");
  });

  it("treats a Lever 404 as a closed posting", async () => {
    const err = await closedError("https://jobs.lever.co/acme/gone-1");
    expect(err.message).toBe(CLOSED_MESSAGE);
    expect(requested()).toEqual(["https://api.lever.co/v0/postings/acme/gone-1"]);
  });

  it("keeps falling back to the page when a job API fails for another reason", async () => {
    routes.push((u) => (u === "https://api.lever.co/v0/postings/acme/err-1" ? new Response("oops", { status: 503 }) : undefined));
    routes.push((u) =>
      u === "https://jobs.lever.co/acme/err-1" ? html(`<html><head><title>Intern</title></head><body>${LONG}</body></html>`) : undefined,
    );
    const job = await fetchJobFromUrl("https://jobs.lever.co/acme/err-1");
    expect(job.source).toBe("page");
    expect(job.description).toContain("data pipelines");
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

  it("treats an Ashby job missing from the board as closed", async () => {
    const job = "7f3c9a2e-1111-4a2b-9c3d-000000000001";
    on("https://api.ashbyhq.com/posting-api/job-board/acme", () =>
      json({ jobs: [{ id: "7f3c9a2e-1111-4a2b-9c3d-000000000002" }] }),
    );
    const err = await closedError(`https://jobs.ashbyhq.com/acme/${job}`);
    expect(err.message).toBe(CLOSED_MESSAGE);
    expect(requested()).toEqual(["https://api.ashbyhq.com/posting-api/job-board/acme"]);
  });

  it("reads an Ashby job that is still on the board", async () => {
    const job = "7f3c9a2e-1111-4a2b-9c3d-000000000001";
    on("https://api.ashbyhq.com/posting-api/job-board/acme", () => json({ jobs: [{ id: job }] }));
    on(`https://jobs.ashbyhq.com/acme/${job}`, () => html(`<html><head><title>Intern</title></head><body>${LONG}</body></html>`));
    const result = await fetchJobFromUrl(`https://jobs.ashbyhq.com/acme/${job}`);
    expect(result.source).toBe("page");
    expect(requested()).toContain(`https://jobs.ashbyhq.com/acme/${job}`);
  });

  it("treats a redirect to the company's board with error=true as closed", async () => {
    on("https://jobs.example.com/acme/jobs/1", () => redirect("https://jobs.example.com/acme?error=true"));
    on("https://jobs.example.com/acme?error=true", () => html(`<html><head><title>Acme</title></head><body>${LONG}</body></html>`));
    await closedError("https://jobs.example.com/acme/jobs/1");
  });

  it("treats a redirect up to a parent path as closed", async () => {
    on("https://jobs.example.com/acme/jobs/1", () => redirect("https://jobs.example.com/acme"));
    on("https://jobs.example.com/acme", () => html(`<html><head><title>Acme</title></head><body>${LONG}</body></html>`));
    await closedError("https://jobs.example.com/acme/jobs/1");
  });

  it("treats a JSON-LD posting past its validThrough date as closed", async () => {
    const page = (validThrough: string) =>
      html(
        `<html><head><script type="application/ld+json">${JSON.stringify({
          "@type": "JobPosting",
          title: "Intern",
          hiringOrganization: { name: "Acme" },
          validThrough,
          description: `<p>${LONG}</p>`,
        })}</script></head><body>x</body></html>`,
      );
    on("https://careers.acme.example/jobs/old", () => page("2020-01-31T00:00:00Z"));
    await closedError("https://careers.acme.example/jobs/old");

    on("https://careers.acme.example/jobs/new", () => page("2099-12-31T00:00:00Z"));
    expect((await fetchJobFromUrl("https://careers.acme.example/jobs/new")).source).toBe("jsonld");
  });

  it("treats a page that says the job is no longer accepting applications as closed", async () => {
    on("https://jobs.example.com/gone", () =>
      html("<html><body><h1>Data Intern</h1><p>This job is no longer accepting applications.</p></body></html>"),
    );
    const err = await closedError("https://jobs.example.com/gone");
    expect(err.message).toBe(CLOSED_MESSAGE);
  });

  it("refuses a company's list of openings with the listing message", async () => {
    on("https://www.gallup.example/careers", () =>
      html(`<html><head><title>Jobs at Gallup</title></head><body><p>${LONG}</p></body></html>`),
    );
    const err = await fetchJobFromUrl("https://www.gallup.example/careers").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobClosedError);
    expect((err as Error).message).toBe(LISTING_MESSAGE);
  });

  it("cleans entities and placeholder titles from the page title", async () => {
    on("https://jobs.example.com/ai", () =>
      html(`<html><head><title>Intern - AI &amp; Infrastructure</title></head><body><p>${LONG}</p></body></html>`),
    );
    expect((await fetchJobFromUrl("https://jobs.example.com/ai")).title).toBe("Intern - AI & Infrastructure");

    on("https://jobs.example.com/placeholder", () =>
      html(`<html><head><title>page_title</title></head><body><p>${LONG}</p></body></html>`),
    );
    expect((await fetchJobFromUrl("https://jobs.example.com/placeholder")).title).toBe("");
  });
});

describe("htmlToText", () => {
  it("drops scripts and styles and keeps list structure", () => {
    expect(htmlToText("<style>x{}</style><script>alert(1)</script><ul><li>One</li><li>Two &amp; three</li></ul>")).toBe(
      "• One\n• Two & three",
    );
  });

  it("decodes entities after stripping tags, so escaped markup stays text", () => {
    expect(htmlToText("<p>Don&#39;t&nbsp;stop &mdash; now &lt;b&gt;</p>")).toBe("Don't stop — now <b>");
  });
});

describe("decodeEntities", () => {
  it("decodes numeric and named entities", () => {
    expect(decodeEntities("AI &amp; Infra")).toBe("AI & Infra");
    expect(decodeEntities("Career&#x27;s &#39; &#8217; &rsquo;")).toBe("Career's ' ’ ’");
    expect(decodeEntities("a&nbsp;b &hellip; &mdash;")).toBe("a b … —");
  });

  it("decodes once, and leaves unknown entities and invalid code points as written", () => {
    expect(decodeEntities("&amp;amp;")).toBe("&amp;");
    expect(decodeEntities("&bogus; &#xD800; &#0;")).toBe("&bogus; &#xD800; &#0;");
  });
});

describe("cleanField", () => {
  it("decodes, collapses whitespace and trims", () => {
    expect(cleanField("  Intern &amp;\n  AI  ")).toBe("Intern & AI");
  });

  it.each(["page_title", "Title", "untitled", "undefined", "null", "{{job.title}}", "  Page_Title "])(
    "returns \"\" for the placeholder %j",
    (s) => expect(cleanField(s)).toBe(""),
  );

  it("accepts a missing value", () => {
    expect(cleanField(undefined)).toBe("");
  });
});

describe("cleanCompany", () => {
  it.each([
    ["Perpay - Career&#x27;s Page", "Perpay"],
    ["Acme Careers", "Acme"],
    ["Acme - Careers", "Acme"],
    ["Acme Career Page", "Acme"],
    ["Acme - Jobs", "Acme"],
    ["Acme Jobs", "Acme"],
    ["Belvedere Trading", "Belvedere Trading"],
    ["page_title", ""],
  ])("cleans %j to %j", (raw, expected) => expect(cleanCompany(raw)).toBe(expected));
});

describe("isListingTitle", () => {
  it.each([
    "Jobs at Gallup",
    "Careers at Figma",
    "Current openings at Acme",
    "Open roles at Acme",
    "Jobs",
    "careers",
    "Open positions",
    "Acme Careers",
    "Acme - Careers",
    "Perpay - Career&#x27;s Page",
    "Acme Careers Page",
  ])("treats %j as a list of openings", (title) => expect(isListingTitle(title)).toBe(true));

  it.each(["Intern - AI &amp; Infrastructure", "Intern | Initech", "page_title", "Data Intern"])(
    "treats %j as one posting",
    (title) => expect(isListingTitle(title)).toBe(false),
  );
});

describe("companyFromLeverTitle", () => {
  it("returns the part before the first ' - ' when the rest is the job title", () => {
    expect(companyFromLeverTitle("Belvedere Trading - Backend Intern", "Backend Intern")).toBe("Belvedere Trading");
  });

  it("returns \"\" when the rest is not the job title, or there is no separator", () => {
    expect(companyFromLeverTitle("Belvedere Trading - Other Role", "Backend Intern")).toBe("");
    expect(companyFromLeverTitle("Protective", "Backend Intern")).toBe("");
  });
});
