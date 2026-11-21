# Round spec: import fidelity, no UI over the canvas, one loader, static editor switches, sidebar job menu

Working spec for this round (temporary orchestration doc). Each task section is self-contained: read the
**Ground rules** and **your task section** only. Paths are repo-relative from `/home/user/jawb`.

## Ground rules (every agent)

- Stay inside the files your task lists. If you truly must touch another file, keep the change minimal and say so in
  your report. Other agents are editing other files in the same checkout at the same time.
- Do NOT run `next build`, `next dev`, `git commit`, `git push`, `git stash`, `git checkout` or `git reset`. Do not
  delete `.next` or `node_modules`. The orchestrator builds and commits.
- Verify with: `npx tsc --noEmit -p .`, `npx eslint <your files>`, `npx vitest run <your test files>`. Errors in files
  you didn't touch may be another agent's work in progress; mention them, don't fix them.
- Match the codebase style: TypeScript, Tailwind v4 utility classes, short doc comments that say why. Plain wording in
  UI copy. Respect `prefers-reduced-motion` for every new animation (`motion-reduce:` or a media query).
- When done, re-read your task's **Acceptance** list and check each item against your diff. Report: files changed,
  what you did per acceptance item, test results, anything left undone or uncertain.

---

## T1. .docx import: line spacing and paragraph spacing exactly like Word

**Files:** `src/lib/import/docxToDoc.ts`, `src/lib/doc/fonts.ts`, `tests/docx-import.test.ts` (and a new
`tests/fonts.test.ts` case if useful; `tests/fonts.test.ts` exists).

**Problem.** Imported .docx resumes are shorter in the editor than in Word. Causes found:
1. Word's line spacing is relative to the font's *natural single line height*, not to the font size. Word "single"
   (`w:spacing w:line="240" w:lineRule="auto"`) for Calibri is 1.2207 × font size; Times New Roman/Arial 1.149.
   The importer stores `line/240` (= 1.0) as the CSS `line-height` multiplier, which is 1.0 × font size: about 18%
   shorter per line for Calibri. Modern Word defaults (`line="259"`, 1.08) become CSS 1.079 instead of 1.32.
2. When a paragraph has no `w:line` anywhere (style chain or docDefaults), no `lineHeight` is written, so the editor
   default 1.15 applies; Word would use the font's single height (1.22 for Calibri).
3. `lineRule="exact"` and `lineRule="atLeast"` are ignored entirely.
4. `w:contextualSpacing` is ignored (Word drops space before/after between two paragraphs of the same style; very
   common on "List Paragraph" bullets).

**Do:**
- In `src/lib/doc/fonts.ts` add and export `wordSingleLineFactor(family: string | null | undefined): number`: Word's
  single line height as a multiple of the font size ((ascent + descent + lineGap) / unitsPerEm). Case-insensitive,
  trimmed. Use this table and a default of 1.17 for unknown families:
  calibri/carlito 1.2207, arial/helvetica/arimo/liberation sans 1.1499, times new roman/times/tinos/liberation serif
  1.1499, georgia 1.1362, garamond/eb garamond 1.1235, cambria 1.1719, aptos 1.2, calibri light 1.2207,
  verdana 1.2153, tahoma 1.2071, trebuchet ms 1.1611, segoe ui 1.3301, book antiqua/palatino/palatino linotype
  1.1328, century gothic 1.2251, gill sans mt 1.1499, franklin gothic book 1.1338, lato 1.2, open sans 1.3618,
  roboto 1.1719, helvetica neue 1.2. LaTeX faces (isTexSerifFamily / TEX_SANS names) 1.2.
- In `docxToDoc.ts`, for every paragraph (including table-row paragraphs and empty ones) compute and always write
  `attrs.lineHeight` as the CSS multiplier that reproduces Word:
  - font = the paragraph's dominant run font (the font of most characters; fall back to the paragraph mark /
    style / docDefaults font, then `DEFAULT_FONT_FAMILY`); size = the largest run size on the paragraph (fallback:
    style/docDefaults size, then `DEFAULT_FONT_SIZE_PT`).
  - `auto` (or no lineRule): `(line ?? 240) / 240 * wordSingleLineFactor(font)`.
  - `exact`: `(line / 20) / size`.
  - `atLeast`: `max((line / 20) / size, wordSingleLineFactor(font))`.
  - Round to 3 decimals, clamp to [0.8, 3] (the existing clamp). Keep `PProps.line` semantics internally however is
    cleanest (e.g. store `line` + `lineRule`).
