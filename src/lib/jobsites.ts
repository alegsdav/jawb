/** Job boards that require login or render with JavaScript, so a server fetch can't read the posting. */
const PASTE_ONLY: { name: string; test: RegExp }[] = [
  { name: "LinkedIn", test: /(^|\.)linkedin\.com$/i },
  { name: "Handshake", test: /(^|\.)joinhandshake\.com$/i },
  { name: "Workday", test: /(^|\.)myworkdayjobs\.com$|(^|\.)workday\.com$/i },
  { name: "Indeed", test: /(^|\.)indeed\.com$/i },
  { name: "Glassdoor", test: /(^|\.)glassdoor\.com$/i },
  { name: "Wellfound", test: /(^|\.)wellfound\.com$/i },
];

/** Returns the site name if this URL can't be fetched and the user must paste the description; otherwise null. */
export function pasteOnlySite(rawUrl: string): string | null {
  try {
    const host = new URL(rawUrl.trim()).hostname;
    return PASTE_ONLY.find((s) => s.test.test(host))?.name ?? null;
  } catch {
    return null;
  }
}
