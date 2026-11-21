# Spec: UX polish round (jitter and small bugs from browser QA)

Temporary: deleted when the round ships.

## Ground rules (every agent reads this)

- Stay in the files listed for your task. Other agents edit the same checkout at the same time.
- Never run `next build`, `next dev`, `git commit/push/stash/checkout/reset`; never delete `.next` or `node_modules`;
  never create `.env` files.
- Verify with `npx tsc --noEmit -p .`, `npx eslint <your files>`, `npx vitest run <tests you touched>`.
- Match the code style: TypeScript, Tailwind v4 classes, short "why" comments, plain UI copy, `prefers-reduced-motion`
  for any animation.
- At the end, re-check every Acceptance item and report: files changed, per-item status, test output, doubts.

## H1. Page margins, toolbar and Format menu details

Files: `src/lib/resume.ts`, `tests/page-setup.test.ts`, `next.config.ts`, `src/components/FormatToolbar.tsx`,
`src/components/icons.tsx`, `src/components/FormatMenus.tsx`.

1. **Margins over 2 in are thrown away on reload.** The Page setup dialog allows 0.2–3 in
   (`MARGIN_RANGE_IN` in `src/lib/pageSetup.ts`), but `cleanPage()` in `src/lib/resume.ts` only accepts 0–2 and,
   if any one side is out of range, drops all four (the page falls back to `PAGE_DEFAULTS`).
   Do: accept each side in `0..MARGIN_RANGE_IN.max` (import it from `@/lib/pageSetup`; check there's no import cycle).
   A side that is missing or not a finite number takes that side's value from `PAGE_DEFAULTS`
   (find where it's defined) instead of discarding the whole page; a number above the max is clamped to the max.
   If none of the four sides is a valid number, return `undefined` as today. Add tests in `tests/page-setup.test.ts`
   (normalizeResume of a v4 resume with `page: {marginTop: 3, ...}` keeps 3; one bad side keeps the other three).
2. **Permissions-Policy console warning** on every page: "Unrecognized feature: 'bluetooth'". Remove `bluetooth=()`
   from the header in `next.config.ts` (keep everything else).
3. **Numbered list button is oversized** (43×32 text button "1. 2." while the other toolbar buttons are 28×28
   `icon-btn`). Add a `NumberedListIcon` to `icons.tsx` drawn like the existing `ListIcon` (same viewBox, stroke and
   props; three lines with small "1 2 3"-style marks on the left instead of dots) and use it in a `btnClass` button
   with `className="h-4 w-4"`, exactly like the bulleted list button. Remove `textBtnClass` if unused.
4. **Toolbar shows "18" and a pressed Bold when the editor isn't focused** (it reflects the name line at the start of
   the document while everything is disabled). In `FormatToolbar`, when `!fmt.active`: both selects show the empty
   value (render the empty disabled option) and no button shows pressed (`aria-pressed={on && ...}`).
5. **Format menu items are misaligned**: items wrapped in `Tick` have a 12px check column + gap, plain items don't,
   so labels start at two different x positions. Give every Format menu item label the same leading column (wrap the
   plain ones in `<Tick on={false}>` or equivalent), so all labels line up. The "Line spacing" caption should line up
   with the labels too.

Acceptance:
- [ ] A resume with a 3in top margin keeps it after `normalizeResume`; one invalid side doesn't reset the others (tests).
- [ ] `next.config.ts` no longer lists bluetooth.
- [ ] Numbered list button is a 28×28 icon button like Bulleted list.
- [ ] With `fmt.active === false` the font and size selects are blank and nothing is pressed.
- [ ] Every Format menu label starts at the same x.

## H2. Add job input, login/sign-up error, account page, phone header

Files: `src/components/AddJobForm.tsx`, `src/app/login/LoginForm.tsx`, `src/app/signup/SignupForm.tsx`,
`src/components/UsageMeter.tsx`, `src/components/PasswordForm.tsx`, `src/app/(app)/account/page.tsx`,
`src/app/(app)/layout.tsx`, `src/components/StatusSelect.tsx`.

1. **"http//notaurl" creates a junk job.** In the single-input mode, text that fails `URL_RE` is sent as a job
   description (an "Untitled role" job is created and an AI analysis starts, using quota). Do: in `submit()`, after
   the `URL_RE` branch, if the value contains no whitespace it is never a description: if it looks like an attempted
   link (starts with `http`, `www.`, or contains `/` or `.`), show the existing message
   "That doesn't look like a link. Paste the full address starting with https://"; otherwise show
   "Paste a link to the posting or the full job description." Don't send anything in either case.
2. **Wrong-password error moves the login card**: `main` is `grid place-items-center`, so the error line grows the
   card and re-centres it (the Sign in button jumps 36px up). In `LoginForm.tsx` and `SignupForm.tsx`, keep the card
   still: use `place-items-start` (or `items-start justify-items-center`) with a top padding that puts the card
   roughly where it sits today on a 900px-tall window (about `pt-[18vh]`), so a message added inside the card only
   grows it downward. Check at 1440×900 and 390×844 that nothing above the error moves.
3. **Account page "AI usage" pops in** (`UsageCard` renders nothing until `/api/usage` answers, then two lines push
   the page down). While `usage` is null, render placeholder lines with the same height as the loaded content
   (e.g. two `h-5` muted bars with `animate-pulse motion-reduce:animate-none`), so the page doesn't shift.
4. **Sidebar quota meter is truncated** ("0 of 10 analyses left today · n…"): let the line wrap
   (remove `truncate`, keep it readable at 232px wide).
5. **"Change password" looks like a heading**: style the disclosure as a button: `btn btn-sm` with a small chevron
   that rotates when open (`aria-expanded` already there; rotation `transition-transform motion-reduce:transition-none`).
6. **Phone header "Sign out" in the top-right corner** is easy to hit by accident. Remove the form from the phone
   header in `src/app/(app)/layout.tsx` and add a "Sign out" button at the bottom of the Account page (a
   `<form action={signOut}>` with a `btn` button; import `signOut` from `@/app/login/actions`), shown at every width.
   The Account page is reachable from the phone tab bar.
7. **Status select text on phones is larger than the text around it.** Inspect why (`.input` probably gets a phone
   font-size rule in globals.css to stop iOS zoom). 16px is the right minimum for iOS; if the non-form `StatusSelect`
   renders above 16px on a 390px screen, bring it to 16px there; don't touch globals.css. Report what you found.

Acceptance:
- [ ] `http//notaurl`, `www.acme`, `foo` show a message and send nothing; a pasted multi-line description still works.
- [ ] Login with a wrong password: the email field, password field and Sign in button don't move.
- [ ] Account page: no shift when usage loads; "Change password" looks like a button; Sign out is on the page.
- [ ] Phone header has no Sign out.
- [ ] Usage meter text wraps instead of truncating.

## H3. Dialog focus trap, dashboard first paint, Facts panel, analysis Retry

Files: `src/lib/useFocusTrap.ts` (new), `src/components/PageSetupDialog.tsx`, `src/components/TabStopsDialog.tsx`,
`src/components/ReimportDialog.tsx`, `src/app/(app)/page.tsx`, `src/components/FactsPanel.tsx`,
`src/components/AnalysisPanel.tsx`.

1. **Dialogs don't trap focus**: Tab from the last control of Page setup goes to the page behind it despite
   `aria-modal`. Write `useFocusTrap(ref: RefObject<HTMLElement | null>, active = true)`: on Tab / Shift+Tab inside
   the container, wrap focus between the first and last focusable elements (`a[href], button:not(:disabled),
   input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])`, visible
   only). Use it on the panel element of the three dialogs. Don't change their existing focus-on-open / restore logic.
2. **Dashboard jumps when data arrives** (CLS 0.11–0.17): the page renders the greeting, stats and empty sections
   first, then the jobs push everything down ~98px and the table columns shift. Show the existing `<PageLoader />`
   until the first jobs read finishes (`if (!ready || loading) return <PageLoader />;`). Check that the loading
   placeholders that only existed for that state (`loading ? null : …`, the empty `<tr>` row) still make sense, and
   simplify them if they're now dead. `InProgress` takes `loading`; it's fine to keep passing it.
3. **Facts panel: the add box is under a very long list** (21 facts ≈ 3300px), and new facts appear at the top,
   off-screen. Move the add box above the list (right under any heading/intro), so adding a fact shows it right
   below the box.
4. **Retry is offered when the daily analysis limit is used up** (it can't succeed for hours). In `AnalysisPanel`,
   find how a quota/limit error reaches the panel (grep the API client and `friendlyError` for 429/limit wording).
   Hide the Retry button when the error is the limit error; keep it for other errors. Report how you detect it.

Acceptance:
- [ ] Tab and Shift+Tab cycle inside Page setup, Tab stops and Re-import dialogs.
- [ ] Dashboard paints once: loader, then the full page (no greeting-then-shift).
- [ ] Facts add box is above the list.
- [ ] No Retry on the limit error; Retry still on a network error.

## O. Orchestrator's own work (not for agents)

`src/app/(app)/jobs/[id]/page.tsx`, `src/app/(app)/resume/page.tsx`, `src/components/EditorSkeleton.tsx`,
`src/components/SideTabs.tsx`: tab rows that don't move between tabs, toasts that don't overlap, no second analysis
when a job page is reopened while one is running, and the 1024–1279px editor layout (page was ~40% scale).
