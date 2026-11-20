# Round 1 spec: Jawb

Owner of this spec: the orchestrator. Workers implement **only their own section**. If something
here is ambiguous or wrong, stop and report it. Don't guess.

## Ground rules (every task)

- Stack: Next.js 15 App Router, React 19, Supabase (Postgres + RLS), Tailwind v4, Vitest. Code is in `src/`,
  tests are in `tests/`, migrations are in `supabase/migrations/`.
- Check with: `npx vitest run` (all must pass), `npx tsc --noEmit`, `npm run lint`. Run all three before you report.
- **Do not commit, push, or run git commands that change state.** The orchestrator commits.
- **Do not edit files that another task owns** (see "Files" in each section). Several workers run at once
  in the same checkout.
- Match the existing code style: small pure helpers in `src/lib/`, comments explain *why*, and user-facing copy is plain and short.
- A local dev server may already be running on http://localhost:3000 (`npm run dev`). Don't start a second one.
  It hot-reloads.
- UI direction for everything: **minimal and clean**. Fewer words, fewer boxes, no redundant labels, and no
  explanatory paragraphs where one short line or nothing at all will do.

---

## T1: Rename "Job Pipeline" → "Jawb"

The product is now called **Jawb** (capital J, the rest lowercase).

- Replace every user-facing "Job Pipeline" with "Jawb":
  - `src/app/layout.tsx` (metadata title)
  - `src/app/(app)/layout.tsx`
  - `src/components/Sidebar.tsx`
  - `src/components/Bookmarklet.tsx` ("＋ Save to Jawb")
  - `src/app/login/LoginForm.tsx`
  - `src/app/signup/SignupForm.tsx`
  - `src/app/signup/page.tsx`
  - `src/app/(app)/resume/layout.tsx`
  - `src/app/(app)/account/page.tsx` (metadata title only)
- Change the page-title format from `"X · Job Pipeline"` to `"X · Jawb"`.
- Export filename in `src/app/api/export/route.ts`: `jawb-export-YYYY-MM-DD.json`. Update any test that asserts the old name.
- `package.json` `"name"` → `"jawb"`. Also update the top-level `"name"` and `packages[""].name` in
  `package-lock.json`. Edit only those two fields.
- `README.md`: the title line becomes `# Jawb`, and replace any other "Job Pipeline" in the README text.
  Don't touch other README sections.
- `supabase/migrations/0001_init.sql`: change the comment on line 1 only. Never change SQL in old migrations.
- Afterwards, `grep -rniE "job[ -]?pipeline" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git .`
  must return nothing except `docs/SPEC.md`.
- **Files:** only those listed above.

---

## T2: Per-user AI limits that an admin can edit

**Today:** limits come from env (`AI_HEAVY_PER_DAY`, default 10 per rolling 24h; `AI_LIGHT_PER_HOUR`,
default 120 per rolling 60 min). They're the same for everyone. Usage is counted from `ai_usage` rows
(`status in ('pending','ok')`) inside the rolling window (`src/lib/aiBudget.ts`, migration 0004). There is no
per-user value and no way to give one person more or fewer.

**Goal:** the owner can set, per user and per weight (`heavy` = "analyses", `light` = "quick AI actions"):
- **Total**: that user's limit. Empty means the env default.
- **Remaining**: how many they have left right now in the current window.

Keep the rolling-window model. Remaining is always `effective limit − counted rows in the window`.

### T2a: Database and server logic

New file `supabase/migrations/0007_ai_quotas.sql` (safe to re-run, like 0004):

```sql
-- Per-user AI limits that override the env defaults, plus admin-only functions to set a user's
-- limit and how many calls they have left. Safe to re-run.

create table if not exists public.ai_quotas (
  user_id uuid primary key references auth.users on delete cascade,
  heavy_limit int check (heavy_limit is null or heavy_limit >= 0),   -- null = env default
  light_limit int check (light_limit is null or light_limit >= 0),   -- null = env default
  updated_at timestamptz not null default now()
);
alter table public.ai_quotas enable row level security;
drop policy if exists "read own ai quota" on public.ai_quotas;
create policy "read own ai quota" on public.ai_quotas for select to authenticated
  using ((select auth.uid()) = user_id);
-- No write policies: only the service role (admin page) writes.

-- Rows an admin adjusts away stop counting: allow a 'voided' status.
alter table public.ai_usage drop constraint if exists ai_usage_status_check;
alter table public.ai_usage add constraint ai_usage_status_check
  check (status in ('pending', 'ok', 'failed', 'voided'));
```