- contextualSpacing: read `w:contextualSpacing` (on/off, inherited through the style chain like other pPr). When a
  paragraph has it and the previous paragraph has the same paragraph style id, drop its `spaceBefore` and the previous
  paragraph's `spaceAfter` (Word's rule: the space between two same-style paragraphs is removed if either side sets
  contextualSpacing for that boundary; implement: if the current paragraph has contextualSpacing, zero its before;
  if the previous has it, zero the previous's after — only when both share the style id). Lists count: two
  "ListParagraph" bullets in a row get 0 between them.
- Space before/after: keep writing both (Word sums them; T3 makes the editor sum them too). Keep 0.5pt precision
  (don't round to whole points). Do not change `clamp(…, 0, 72)`.
- Update existing tests whose expected `lineHeight` changes, and add tests for: single Calibri → 1.221; `line=259`
  Calibri → 1.317; no spacing at all with Times New Roman → 1.15; `exact` 12pt line on 10pt text → 1.2;
  `atLeast`; contextualSpacing between two ListParagraph bullets → no spaceAfter/spaceBefore between them;
  `wordSingleLineFactor` for a known, a mixed-case and an unknown family.

**Acceptance:**
- [ ] Every imported docx paragraph has a `lineHeight` equal to the Word-equivalent CSS multiplier above.
- [ ] exact/atLeast/auto handled; contextualSpacing handled for same-style neighbours.
- [ ] `npx vitest run tests/docx-import.test.ts tests/fonts.test.ts` passes; tsc clean for these files.

---

## T2. PDF import: measured line pitch instead of a guessed one

**Files:** `src/lib/import/pdfToDoc.ts`, `tests/pdf-import.test.ts` (and `tests/resume-from-pdf.test.ts` /
`tests/pdf-tab-stops.test.ts` only if their expectations change).

**Problem.** PDF imports are shorter in the editor than the PDF. The importer writes no `lineHeight` (editor default
1.15) while the source's real baseline-to-baseline pitch is usually 1.2–1.32 × font size, and `spaceBeforeOf`
subtracts a fixed `PITCH = 1.2` and rounds to whole points, so each paragraph also loses a little.

**Do:**
- Measure the document's line ratio: for every paragraph with 2+ lines, the gaps `lines[i+1].y - lines[i].y` divided
  by `max(size of the two lines)`; the document ratio is the median of all of them across all pages. If there are
  fewer than 3 such gaps, fall back to the median of `gap / size` between consecutive *single-line* paragraphs of the
  same size whose ratio is between 1.0 and 1.45 (tightly packed lines, e.g. bullets). If still nothing, 1.15.
  Clamp to [1.0, 1.6]. (`Para`/`Line` shapes are in the file; reuse them.)
- Write `attrs.lineHeight = round3(ratio)` on every imported paragraph (skip when |ratio − 1.15| < 0.01, so the
  default stays absent). A paragraph whose own wrapped lines clearly differ (its own median differs from the document
  ratio by more than 0.08) gets its own ratio instead.
- `spaceBeforeOf`: extra = `first.y − last.y − ratio × max(last.size, first.size)` (use the same per-paragraph ratio
  the paragraph will render with), keep the `>= 2` threshold but round to 0.5pt instead of whole points; keep
  `MAX_SPACE_BEFORE`.
- Leave `PITCH`, `WRAP_PITCH`, `TIGHT_PITCH` as they are for *segmentation* (what is a wrapped line vs a new
  paragraph); only the emitted spacing changes. Thread the ratio through `pageItems` (it's per document, so compute
  it once from all pages before building items).
- Tests: a synthetic page with 1.3-pitch wrapped lines gets lineHeight 1.3 and correct spaceBefore; a page at 1.15
  pitch writes no lineHeight; spaceBefore rounding to 0.5pt. Update snapshots/expectations that change.

**Acceptance:**
- [ ] Imported PDF paragraphs carry the measured line ratio; spacing above paragraphs uses that ratio, 0.5pt precision.
- [ ] Paragraph segmentation unchanged (existing segmentation tests still pass unmodified).
- [ ] `npx vitest run tests/pdf-import.test.ts tests/resume-from-pdf.test.ts tests/pdf-tab-stops.test.ts` passes.

---

## T3. Paragraph spacing adds up (no CSS margin collapse) in the editor and the read-only view

**Files:** `src/lib/doc/extensions.ts`, `src/components/ResumeView.tsx`, `src/app/globals.css` (only the `.doc-content`
rules if needed), tests: `tests/doc-extensions.test.ts`, `tests/paragraph-size.test.ts` if affected.

**Problem.** `spaceBefore`/`spaceAfter` render as `margin-top`/`margin-bottom`. Adjacent block margins collapse in CSS
(12pt after + 6pt before shows 12pt), but Word and our PDF export (react-pdf, no collapsing) show 18pt. So the editor
and the read-only view are shorter than both the original and our own PDF.

**Do:**
- Editor (`extensions.ts`, ParagraphFormat): render `spaceBefore` as `padding-top: Xpt` (not margin). Keep
  `spaceAfter` as `margin-bottom`. Padding never collapses, so after + before always add up. `parseHTML` for
  spaceBefore must read `paddingTop` first, then fall back to `marginTop` (pasted Google Docs/Word HTML uses margins).
- With `borderBottom`, keep the existing `border-bottom` + `padding-bottom: 1px` (spaceAfter stays a margin below the
  border, as in Word). Make sure two `style` fragments from different attributes still merge (TipTap concatenates
  style strings from global attributes — verify in a test that a paragraph with spaceBefore + lineHeight +
  borderBottom renders all three).
- Nested lists: a `li > p` with spaceAfter as the last child must not collapse through the `li`/`ul` into the next
  paragraph's (now padding) top — that's fine since padding doesn't collapse; but also check a paragraph's
  margin-bottom collapsing with a following list's first paragraph — no longer an issue because the following one
  uses padding. No other CSS change should be needed; confirm.
- Read-only view (`ResumeView.tsx` `ParagraphView`): same rule (paddingTop for spaceBeforePt, marginBottom for
  spaceAfterPt) so view == editor == PDF.
- The decoration that measures line boxes in `ResumeDocument.tsx` (around line 66–90) uses client rects of text, so
  padding doesn't affect it; don't change it. The change bar `.doc-changed::before { top: 2px }` will now start above
  the padding; acceptable, leave it.

**Acceptance:**
- [ ] Editor and read-only view sum spaceAfter of one paragraph and spaceBefore of the next.
- [ ] Pasting HTML with `margin-top` still sets spaceBefore.
- [ ] `npx vitest run tests/doc-extensions.test.ts` (+ any test you touched) passes.

---

## T4. Nothing between the toolbar and the canvas (remove the banners)

**Files:** `src/app/(app)/resume/page.tsx`, `src/app/(app)/jobs/[id]/page.tsx`, delete `src/components/ImportReview.tsx`
(keep `src/lib/importReview.ts`, it's still used for the rebuild text), `src/components/FlashToast.tsx` only if you
need an `error` tone.

**Rule from the owner:** no UI may ever sit in the area between the editor toolbars and the grey document canvas, on
any editor page. The canvas must start right under the formatting toolbar, always.

**Master resume page (`resume/page.tsx`):** remove the `banners` block and its container
(`<div className="mx-auto w-full max-w-[816px] shrink-0 space-y-3 px-4 pt-4 empty:hidden">{banners}</div>`). Move:
- Import review ("Imported from X. Check it looks like your original." + Looks good / Rebuild / Undo import): delete
  the banner and the `ImportReview` component. After a file import, show the existing `FlashToast` with the message
  `Imported <fileName>` and an `Undo` action (calls the existing `undoImport`), auto-dismiss after 8s (a `setTimeout`
  cleared on unmount/next toast). Keep the `review` state (before/addedFacts) so Undo still works while the toast is
  up; clear it when the toast goes away.
- "Rebuild in a clean template": move it to the **File** menu as `Rebuild in a clean template…`, available whenever the
  master isn't empty. It runs the same flow ImportReview had (confirm text `REBUILD_CONFIRM`, POST
  `/api/parse-resume` with `resumePlainText(latestDoc.current?.doc)`, then `takeImport`). Keep the previous resume and
  show the toast `Rebuilt in the clean template` with `Undo` (restores the previous resume). While busy the menu item
  reads `Rebuilding…` and is disabled. Errors go to the error toast (below).
- `built` ("Your first draft is ready." + Go deeper buttons + Next: add a job + Dismiss) and `justImported`
  ("Step 1 done…" + Next: add a job): move both cards to the top of the right side panel (inside `#side-panel`, above
  `SideTabs`), same content, styled as compact cards that fit 340px (`rounded-lg border border-border p-3 text-sm`).
- `error || actions.error` and `notice`: show as toasts. `notice` → `FlashToast` (auto-dismiss 5s). Errors → a toast
  too: add an optional `tone?: "good" | "bad"` prop to `FlashToast` (default "good"; "bad" uses `border-bad/40` and
  `text-bad`, `role="alert"`), with a dismiss ✕ and no auto-dismiss.

**Job page (`jobs/[id]/page.tsx`):** remove the notices container above the canvas
(`<div className="mx-auto w-full max-w-[860px] shrink-0 space-y-4 px-4 pt-4 sm:px-8 empty:hidden">{notices}</div>`).
Render `{notices}` instead inside the `<aside>`, directly under the JobHeader block (the `<div className="relative">`
that holds `JobHeader` and the comment slot), wrapped in `<div className="space-y-3 empty:hidden">`. It must be
visible on all tabs and on phones (the header part of the aside is always visible). For the Posting and Letter tabs,
remove `{notices}` from their scrolling column too (they now live in the aside only). Check that `PullBanner`,
`AppliedNotice`, the migration hint and the error box read well at 340px wide (they may need `flex-wrap` / smaller
button rows); fix their layout classes inside `jobs/[id]/page.tsx` or minimal tweaks in `PullBanner.tsx` /
`job/AppliedNotice.tsx` if needed.

**Acceptance:**
- [ ] No element renders between the formatting toolbar row and the `EditorCanvas` on the master or job page, in any
      state (after import, after build, with an error, with a pull-from-master plan, applied jobs).
- [ ] `ImportReview.tsx` deleted, no imports of it remain; Undo import works from the toast; Rebuild is in File menu.
- [ ] Built / just-imported cards show at the top of the master's side panel; job notices show in the job aside.
- [ ] tsc + eslint clean for touched files; `npx vitest run tests/import-review.test.ts` still passes.

---

## T5. One loader, and editor switches that keep the UI still

**Depends on T4** (same page files). **Files:** `src/components/Loader.tsx`, `src/app/globals.css` (loader + new
keyframes), new `src/components/EditorSkeleton.tsx`, new `src/lib/editorKind.ts`, new
`src/app/(app)/jobs/[id]/loading.tsx`, new `src/app/(app)/resume/loading.tsx`, `src/app/(app)/loading.tsx`,
`src/app/(app)/jobs/[id]/page.tsx`, `src/app/(app)/resume/page.tsx`, `src/app/(app)/page.tsx` (dashboard loading
state), `src/components/FactsPanel.tsx`, `src/components/UsageMeter.tsx`, `src/components/dashboard/InProgress.tsx`,
`tests/loader.test.ts`.

**Owner's intent.** Switching between two tailored jobs, or between a job and the master resume, changes only the
document: the sidebar, top bar, toolbars, canvas and right panel stay exactly where they are. While loading, the page
on the canvas is blank (white paper, no text) with the loader centred on it, and the right panel is blank (its frame
stays, contents empty). The flipping-square loader is **black** and appears in exactly one place: centred over the
document (on editor pages), or centred in the content area (dashboard/account route loads). It never appears top-left,
inline in panels, or in the sidebar.

**Do:**
1. Loader colour: `.flipping-square-loader` background → `var(--fg)` (near-black). Keep reduced-motion pulse.
2. Remove every small inline loader: `FactsPanel` (status loading → render nothing), `UsageMeter` (render nothing
   while loading), `dashboard/InProgress` (render nothing / keep its height), dashboard `page.tsx` `loadingMark`
   (top-left `Loader size={20}` + "Still loading…") → render `<PageLoader />`. `PageLoader` must centre both ways in
   the content area: `flex h-full min-h-[60vh] w-full items-center justify-center` (main is `lg:h-[calc(100dvh-1rem)]`).
3. `src/lib/editorKind.ts`: remembers the last editor kind across client navigations (module state, no storage):
   ```ts
   export type EditorKind = "job" | "master";
   /** Call once per mount (useState initializer). Returns the ms since the kind changed if it changed within
    *  SLIDE_MS (so a remounted toolbar can continue the same animation), else null. */
   export function noteEditorKind(kind: EditorKind, now = Date.now()): number | null
   export const SLIDE_MS = 260;
   ```
   Semantics: keep `{ kind, changedAt }`. If `kind !== last.kind`: set `changedAt = now`, update kind, return 0.
   If same kind and `now - changedAt < SLIDE_MS`: return `now - changedAt`. Else null. First ever call: record, return
   null (no animation on first page load). Unit-test it.
   Hook in the same file or the skeleton: `useKindSlide(kind)` → `{ className: "editor-kind-slide" | "", style:
   { animationDelay: "-<elapsed>ms" } }` computed once with `useState(() => …)`.
   CSS: `.editor-kind-slide { animation: editor-kind-slide 260ms ease-out both; }` with keyframes from
   `opacity: 0; transform: translateX(-10px)` to none; disabled under reduced motion.
4. Apply the slide class to the toolbar groups that differ between master and job (the job's `← Jobs` link + tab list
   + right-hand group of the formatting row: Review/PlaceholderCount/PageCount/Highlights; the master's save
   status/Facts link group). Shared parts (File/Format menus, the FormatToolbar slot, Download icon) don't animate.
   Same-kind switches (job → job) don't animate at all.
5. `src/components/EditorSkeleton.tsx` (`"use client"`): `EditorSkeleton({ kind }: { kind: EditorKind })` renders the
   exact chrome of that page with no data, pixel-aligned with the real page at desktop and phone widths:
   - Same outer wrapper classes as the real page's root.
   - `DocToolbar` with the same children layout: job → `← Jobs` link, File/Format menu buttons (render `MenuBar` with
     the two `MenuBarMenu`s containing no items, or plain buttons with identical classes), the tab list from `TABS`
     with "Resume" selected, and an empty save box of the same width; master → the File/Format menus and an empty
     status span. Phone second row for job, as on the real page.
   - The formatting row: `EditorToolbar` (job) / the master's row div, containing
     `<FormatToolbar fmt={EMPTY_FORMAT_STATE} commands={NOOP_COMMANDS} />` (define `NOOP_COMMANDS` next to the skeleton
     or in `editorTypes.ts`; every command a no-op) plus the Download icon button disabled; the job's right-hand group
     empty.
   - The canvas: `EditorCanvas` with the user's zoom (`useZoom` with the same key each page uses — check them) holding
     a blank `.doc-page` (white paper, real page size/min-height, no editor) and a `StatusBar` showing
     `Page 1 of 1 · 0 words` is NOT wanted — render the status bar frame (same height/border) empty instead.
   - The loader: `<Loader label="Loading document…" />` absolutely centred over the canvas's visible area
     (canvas wrapper `relative`, loader `pointer-events-none absolute inset-0 flex items-center justify-center`).
   - The right panel: the same `<aside>`/`#side-panel` element with identical width/border/padding classes, empty.
   - Export it so pages reuse pieces (e.g. `BlankDocument` = blank page + centred loader, for the case where the page
     chrome is real but the document isn't loaded yet).
6. Routes: `jobs/[id]/loading.tsx` → `<EditorSkeleton kind="job" />`; `resume/loading.tsx` →
   `<EditorSkeleton kind="master" />`; `(app)/loading.tsx` stays `PageLoader` (dashboard/account).
7. Pages: job page `if (!job) return <EditorSkeleton kind="job" />` (replaces `PageLoader`); job page `!resume`
   (replaces `<Loader center label="Loading your tailored copy…" />`) → the `BlankDocument` inside the same canvas
   area plus an empty status bar frame, so nothing shifts when the editor arrives. While the job is loaded but the right
   panel's content isn't ready, keep the panel frame and render it empty rather than a spinner. Master page
   `if (!resume) return <EditorSkeleton kind="master" />` (replaces `PageLoader`). Every `Loader`/`PageLoader` use left
   in the app after this task: `(app)/loading.tsx`, dashboard loading, `EditorSkeleton`/`BlankDocument`. grep to
   confirm.
8. Clear-then-load: when the job page's `id` changes without a remount (shouldn't happen with the app router, but
   guard it), it must show the BlankDocument, not the previous job's text.
9. Phones (below lg), job page: the `<aside>` is `order-first`, so its header block (JobHeader + the notices T4 moved
   there) renders between the toolbars and the canvas on the Resume tab. On the Resume tab below lg, hide the whole
   aside (`hidden lg:block` when `tab === "resume"`), so the canvas starts right under the toolbars. On the Analysis,
   Posting and Letter tabs it shows as now. The comment-card slot (`setCommentEl`) is `position: fixed` on phones and
   must keep working on the Resume tab: move that slot element out of the aside (e.g. render it as a sibling right
   after the aside with the same classes) so hiding the aside doesn't hide it. The skeleton matches this.

**Acceptance:**
- [ ] Loader is black, and only appears centred over the document (editor) or centred in the content area.
- [ ] Job → job: top bar, toolbars, canvas and right-panel frame never move or flash; only the page content blanks,
      shows the centred loader, then the new document appears. Same for job ↔ master, except the differing toolbar
      groups slide in (260ms) instead of popping; no slide on job → job or on first load.
- [ ] No other loader instances remain (FactsPanel, UsageMeter, InProgress, dashboard top-left).
- [ ] `tests/loader.test.ts` covers `noteEditorKind`; tsc + eslint clean.

---

## T6. Sidebar: instant move-to-top on click, and a ⋯ menu (Pin, Rename, Delete)

**Files:** `src/components/Sidebar.tsx`, `src/lib/jobNav.ts`, `tests/job-nav.test.ts`, `src/components/icons.tsx`
(add a `MoreIcon`, three horizontal dots, same style as the others), `src/app/(app)/jobs/[id]/page.tsx` ONLY for the
small rename listener in step 4 (coordinate: T4/T5 also edit this file — add your listener as one self-contained
`useEffect` near the other effects and touch nothing else), `src/app/(app)/page.tsx` ONLY for the refresh listener in
step 5 (same rule).

**Do:**
1. Recent order = most recently *visited or updated*. In `jobNav.ts` add a per-device visit log in localStorage
   (`jawb_job_visits`: `{ [jobId]: isoString }`, keep the newest 50; every read/write in try/catch, works when storage
   is blocked): `readVisits()`, `recordVisit(id, now?)`. Change `recentJobs(jobs, n, visits = {})` and `searchJobs` to
   sort by `max(updated_at, visits[id] ?? "")` descending. Pure helpers stay testable (pass visits in).
2. On click of a job row (or badge in the collapsed rail), record the visit **immediately in the click handler** and
   update sidebar state so the clicked job moves to the top right away, before navigation finishes. Also record on
   path change to `/jobs/<id>` (direct loads). Animate the reorder with FLIP: before the state update, read each row's
   `getBoundingClientRect().top` by job id; after render (`useLayoutEffect`), set `transform: translateY(old-new)` with
   no transition, force layout, then transition `transform 220ms cubic-bezier(.2,.8,.2,1)` to `none`. Skip under
   `prefers-reduced-motion`. Works in both expanded and collapsed sidebars.
3. Pins (per device, localStorage `jawb_pinned_jobs`: string[] of ids, try/catch). Expanded sidebar: when any pinned
   job exists, a "Pinned" heading and list above "Recent jobs"; pinned jobs are excluded from the recent list (recent
   still shows up to 8 others). Order pinned by pin time (newest pin first). Collapsed rail: pinned badges first, then a
   1px separator, then recent. Search results ignore pinning.
4. Each expanded job row gets a ⋯ button on its right (24px square, `aria-label="More options for <title>"`, visible
   on row hover/focus-within and while its menu is open; always visible on touch (`@media (hover: none)`)). It must not
   be inside the `<Link>` (make the row a `relative` `li` with the link and the button as siblings; give the link
   right padding so the title truncates before the button). The menu: use the existing `Menu`/`MenuItem` from
   `src/components/Menu.tsx` (read its API) — items: `Pin` / `Unpin`, `Rename`, separator, `Delete` (danger).
   - Rename: the row turns into a text input with the current title selected (same height as the row). Enter or blur
     saves, Escape cancels, empty → cancel. Save with
     `supabase.from("jobs").update({ title }).eq("id", id).select("id, updated_at").single()`; update sidebar state
     optimistically, revert + `console.warn` on error. After success dispatch
     `window.dispatchEvent(new CustomEvent("jawb:job-renamed", { detail: { id, title } }))`. In the job page add one
     effect: when `detail.id === id`, update the local job title in state *as if it came from the server* (use the
     existing function that applies a server job / or set state so autosave doesn't write it back as a local change —
     read how `applyServerJob` and the job writes work and pick the safe path; if unsure, re-read the job with
     `readJob` and `applyServerJob`).
   - Delete: `confirm("Delete this job and its tailored copy?")`, then `supabase.from("jobs").delete().eq("id", id)`
     (the database cascades the tailored copy and unlinks facts). Remove it from state (and from pins/visits). If the
     current path is that job, `router.push("/")`. Dispatch `jawb:jobs-changed`.
   - The collapsed rail has no ⋯ menu.
5. Dashboard (`(app)/page.tsx`): one effect that reloads its job list on `jawb:jobs-changed` and `jawb:job-renamed`
   (call the existing load function).
6. Tests in `tests/job-nav.test.ts`: ordering with visits, pins excluded from recent, search ignores pins, visit log
   trimming to 50.

**Acceptance:**
- [ ] Clicking a job in the sidebar slides it to the top immediately (FLIP animation), in both sidebar modes; order
      persists across reloads on the device.
- [ ] ⋯ menu on every expanded job row with Pin/Unpin, Rename, Delete, all working; pinned group shows above recent.
- [ ] Rename updates the job page header and dashboard without a reload; delete of the open job goes to the dashboard.
- [ ] Keyboard accessible (Tab to ⋯, Enter opens, arrows/Escape per `Menu`); tsc + eslint clean; job-nav tests pass.

---

## T7. QA (Sonnet, browser) — after T1–T6

Local dev server against the real Supabase with the test account (see the QA brief). Verify every acceptance item
above in a real browser at 1440×900 and 390×844, with screenshots, plus the import fidelity check: import the docx and
PDF fixtures the QA brief names, and compare page fill against a LibreOffice rendering of the same docx
(`soffice --headless --convert-to pdf`). Report defects with exact repro, file and suspected cause; do not fix code.

---

## R2. QA fixes (round 2)

**Files:** `src/components/EditorSkeleton.tsx`, `src/app/(app)/loading.tsx`, `src/app/(app)/jobs/[id]/page.tsx` (only
for item 3, and only if the cause is there), `src/components/ZoomFrame.tsx` (read-only unless needed).

1. **Skeleton page 20px too high.** In the EditorSkeleton / BlankDocument, the blank `.doc-page` top is flush under the
   toolbar (y=94 at 1440×900), but the real page's `.doc-page` sits at y≈114 (the real `EditorCanvas` gives the page a
   top gap). The blank page must sit at exactly the same x/y/width as the real page at every zoom (Fit, 100%) and at
   phone width. Fix by rendering the blank page through the same `EditorCanvas` + `ZoomFrame` path the real editor uses
   (with a blank `.doc-page` child at the same classes/padding as ResumeDocument's page wrapper — read
   ResumeDocument.tsx to copy the exact wrapper markup), instead of an approximation. Also the skeleton's font-size box
   shows "11" where the real one shows "18" when the cursor isn't anywhere: make the skeleton's FormatToolbar show
   whatever the real editor shows before any selection (check what `fmtState` the real ResumeDocument passes before
   the editor has a selection; probably the first paragraph's format — if that can't be known without the document,
   show an empty value in BOTH, i.e. make the disabled toolbar show no size when there's no selection; pick the
   smaller change and say which).
