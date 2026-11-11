import "server-only";

export type FetchedJob = {
  title: string;
  company: string;
  location: string;
  description: string;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|ul|ol)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
}

async function getJSON(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Greenhouse and Lever have public JSON APIs, which beat scraping. */
async function tryKnownBoards(u: URL): Promise<FetchedJob | null> {
  const parts = u.pathname.split("/").filter(Boolean);
  if (/greenhouse\.io$/.test(u.hostname)) {
    const i = parts.indexOf("jobs");
    const board = parts[0];
    const id = i >= 0 ? parts[i + 1] : u.searchParams.get("gh_jid");
    if (board && id) {
      const j = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`);
      return {
        title: j.title ?? "",
        company: j.company_name ?? board,
        location: j.location?.name ?? "",
        description: htmlToText(
          (j.content ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
        ),
      };
    }
  }
  if (u.hostname === "jobs.lever.co" && parts.length >= 2) {
    const j = await getJSON(`https://api.lever.co/v0/postings/${parts[0]}/${parts[1]}`);
    const lists = (j.lists ?? [])
      .map((l: { text: string; content: string }) => `${l.text}\n${htmlToText(l.content)}`)
      .join("\n\n");
    return {
      title: j.text ?? "",
      company: parts[0],
      location: j.categories?.location ?? "",
      description: [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join("\n\n"),
    };
  }
  return null;
}

/** Many job pages (Ashby, LinkedIn public, Workable, company sites) embed schema.org JobPosting. */
function fromJsonLd(html: string): FetchedJob | null {
  const blocks = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of blocks) {
    const raw = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const data = JSON.parse(raw);
      const nodes = Array.isArray(data) ? data : data["@graph"] ?? [data];
      const jp = nodes.find((n: { "@type"?: string }) => n?.["@type"] === "JobPosting");
      if (jp) {
        const loc = Array.isArray(jp.jobLocation) ? jp.jobLocation[0] : jp.jobLocation;
        const a = loc?.address ?? {};
        return {
          title: jp.title ?? "",
          company: jp.hiringOrganization?.name ?? "",
          location: [a.addressLocality, a.addressRegion].filter(Boolean).join(", ") ||
            (jp.jobLocationType === "TELECOMMUTE" ? "Remote" : ""),
          description: htmlToText(String(jp.description ?? "")),
        };
      }
    } catch {
      /* ignore bad blocks */
    }
  }
  return null;
}

export async function fetchJobFromUrl(rawUrl: string): Promise<FetchedJob> {
  const u = new URL(rawUrl);
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) links are supported.");
  const known = await tryKnownBoards(u).catch(() => null);
  if (known?.description) return known;

  const res = await fetch(u, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow" });
  if (!res.ok) throw new Error(`The site returned HTTP ${res.status}. Paste the description instead.`);
  const html = await res.text();
  const ld = fromJsonLd(html);
  if (ld?.description && ld.description.length > 200) return ld;

  const text = htmlToText(html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html);
  if (text.length < 300 || /sign in|log in to view|join now/i.test(text.slice(0, 600))) {
    throw new Error("That page needs a login or loads with JavaScript (LinkedIn, Handshake, Workday). Paste the description instead.");
  }
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
  return { title, company: "", location: "", description: text.slice(0, 20000) };
}