In the same migration:

1. **`create or replace function public.reserve_ai_call(...)`**: same signature and same behaviour as 0004,
   except the limit is `coalesce(<the user's ai_quotas column for p_weight>, p_limit)`. A per-user limit of `0`
   means no calls. Keep the advisory lock, the `security definer`, `set search_path = ''`, and the grants.
   Fully qualify every name (`public.ai_quotas`).

2. **`public.admin_set_ai_quota(p_user uuid, p_weight text, p_limit int, p_default int, p_remaining int, p_window interval) returns void`**:
   `security definer`, `set search_path = ''`. Revoke it from `public, anon, authenticated` and grant execute to
   `service_role` only.
   - Validate `p_weight in ('heavy','light')`. Raise an exception otherwise.
   - Upsert `ai_quotas` for `p_user`: set that weight's column to `p_limit` (null clears the override) and set `updated_at = now()`.
   - If `p_remaining` is not null:
     - Let `eff = coalesce(p_limit, p_default)` and `r = least(greatest(p_remaining, 0), eff)`.
     - Set `status = 'voided'` on that user's `'ok'` rows of this weight with `created_at > now() - p_window`.
     - Count that user's `'pending'` rows of this weight in the window (`pend`).
     - Insert `greatest(eff - r - pend, 0)` rows into `ai_usage`:
       `(user_id = p_user, action = 'admin_adjust', weight = p_weight, status = 'ok')`.
       Pass `user_id` explicitly, because the default `auth.uid()` is null for the service role.
     - Result: counted rows = eff − r, so remaining = r. The inserted rows age out with the window like real calls.

3. **`public.admin_ai_quota_status(p_heavy_default int, p_light_default int, p_heavy_window interval, p_light_window interval)`**:
   Returns `table(user_id uuid, email text, heavy_limit int, heavy_is_default boolean, heavy_used int, light_limit int, light_is_default boolean, light_used int)`.
   `security definer`, `set search_path = ''`, service_role only (same revoke and grant as above).
   - Lists every row of `auth.users` ordered by email.
   - Each limit is the override, or the default when the override is null.
   - Each used count is that user's `'pending'` and `'ok'` rows of that weight inside that weight's window.

Server code (`src/lib/aiBudget.ts`):

- Add `userLimits(supabase, env?)`. It reads the signed-in user's own `ai_quotas` row (RLS allows this) and returns
  `Record<AiWeight, AiLimit>`, with overrides replacing the env limits.
  - Missing table (`isMissingRelation`), no row, or a read error: return `aiLimits(env)` unchanged, and `console.warn` on a non-missing error.
  - `AiLimit.limit` may now be `0`.
- `withAiBudget`:
  - Still passes the env default as `p_limit`, because SQL applies the override.
  - The 429 path must build its message from `userLimits(...)`, so the number shown is the user's real limit.
- `usageSummary`: use `userLimits(...)` instead of `aiLimits(...)`.
- `limitMessage`: when `lim.limit === 0`, say `"AI analyses are turned off for your account."` (heavy) or
  `"Quick AI actions are turned off for your account."` (light).
- New `src/lib/admin.ts`:
  - `adminEmails(raw = process.env.ADMIN_EMAILS)`, a comma list, trimmed and lowercased.
  - `isAdminEmail(email, raw?)`. An empty list means nobody is an admin.
  - Follow the style of `src/lib/supabase/allowlist.ts`.
- `.env.example`: add `ADMIN_EMAILS=` with a one-line comment ("Emails that can open /admin to edit each user's AI limits").
- Tests: extend `tests/ai-budget.test.ts` (or add `tests/ai-quotas.test.ts`) for:
  - `userLimits`: override, null override, missing table, and limit 0;
  - `limitMessage` with 0;
  - `isAdminEmail`.
- **Files:**
  - `supabase/migrations/0007_ai_quotas.sql` (new)
  - `src/lib/aiBudget.ts`
  - `src/lib/admin.ts` (new)
  - `.env.example`
  - the tests named above.

### T2b: Admin page (after T2a)

