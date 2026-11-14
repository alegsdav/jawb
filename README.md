# Job Pipeline

A web app for college students applying to internships and jobs: keep one master resume, tailor a copy for each posting with AI suggestions you accept or reject, and track every application through to an offer. It's invite-only: you create invite codes and send them to the students you want to let in.

## Features

- **Master resume**: a Google-Docs-style editor that shows your resume as a one-page Harvard-format document (Times, letter size, page-break guide). Import a PDF or pasted text; undo/redo with Ctrl/⌘+Z. Re-importing keeps the ids of unchanged and lightly edited bullets, so each job's "changes vs master" stays accurate.
- **Facts**: a list beside the master resume (below it on phones) for true things that don't fit on the page (numbers, tools, side projects, answers you gave the AI). Facts are never printed or exported to PDF; the AI uses them when it analyzes a job or drafts a cover letter, and won't ask you about them again. An answer is saved as a fact that reads on its own: for a question about a `[placeholder]` in a suggested bullet, the bullet sentence with your answer filled in (once all of that bullet's placeholders are answered); otherwise "topic: answer" (e.g. "Used SQL in any class or project: Yes, in DS 3000"). Facts saved in the older "answer (re: question)" form are kept as they are.
- **Editing on two devices**: master resume saves never overwrite each other blindly. If the master changed somewhere else since this page loaded or last saved (another tab, your phone, "Save as master" or new facts from a job page), the app does a three-way merge against the version this page last saw: bullets, entry fields (title, second line, location, dates), the name and contact line, and section titles are matched by id, and whichever side changed something wins. Additions from either side are kept, a deletion wins only if the other side didn't edit that line, and facts merge as sets (so a fact deleted on one device stays deleted). When that works you see "Merged changes made on another device." If both sides changed the same line differently, autosave stops and a banner, "Your master resume was changed elsewhere", lists the lines and offers **Reload theirs** (drop this page's unsaved edits) or **Keep mine (overwrite)** (your version of those lines replaces theirs; their other changes are kept). Nothing is saved until you pick one. The job page works the same way: the tailored copy is three-way merged (or shows "This tailored copy was changed on another device"), job fields save only what you changed, answers merge, marking Applied never replaces a snapshot frozen on another device, and the page refreshes when you return to it. Once you've applied, the job page goes quiet; **Keep editing (for a re-apply)** opens it up again. The AI routes save their result only over the job as they read it: if it changed while the AI ran, `/api/analyze` re-reads it, keeps the answers given meanwhile and tries once more, and otherwise (and `/api/cover-letter` always) leaves the saving to the page, which merges. The job list's row edits are conditional too (see "Saving on a bad connection").
- **Add a job**: paste a link (Greenhouse, Lever, Ashby and other pages with JSON-LD fetch automatically) or paste the description. Links to private, local or internal network addresses are refused (every redirect is re-checked). LinkedIn, Handshake, Workday, Indeed, Glassdoor and Wellfound need a login or JavaScript, so for those you paste the description and the app keeps the link; the bookmarklet sends a posting from those pages in one click. If the job is already on the list (the same link, ignoring `?query`, `#hash` and a trailing slash, or the same company and title), you're asked "You already added this job (added Nov 13). Open it instead?" with **Open it** or **Add anyway**.
- **Per-job tailored copy**: each job gets its own copy of the master, analyzed on first open. Bullets are highlighted strong/okay/weak, suggested rewrites appear as tracked changes (accept or reject one at a time or all at once), and edits are marked against the master.
- **Fit bucket**: every analysis rates the job as a **Strong fit**, **Possible fit** or **Stretch**, with the verdict, matched and missing keywords, gaps and questions. The AI never invents numbers; it writes `[placeholders]` and asks you for the real value. The server checks this too (`guardNumbers` in `src/lib/analysis.ts`): a number in a suggested rewrite is kept only if it's in that same bullet, your facts or your answers, with the same unit (a `%` needs a `%`, `$` needs `$`, `3x` needs `3x`, `10K` needs 10,000). Numbers from other bullets, your contact line, dates, GPA or course codes don't count, and number words ("five", "a dozen", "twice", "doubled", "half") are checked the same way. Anything else becomes `[N]`, `[N]x`, `[X%]`, `[$X]`… with a question. In a cover letter, numbers from the job posting are kept only where the letter restates the posting, never in a sentence about you.
- **Deadlines**: give a job its application deadline; jobs closing soon are flagged on the list.
- **Submitted snapshot**: marking a job Applied (or jumping straight to Interview, Offer or Rejected) freezes an exact copy of the resume you sent (without your facts), sets today's date (your local day) and a 10-day follow-up, and records whether that tailored copy differed from the master resume. If the copy still has `[placeholders]` you're asked first. Moving the job back to To apply or Skipped offers to clear the submitted copy and Applied date. The job list and the job page share this logic (`applyStatusChange` in `src/lib/status.ts`). When a follow-up is due, the job list flags it and the row gets **Followed up**, which sets the next follow-up 7 days out (with **Undo**).
- **Outcomes**: the job list compares the interview rate of tailored and untailored applications (percentages appear once each group has 5 applications). A job counts as an interview if it reached Interview or Offer at any point, even if it later ended in Rejected (migration 0003; without it, only jobs currently in Interview or Offer count).
- **Saving on a bad connection**: every edit saves automatically. If a save fails (offline, a flaky phone connection), the change stays on screen, a "Not saved — retrying…" notice appears with **Retry now**, and the app retries after 3s, 10s, then every 30s and as soon as you're back online. On the job list, **Discard** next to a row puts back the saved value. Job list changes are also safe across devices: each write only lands if the job hasn't changed since this page last saw it; if it has (your phone and laptop both open), the job is re-read, the other device's changes show up, and only the fields you changed here are written again (`src/lib/jobWrites.ts`).
- **Invite-only accounts**: public sign-ups stay off in Supabase. A student opens `/signup` (or the "Create your account" link on the login page), enters their email, a password (8+ characters) and the invite code you gave them. The server checks the code and redeems one use atomically, creates the account with the service-role key (email marked confirmed, `app_metadata.invited = true`) and signs them in. If creating the account fails after the code was redeemed, the use is given back. Five wrong codes from one connection within 10 minutes block further tries for 10 minutes (IP addresses are stored only as hashes). Codes are 16 random base32 characters (`ABCD-EFGH-IJKL-MNOP`); single-use codes work once, reusable codes up to their limit, and either can expire. **Known tradeoff:** email ownership isn't verified at sign-up (the account is created confirmed), so someone with a code could register an address that isn't theirs; they still need the code, and the real owner can't be locked out of anything but that one account.
- **AI usage limits**: each student gets 10 "heavy" AI calls per rolling 24 hours (a job's first analysis, re-analyses, resume imports and builder drafts) and 120 "light" calls per rolling 60 minutes (reading a pasted posting's company and title, cover letters, coaching and fact extraction). Weights live in one table (`AI_WEIGHTS` in `src/lib/aiBudget.ts`); limits come from `AI_HEAVY_PER_DAY` and `AI_LIGHT_PER_HOUR`. A reservation is taken atomically in the database before each call (parallel requests can't slip past the cap), and a call that fails (the AI provider is down, say) isn't counted. Over the limit, the app says which limit and roughly when it frees up. The sidebar and the Account page show "7 of 10 analyses left today". Token counts are recorded for every call. Without migration 0004 the limits are off (the app warns in the server log).
- **Export**: ATS-friendly one-page PDF, plain-text copy, an optional cover letter draft, and a JSON backup of all your data (`GET /api/export`, a download of your resumes and jobs). The backup is for safekeeping; there's no import, so restoring it is done by hand in Supabase.

Stack: Next.js 15 (App Router) · Supabase (Postgres + RLS + password/magic-link auth) · Google Gemini · @react-pdf/renderer · Tailwind v4 · Vitest.

## Setup

1. **Supabase**: create a project. In the SQL editor, run the files in `supabase/migrations/` in order:
   `0001_init.sql`, `0002_deadlines_snapshots.sql`, `0003_reached_interview.sql`, `0004_invites_usage.sql`,
   `0005_facts.sql`, then `0006_progress.sql`. If you set the app up before, run only the ones you haven't run yet
   (each is safe to re-run except 0001). 0003 adds `jobs.reached_interview`, which remembers that an application got to
   the interview stage even after a later Rejected. 0004 adds invite codes, sign-up throttling and AI usage limits
   (`invite_codes`, `signup_attempts`, `ai_usage` and the `redeem_invite`, `release_invite`, `reserve_ai_call` and
   `finish_ai_call` functions). The app keeps working without the later migrations and shows a "Database update
   needed" note where something depends on them (without 0004, sign-up with a code is unavailable and AI limits are off).
2. **Auth redirect URLs**: under Authentication → URL Configuration, set the Site URL to your deployed URL
   (e.g. `https://your-app.vercel.app`) and add `https://your-app.vercel.app/**` and `http://localhost:3000/**`
   to the Redirect URLs. The magic link returns to `/auth/callback`, which these patterns cover.
3. **Gemini key**: https://aistudio.google.com/apikey
4. **Env vars**: copy `.env.example` to `.env.local` for local dev, and add the same keys in Vercel → Project → Settings → Environment Variables.
5. `npm install && npm run dev`
6. **Keep sign-ups off (required)**: go to Supabase → Authentication → Sign In / Providers and turn off "Allow new
   users to sign up". The anon key is public, so with sign-ups on anyone could create an account in your project.
   Students get accounts through `/signup` with an invite code instead (the server creates them with the service-role
   key, which isn't affected by that switch). Create your own account in Supabase → Authentication → Users → Add user
   and put your email on `ALLOWED_EMAILS`.
7. **Invite students**: create a code and send it (or the link `/signup?code=…`):

   ```bash
   node --env-file=.env.local scripts/create-invite.ts single - 14 "For Alex"
   ```

   ```bash
   node --env-file=.env.local scripts/create-invite.ts reusable 30 7 "CS club, fall cohort"
   ```

   Arguments: `single` or `reusable`, max uses (`-` for the default: 1 for single, 25 for reusable), days until it
   expires (`-` = never), and a note for yourself. It prints the code. Node 22.18+ runs the TypeScript file directly
   (older Node: add `--experimental-strip-types`). To look at or revoke codes, use the `invite_codes` table in Supabase
   (set `max_uses` to `uses` to stop a code).

Who can use the app: accounts created with an invite code (`app_metadata.invited`, read from the session on every
request with no database call) and emails on `ALLOWED_EMAILS`. Everyone else is signed out with "That account isn't
allowed to use this app". Note the change from before invites: an empty `ALLOWED_EMAILS` no longer lets every account in,
so put the owner's email there (or set `invited: true` in that user's app metadata).

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable / anon key (safe in the browser; RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only (Supabase → Project Settings → API → service_role / secret key). Used only to redeem invite codes, throttle sign-ups and create invited accounts. Never commit it, never prefix it with `NEXT_PUBLIC_`; the app never logs it or sends it to the browser. |
| `ALLOWED_EMAILS` | Comma-separated emails allowed in without an invite (e.g. the owner's account made before invites). Invited accounts don't need to be listed. |
| `GEMINI_API_KEY` | Server-only. Never commit it. |
| `GEMINI_MODEL` | Optional, defaults to `gemini-3.8-flash` |
| `AI_HEAVY_PER_DAY` | Optional, default `10`: analyses, re-analyses, resume imports and builder drafts per student per rolling 24 hours. |
| `AI_LIGHT_PER_HOUR` | Optional, default `120`: coaching, fact extraction, cover letters and posting details per student per rolling 60 minutes. |

## Tests

```bash
npm test
```

Unit tests (Vitest, in `tests/`) cover resume normalization and id reconciliation, analysis normalization and merging, facts, fit buckets, outcome stats, paste-only sites, job-link fetching (timeouts, size cap, invalid links) and the private-address guard with a mocked network and DNS, the three-way master resume merge and conflict-safe saves with a fake Supabase client (`master.test.ts`), local calendar dates, every branch of `applyStatusChange` and the duplicate-job check (`status.test.ts`), the number honesty guard (`honesty.test.ts`), the job list's write queue: retries, merging while a write is in flight, Discard, conflicts with another device and flushing when the page is hidden (`job-writes.test.ts`), duplicate checks in `/api/intake` and plain errors from `/api/export` (`intake-export.test.ts`), and the email allow-list in middleware and API routes (`auth.test.ts`). They need no Supabase or Gemini access.

## Security headers

`next.config.ts` sends `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` (the app can't be framed), `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff` and a `Permissions-Policy` that turns off camera, microphone, location and similar APIs. There's deliberately no script CSP (Next's inline scripts would need nonces).