2. **Generic loader on first visit.** On a client navigation to an editor route whose `loading.tsx` the router hasn't
   fetched yet, the parent `(app)/loading.tsx` shows `PageLoader`, blanking the whole content panel. Make
   `(app)/loading.tsx` a client component that picks by `usePathname()`: `/jobs/…` → `<EditorSkeleton kind="job" />`,
   `/resume…` → `<EditorSkeleton kind="master" />`, anything else → `<PageLoader />`. (Check which pathname is current
   while the fallback shows; if it's the OLD path, this still beats the generic loader for editor→editor moves —
   note what you observed in code/docs.)
3. **Transient "Unsaved changes" after a job loads** (no edits made; settles to "Saved"). Find out whether it's caused
   by the new effect in the job page that resets `resume`/`docLatest` on `[id]` (added this round) or by how the
   autosave baseline is set when the tailored copy arrives. Fix only if this round caused it (compare with
   `git show 695d8e6:"src/app/(app)/jobs/[id]/page.tsx"`, which is before the loader change); otherwise report the
   cause and leave it.

**Acceptance:** blank page and real page boxes identical (state the numbers you derived from the CSS/markup); first
visit to an editor route shows the editor skeleton, not the generic loader; item 3 explained (and fixed if ours).
tsc + eslint + `npx vitest run tests/loader.test.ts` clean.