- **API** `src/app/api/admin/quotas/route.ts`:
  - `requireUser()`. If the user is not signed in or not `isAdminEmail(user.email)`, return **404** `{ error: "Not found" }`.
  - `createAdminClient()` (`src/lib/supabase/admin.ts`). If it returns null, return 503
    `{ error: "Set SUPABASE_SERVICE_ROLE_KEY to manage AI limits." }`.
  - `GET`: rpc `admin_ai_quota_status` with the env defaults and windows from `aiLimits()`. Return
    `{ users: [{ userId, email, heavy: { limit, isDefault, used, remaining }, light: {...} }], defaults: { heavy, light } }`.
    A missing function (`isMissingRelation` or Postgres code `42883`) returns 503 with `MIGRATION_HINT` from `src/lib/db.ts`.
  - `POST` body `{ userId, weight: "heavy"|"light", limit: number|null, remaining: number|null }`:
    - validate: integers ≥ 0, or null; uuid-ish `userId`.
    - rpc `admin_set_ai_quota`: `p_default` and `p_window` come from `aiLimits()`; `p_limit` and `p_remaining` come from the body.
    - return the user's updated row. Do this by re-running the status rpc and picking that user.
- **Page** `src/app/(app)/admin/page.tsx`:
  - server component; metadata `"AI limits · Jawb"`. If not an admin, `notFound()`.
  - Renders a client component `src/components/AdminQuotas.tsx`.
- **UI** (`AdminQuotas.tsx`): one compact table, minimal.
  - Columns: Email | Analyses/day (total, remaining) | Quick actions/hr (total, remaining).
  - Each cell is a small number input. Total is empty when the user is on the default, with the default shown as the placeholder.
  - One **Save** button per row, enabled only when that row changed.
  - Inline error text only. No cards, no explanatory paragraphs. Keep it to one muted line at most: "Empty total = default (10). Remaining resets the user's current window."
- **Account page**: if `isAdminEmail(user.email)`, add one link "Manage AI limits →" to `/admin` under the usage card.
  Edit `src/app/(app)/account/page.tsx` only for that. T1 changes the metadata title line there.
- README:
  - in the "AI usage limits" feature bullet, add one sentence: per-user totals and remaining are edited at `/admin` (for `ADMIN_EMAILS`), stored in `ai_quotas` (migration 0007);
  - in Setup step 1, add `0007_ai_quotas.sql` to the list.
  - Touch nothing else in the README.
- Tests: `tests/admin-quotas-route.test.ts`, mocking `requireUser` and `createAdminClient` the way `tests/ai-routes.test.ts` does. Cover:
  404 for non-admins, 503 without a service key, GET shape, POST validation, POST calling the rpc with the right args.
- **Files:**
  - `src/app/api/admin/quotas/route.ts`
  - `src/app/(app)/admin/page.tsx`
  - `src/components/AdminQuotas.tsx`
  - `src/app/(app)/account/page.tsx` (link only)
  - `README.md` (those two spots)
  - the new test.

---

## T3: Structured resume review in the AI prompt

**Today:** `analyzePrompt` in `src/lib/prompts.ts` asks for fit, verdict, keywords, strengths, gaps, bullets
and questions, guided only by the job posting. It has no rubric for what a good student resume is.

**Goal:** the analysis applies a fixed, explicit rubric (below), in addition to the job match. Rewrites follow the XYZ
formula, and gaps include structure and format advice.

Add a `REVIEW_RUBRIC` constant in `src/lib/prompts.ts`. Insert it into `analyzePrompt` after `${RULES}`.
Content (keep the wording tight, since this is a prompt):

1. **Section order sends signals** (student resumes):
   - Education goes at the top, because recruiters look for the graduation date and current-student status first.
   - Technical Skills goes near the bottom: it's mostly for ATS keyword matching and doesn't prove depth.
   - Leadership and extracurriculars matter, because they show soft skills and teamwork.
   - If the order is off, raise it as a gap (severity `medium`; `low` if only minor).
   - If the resume has no leadership or activities section, mention it as a `low` gap. Phrase it as "if you have any…", never invented content.
     This is the **one** exception to the "never suggest adding a section" rule in `RULES`. State that explicitly in the rubric so the two rules don't conflict.
