# Spec: closed postings and clean job titles (intake)

Temporary: deleted when the round ships.

## Why

Adding 47 real links to the test account showed three bugs:

1. **Closed postings are saved as junk jobs.** For Greenhouse links, `tryKnownBoards` calls the Greenhouse API; a closed
   job answers 404, the error is swallowed (`.catch(() => null)`) and we scrape the page instead. Greenhouse redirects a
   closed job to the company's board (`job-boards.greenhouse.io/gallup?error=true`), so we save the list of openings as
   the description and the page's `<title>` ("Jobs at Gallup", "Careers at Figma", "page_title") as the job title.
   14 of 47 links did this. Lever answers 404 for closed jobs too (they ended as "HTTP 404, paste the description").
2. **Titles and companies come out wrong.** HTML entities are never decoded in titles ("Intern - AI &amp; Infrastructure",
   "Jobs at Perpay - Career&#x27;s Page"); a site's literal placeholder title "page_title" is kept; Lever has no company
   name in its API, so we use the URL slug ("protective", "belvederetrading").
3. **Wrong "You already added this job".** The duplicate check matched the junk jobs' generic titles. Fixed by (1):
   junk is never saved.

What the owner wants: when a link's posting is closed (or isn't a single posting), nothing is saved and the Jobs box shows
an "Oops" window saying so. Adding the same link again shows the same window. A quick AI read of the page to decide this
is fine (it's a light call, not an analysis).

Shared contract (already in the code, don't change it): `src/lib/fetch-job.ts` exports `JobClosedError extends
JobFetchError`, `CLOSED_MESSAGE`, `LISTING_MESSAGE`, and `FetchedJob.source: "board" | "jsonld" | "page"`.
`src/lib/api.ts` passes `closed: true` from a JSON error body through to `ApiResult.closed`.

## Ground rules (every agent reads this)

- Stay in the files listed for your task. Other agents edit the same checkout at the same time.
- Never run `next build`, `next dev`, `git commit/push/stash/checkout/reset`; never delete `.next` or `node_modules`;
  never create `.env` files; never call real job sites or the AI (tests mock `fetch` and Gemini).
- Verify with `npx tsc --noEmit -p .`, `npx eslint <your files>`, `npx vitest run <tests you touched>`.
- Match the code style: TypeScript, Tailwind v4 classes, short "why" comments, plain UI copy, `prefers-reduced-motion`
  for any animation.
- At the end, re-check every Acceptance item and report: files changed, per-item status, test output, doubts.

## T1. Reading a link: closed detection and clean fields

Files: `src/lib/fetch-job.ts`, `tests/fetch-job.test.ts`.

Do:
1. `decodeEntities(s: string): string` (exported): numeric (`&#39;`, `&#x27;`) and named entities (`amp lt gt quot apos
   nbsp rsquo lsquo rdquo ldquo ndash mdash hellip`); unknown named entities stay as they are. Use it inside `htmlToText`
   in place of the ad hoc `.replace` chain (strip tags first, then decode; keep the `&nbsp;` → space behaviour and drop
   the line that turns unknown entities into spaces only if decoding covers them; keep current test expectations green).
2. `cleanField(s)` (exported): decode, collapse whitespace, trim; return "" for placeholders
   (`/^(page_?title|title|untitled|undefined|null|\{\{.*\}\})$/i`). `cleanCompany(s)` (exported): `cleanField`, then drop
   a trailing careers-page suffix: ` - Career's Page`, ` Career Page`, ` Careers`, ` - Careers`, ` Jobs`, ` - Jobs`
   (case-insensitive). Apply `cleanField` to title and location and `cleanCompany` to company on every return path.
3. `isListingTitle(title)` (exported): true for page titles of lists of openings: starts with `Jobs at `, `Careers at `,
   `Current openings at `, `Open roles at `, or is exactly `Jobs`, `Careers`, `Open positions`, or ends with
   ` Careers` / ` - Careers` / ` Career's Page` / ` Careers Page` (case-insensitive, after `cleanField`).
4. `getJSON` must let the caller see the HTTP status (e.g. throw an error carrying `status`).
   - **Greenhouse API 404** for the job → `throw new JobClosedError(CLOSED_MESSAGE)` (don't fall back to scraping).
   - **Lever API 404** → same.
   - Other API failures (network, 5xx) → fall back to the page as today.
   - `fetchJobFromUrl` currently does `tryKnownBoards(...).catch(() => null)`: rethrow `JobClosedError`, swallow the rest.
5. **Lever company name**: after a Lever API success, fetch the posting page `https://jobs.lever.co/<slug>/<id>` with the
   existing `fetchPublic` (same `signal`; any failure is ignored) and read its `<title>`, which is
   "Company - Job title". Take the part before the first " - " when the rest equals the job title (after `cleanField`);
   otherwise fall back to the slug prettified: split on `-`/`_`, capitalise each word ("protective" → "Protective",
   "shield-ai" → "Shield Ai"). Write a small exported `companyFromLeverTitle(pageTitle, jobTitle)` so it's testable.
6. **Ashby** (`jobs.ashbyhq.com/<org>/<uuid>`): before the page fetch, GET
   `https://api.ashbyhq.com/posting-api/job-board/<org>` (public, JSON `{ jobs: [{ id, ... }] }`). If it answers 200 with a
   `jobs` array and no job has that id → `JobClosedError(CLOSED_MESSAGE)`. Any other outcome → continue as today (the
   page's JSON-LD is read as before).
7. **Redirect to a list**: after `fetchPublic`, if the final URL differs from the requested one and either has
   `error=true` in its query, or its path is a strict prefix of the requested path (`/gallup/jobs/123` → `/gallup`),
   throw `JobClosedError(CLOSED_MESSAGE)`.
8. **JSON-LD `validThrough`** in the past (parseable date, before now) → `JobClosedError(CLOSED_MESSAGE)`.
9. **Page text** (sources "jsonld" and "page"): if the first 3000 characters of the description match
   `/no longer (accepting applications|available|open)|this (job|position|posting|role) (has been|is) (closed|filled|no longer)|job (not found|has expired)|position has been filled|posting (has )?expired/i`
   → `JobClosedError(CLOSED_MESSAGE)`.
10. **Listing page** (source "page"): if `isListingTitle(title)` → `throw new JobClosedError(LISTING_MESSAGE)`.

Tests (mock `fetch` as the file already does): Greenhouse 404 → JobClosedError and no page fetch; Lever 404 →
JobClosedError; Lever success uses the page title's company ("Belvedere Trading") and falls back to "Protective";
Ashby id missing → closed, Ashby id present → continues; redirect `/acme/jobs/1` → `/acme?error=true` → closed; past
`validThrough` → closed; "This job is no longer accepting applications" → closed; `<title>Jobs at Gallup</title>` page →
JobClosedError with LISTING_MESSAGE; `decodeEntities` / `cleanField` / `cleanCompany` / `isListingTitle` unit cases
including "&amp;", "&#x27;", "page_title", "Perpay - Career's Page" → "Perpay".

Acceptance:
- [ ] Every item above has a passing test; existing tests in `tests/fetch-job.test.ts` and `tests/fetch-job-ssrf.test.ts`
      still pass.
- [ ] No returned title/company/location contains an HTML entity or a placeholder.

## T2. The intake route: AI page check and the "closed" reply

Files: `src/app/api/intake/route.ts`, `src/lib/prompts.ts`, `tests/intake-export.test.ts` (or a new
`tests/intake-closed.test.ts`).

Do:
1. Catch `JobClosedError` (import from `@/lib/fetch-job`) before the generic `JobFetchError` handling and answer
   **410** `{ error: e.message, closed: true }`. Nothing is inserted.
2. Add `checkJobPagePrompt(pageText: string, pageTitle: string)` to `src/lib/prompts.ts`, exactly this text (keep the
   wording; `${}` are the arguments):

   ```
   You are checking a web page that a student gave as a link to a job posting.
   Decide whether the page is ONE specific job posting that is still open for applications.

   Answer "closed" if the page says the job is no longer available or accepting applications, has been filled or has
   expired, or shows an error such as "job not found".
   Answer "not_a_posting" if the page is a list of many openings, a company careers or home page, a search page, a login
   page, or anything other than a single job posting.
   Otherwise answer "open". When unsure, answer "open".

   Also extract the hiring company's name as people write it (e.g. "Belvedere Trading", not "belvederetrading"), the job
   title and the location, from the posting only. Use "" for anything not stated.

   Return ONLY JSON: {"status": "open" | "closed" | "not_a_posting", "company": "", "title": "", "location": ""}

   PAGE TITLE: ${pageTitle.slice(0, 200) || "(none)"}
   PAGE TEXT:
   """
   ${pageText.slice(0, 6000)}
   """
   ```
3. For a fetched link whose `source` is `"jsonld"` or `"page"`, run this check as the one light AI call (budget action
   `intake_meta`, through `withAiBudget` like the current meta call; it replaces the meta call for these links):
   - `status: "closed"` → 410 `{ error: CLOSED_MESSAGE, closed: true }`; `"not_a_posting"` → 410
     `{ error: LISTING_MESSAGE, closed: true }`. Nothing inserted.
   - `"open"` → meta: keep the fetched value when it's non-empty, else the AI's (company: prefer the AI's when the
     fetched company is empty). Run the AI's strings through `cleanField` / `cleanCompany` from `@/lib/fetch-job`.
   - AI over the limit or failing → keep going with the fetched fields (the fetch-side heuristics already ran); never
     block adding a job because the check couldn't run.
4. `source: "board"` (Greenhouse/Lever API hit) skips the AI check (the API only returns open jobs). Pasted text keeps
   today's behaviour (meta call only when company or title is missing).
5. The duplicate check by company + title runs after this, as today.

Tests (mock `fetchJobFromUrl` / `geminiJSON` / the budget as the existing intake tests do): JobClosedError → 410 +
`closed: true` + no insert; page source + AI "closed" → 410; AI "not_a_posting" → 410 with LISTING_MESSAGE; AI "open"
fills an empty company; AI failure → 200 and inserted; board source → AI not called.

Acceptance:
- [ ] All the above tested and passing; existing intake tests still pass.

## T3. The Jobs box: "Oops" window

Files: `src/components/AddJobForm.tsx`.

Do: when `postApi("/api/intake", …)` returns `r.closed`, show a small modal (not the inline error line):
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` its heading; fixed full-screen backdrop `bg-black/40`, centred
  panel `w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-xl`, `mx-4`.
- Heading "Oops, this posting is closed" (`text-[15px] font-semibold`), then the server's message (`r.error`) in
  `text-[13px] text-muted`, then one full-width black button "OK" (same classes as the Add job button).
- OK, Escape, or a click on the backdrop closes it and clears the box (the link is useless). Focus moves to OK on open
  and back to the textarea on close. Use `useFocusTrap` from `@/lib/useFocusTrap` on the panel.
- Nothing else changes: no job is added, the hint line stays as is. Adding the same link again shows the window again.
- Animation: none needed; if you add a fade, gate it with `motion-reduce:`.

Acceptance:
- [ ] A 410 `{closed: true}` shows the window with the server's sentence; OK / Escape / backdrop close it and clear the
      box; focus is trapped while open and returns to the box.
- [ ] Other errors still show in the line under the button as today.
