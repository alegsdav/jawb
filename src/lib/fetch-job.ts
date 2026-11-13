import "server-only";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { pasteOnlySite } from "./jobsites";

export type FetchedJob = {
  title: string;
  company: string;
  location: string;
  description: string;
};

/**
 * An error whose message is a plain sentence meant for the user (the intake API shows it as is).
 * Anything else that goes wrong while fetching is shown as a generic "couldn't read that page".
 */
export class JobFetchError extends Error {}

/** Time allowed for reading a job link, all redirects and API calls included. */
export const FETCH_TIMEOUT_MS = 15000;
/** Bytes read from any response; the rest is ignored (job postings are far smaller). */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export const INVALID_URL_MESSAGE = "That doesn't look like a link. Paste the full address starting with https://";
const TIMEOUT_MESSAGE = "That site took too long to respond. Paste the job description and keep the link.";
const UNREACHABLE_MESSAGE = "Couldn't reach that site. Paste the job description and keep the link.";

/** Parse a user-supplied job link: http(s) only, never throws a raw TypeError. */
export function parseJobUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new JobFetchError(INVALID_URL_MESSAGE);
  }
  if (!/^https?:$/.test(u.protocol)) throw new JobFetchError("Only http(s) links are supported.");
  return u;
}

/** Read a response body as text, stopping after MAX_RESPONSE_BYTES. */
export async function readCapped(res: Response, max = MAX_RESPONSE_BYTES): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = max - size;
      chunks.push(value.length > room ? value.subarray(0, room) : value);
      size += Math.min(value.length, room);
    }
  } finally {
    if (size >= max) await reader.cancel().catch(() => {});
    else reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(all);
}

/** fetch() with the shared deadline; turns timeouts and network failures into plain sentences. */
async function timedFetch(url: URL | string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (signal.aborted || name === "TimeoutError" || name === "AbortError") throw new JobFetchError(TIMEOUT_MESSAGE);
    throw new JobFetchError(UNREACHABLE_MESSAGE);
  }
}

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

// ---------- SSRF guard: only fetch public http(s) addresses ----------

const BLOCKED_MESSAGE =
  "That link points to a private or local network address, so it can't be fetched. Paste the job description instead.";
const MAX_REDIRECTS = 5;

function parseIPv4(s: string): number[] | null {
  const parts = s.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && +p <= 255)) return null;
  return parts.map(Number);
}

/** Eight 16-bit groups, or null. Accepts "::" compression, a trailing dotted IPv4 and a %zone suffix. */
function parseIPv6(raw: string): number[] | null {
  let s = raw.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  let tail: number[] = [];
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const v4 = parseIPv4(m[2]);
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    s = m[1].endsWith("::") ? m[1] : m[1].slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groups = (h: string) => (h ? h.split(":").map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN)) : []);
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  const n = head.length + rest.length + tail.length;
  const all =
    halves.length === 2 ? (n > 7 ? null : [...head, ...Array(8 - n).fill(0), ...rest, ...tail]) : n === 8 ? [...head, ...tail] : null;
  return all && all.every((g) => Number.isInteger(g)) ? all : null;
}

function blockedIPv4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local (cloud metadata lives here)
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, documentation
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) || // documentation
    a >= 224 // multicast, reserved, broadcast
  );
}

/**
 * True for addresses a server-side fetch must never reach: loopback, private, link-local,
 * carrier-grade NAT, multicast, reserved and documentation ranges (IPv4 and IPv6, including IPv4
 * embedded in IPv6 such as ::ffff:127.0.0.1). Anything that isn't a valid IP counts as blocked.
 */
export function isBlockedIp(ip: string): boolean {
  const host = ip.replace(/^\[|\]$/g, "");
  const version = isIP(host.split("%")[0]);
  if (version === 4) return blockedIPv4(parseIPv4(host)!);
  if (version !== 6) return true;
  const g = parseIPv6(host);
  if (!g) return true;
  const v4At = (i: number) => [g[i] >> 8, g[i] & 0xff, g[i + 1] >> 8, g[i + 1] & 0xff];
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 6)) return true; // ::, ::1 and deprecated IPv4-compatible ::a.b.c.d
  if (zeros(0, 5) && g[5] === 0xffff) return blockedIPv4(v4At(6)); // IPv4-mapped
  if (g[0] === 0x64 && g[1] === 0xff9b) return zeros(2, 6) ? blockedIPv4(v4At(6)) : true; // NAT64 (well-known / local-use)
  if (g[0] === 0x2002) return blockedIPv4(v4At(1)); // 6to4 embeds an IPv4 address
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  if (g[0] === 0x100 && zeros(1, 4)) return true; // discard-only
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, old site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/**
 * Throws unless `u` is http(s) and its host is (or resolves only to) public addresses.
 * Note: the address can still change between this lookup and the fetch's own (DNS rebinding); this
 * blocks plain links to internal hosts, which is what a pasted URL can otherwise reach.
 */