2. **Less experience, more impact**: a resume is a sales document, not a timeline.
   - Prefer fewer roles with strong, specific bullets.
   - If an entry is weak and irrelevant to this job, the gap's fix may say to cut or condense it so stronger entries get the space.
3. **Outcomes, not responsibilities**:
   - Rate a bullet `weak` when it describes duties or collaboration without a result ("Collaborated with engineers, designers, and PMs").
   - Rewrites follow Google's XYZ formula, "Accomplished [X] as measured by [Y], by doing [Z]": problem or result first, then the measure, then how.
4. **Specific, not fluffy**:
   - Vague metrics ("improved productivity by 20%") count as `ok` at best.
   - The note says what's unclear (what was measured, how, what changed).
   - The question asks for the concrete definition.
5. **Questions** should help the student find what matters in their role: how success was measured, what changed
   because of their work, and scale (users, revenue, time saved). This is still subject to the never-invent rules.

Also:

- In `RULES`, change the last line to: "Tailoring means rewording, reordering and emphasizing what is already there. Never
  suggest adding content or sections the resume doesn't have, except as the review rubric allows."
- Add the same two ideas (outcomes over duties; XYZ shape; specific over vague) to the coaching prompts. Do this with one short
  shared constant, `BULLET_CRAFT`, used by `coachExamplesPrompt` and `builderDraftPrompt`. The examples'
  anatomy (verb/scope/tool/result) already matches XYZ, so keep it.
- **Do not change the JSON output shape** of any prompt. The UI and `normalizeAnalysis` depend on it.
- The number-honesty rules stay first and win any conflict. State this in one line at the top of the rubric.
- Tests: add `tests/prompts.test.ts`. Assert that `analyzePrompt(...)` includes the rubric markers (section order, XYZ),
  that it still contains the exact `Return ONLY JSON with exactly this shape` block, and that the coach and builder prompts include `BULLET_CRAFT`.
  Existing tests must still pass.
- **Files:** `src/lib/prompts.ts` and `tests/prompts.test.ts` only.

---

## T4: Re-import resume as a modal

**Today:** on the master resume page (`src/app/(app)/resume/page.tsx`), File → "Re-import resume" toggles
`importOpen`. That renders `<ResumeImport replaceWarning …>` inline in the `banners` block above the document.
The editor jumps down and the page reflows.

**Goal:** a centered modal dialog. The page behind doesn't move.

- New `src/components/ReimportDialog.tsx`, modeled on `src/components/PageSetupDialog.tsx` (same overlay, focus handling,
  Escape, click outside, `role="dialog"`, `aria-modal`, labelled title). Read that file and copy its structure.
- Title: "Re-import resume".
- Body: the existing `<ResumeImport replaceWarning onImported={…} onCancel={onClose} />`.
- Width: `max-w-lg`; on phones, full width minus a small margin.
- The dialog body scrolls if it's tall. The page behind never scrolls or reflows.
- When the import succeeds, close the dialog (the existing `onImported` flow then shows the review banner as today).
- In `resume/page.tsx`:
  - remove the inline `{importOpen && (…)}` block from `banners`;
  - render `<ReimportDialog>` when `importOpen`;
  - the File menu item now opens it (`setImportOpen(true)`, not a toggle).
  - Keep the `onboarding = empty && !importOpen` logic working, so first-time import is unchanged.
- In `ResumeImport.tsx`, only if needed inside a modal: the "Re-importing replaces the current master." warning stays, as one line.
  You may remove that component's own outer padding or border when it's inside the dialog (add a prop such as `bare`).
  Don't change its behaviour.
- **Don't open a browser.** The QA agent verifies this in the browser later. Two browsers on the same account
  can trip the app's multi-device conflict banners. Verify with tsc, lint, the tests, and by reading the code.
- **Files:**
  - `src/components/ReimportDialog.tsx` (new)
  - `src/app/(app)/resume/page.tsx` (import block only)
  - `src/components/ResumeImport.tsx` (only a `bare` prop if needed).

---

## T5: UI declutter (after the QA audit)

Written by the orchestrator after the QA audit. See `docs/SPEC-declutter.md` once it exists.

## T6: QA (Sonnet, one agent, browser)

Only one QA agent touches the browser at a time. It uses the test account above and never imports, deletes or
re-analyzes in a way that destroys the account's data, unless the orchestrator says so.