export async function assertPublicUrl(u: URL): Promise<void> {
  if (!/^https?:$/.test(u.protocol)) throw new JobFetchError("Only http(s) links are supported.");
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) throw new JobFetchError(BLOCKED_MESSAGE);
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new JobFetchError(BLOCKED_MESSAGE);
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new JobFetchError("Couldn't find that site. Check the link, or paste the job description instead.");
  }
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) throw new JobFetchError(BLOCKED_MESSAGE);
}

/** fetch() that re-checks every redirect hop with assertPublicUrl (at most 5 redirects). */
async function fetchPublic(url: URL, init: RequestInit, signal: AbortSignal): Promise<{ res: Response; url: URL }> {
  let current = url;
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(current);
    const res = await timedFetch(current, { ...init, redirect: "manual" }, signal);
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return { res, url: current };
    await res.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw new JobFetchError("That link redirects too many times. Paste the job description instead.");
    try {
      current = new URL(location, current);
    } catch {
      throw new JobFetchError(pasteMessage(null));
    }
    // A link can redirect to a login wall on another host (e.g. a short link to LinkedIn).
    const site = pasteOnlySite(current.href);
    if (site) throw new JobFetchError(pasteMessage(site));
  }
}

/** Fixed public API hosts (Greenhouse, Lever): not user-controlled, so no address check. */
async function getJSON(url: string, signal: AbortSignal) {
  const r = await timedFetch(url, { headers: { "User-Agent": UA } }, signal);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return JSON.parse(await readCapped(r));
}

/** Greenhouse board hosts (boards.greenhouse.io, job-boards.greenhouse.io…), anchored so "evilgreenhouse.io" doesn't match. */
const GREENHOUSE_HOST = /(^|\.)greenhouse\.io$/;

/** Greenhouse and Lever have public JSON APIs, which beat scraping. */
async function tryKnownBoards(u: URL, signal: AbortSignal): Promise<FetchedJob | null> {
  const parts = u.pathname.split("/").filter(Boolean);
  if (GREENHOUSE_HOST.test(u.hostname)) {
    const i = parts.indexOf("jobs");
    // Embedded boards look like /embed/job_app?for=<board>&token=<id>.
    const embed = parts[0] === "embed";
    const board = embed ? u.searchParams.get("for") : parts[0];
    const id = embed ? u.searchParams.get("token") : i >= 0 ? parts[i + 1] : u.searchParams.get("gh_jid");
    if (board && id) {
      const j = await getJSON(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(id)}`,
        signal,
      );
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
    const j = await getJSON(`https://api.lever.co/v0/postings/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`, signal);
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
      const isPosting = (n: { "@type"?: string | string[] }) =>
        n?.["@type"] === "JobPosting" || (Array.isArray(n?.["@type"]) && n["@type"].includes("JobPosting"));
      const jp = nodes.find(isPosting);
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

const pasteMessage = (site: string | null) =>
  site
    ? `${site} postings can't be read automatically. Paste the job description and keep the link.`
    : "That page needs a login or loads with JavaScript. Paste the job description and keep the link.";

/**
 * Fetch a job posting. Every error thrown is a JobFetchError with a plain sentence. The whole fetch
 * (API calls, redirects, body) must finish within FETCH_TIMEOUT_MS, and at most MAX_RESPONSE_BYTES
 * of any response is read.
 */
export async function fetchJobFromUrl(rawUrl: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<FetchedJob> {
  const u = parseJobUrl(rawUrl);
  const site = pasteOnlySite(u.href);
  if (site) throw new JobFetchError(pasteMessage(site));
  const signal = AbortSignal.timeout(timeoutMs);
  const known = await tryKnownBoards(u, signal).catch(() => null);
  if (known?.description) return known;

  const { res, url: finalUrl } = await fetchPublic(u, { headers: { "User-Agent": UA, Accept: "text/html" } }, signal);
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new JobFetchError(`The site returned HTTP ${res.status}. Paste the job description and keep the link.`);
  }
  let html: string;
  try {
    html = await readCapped(res);
  } catch {
    throw new JobFetchError(signal.aborted ? TIMEOUT_MESSAGE : UNREACHABLE_MESSAGE);
  }
  const ld = fromJsonLd(html);
  if (ld?.description && ld.description.length > 200) return ld;

  const text = htmlToText(html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html);
  if (text.length < 300 || /sign in|log in to view|join now/i.test(text.slice(0, 600))) {
    throw new JobFetchError(pasteMessage(pasteOnlySite(finalUrl.href)));
  }
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
  return { title, company: "", location: "", description: text.slice(0, 20000) };
}
