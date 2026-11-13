# Job Pipeline

A small, single-user web app for applying to internships and jobs: keep one master resume, tailor a copy for each posting with AI suggestions you accept or reject, and track every application through to an offer.

## Features

- **Master resume**: a Google-Docs-style editor that shows your resume as a one-page Harvard-format document (Times, letter size, page-break guide). Import a PDF or pasted text; undo/redo with Ctrl/⌘+Z. Re-importing keeps the ids of unchanged and lightly edited bullets, so each job's "changes vs master" stays accurate.
- **Facts**: a list beside the master resume (below it on phones) for true things that don't fit on the page (numbers, tools, side projects, answers you gave the AI). Facts are never printed or exported to PDF; the AI uses them when it analyzes a job or drafts a cover letter, and won't ask you about them again.
- **Editing on two devices**: master resume saves never overwrite each other blindly. If the master changed somewhere else since this page loaded or last saved (another tab, your phone, "Save as master" or new facts from a job page), the app does a three-way merge against the version this page last saw: bullets, entry fields (title, second line, location, dates), the name and contact line, and section titles are matched by id, and whichever side changed something wins. Additions from either side are kept, a deletion wins only if the other side didn't edit that line, and facts merge as sets (so a fact deleted on one device stays deleted). When that works you see "Merged changes made on another device." If both sides changed the same line differently, autosave stops and a banner, "Your master resume was changed elsewhere", lists the lines and offers **Reload theirs** (drop this page's unsaved edits) or **Keep mine (overwrite)** (your version of those lines replaces theirs; their other changes are kept). Nothing is saved until you pick one.
- **Add a job**: paste a link (Greenhouse, Lever, Ashby and other pages with JSON-LD fetch automatically) or paste the description. Links to private, local or internal network addresses are refused (every redirect is re-checked). LinkedIn, Handshake, Workday, Indeed, Glassdoor and Wellfound need a login or JavaScript, so for those you paste the description and the app keeps the link; the bookmarklet sends a posting from those pages in one click.
- **Per-job tailored copy**: each job gets its own copy of the master, analyzed on first open. Bullets are highlighted strong/okay/weak, suggested rewrites appear as tracked changes (accept or reject one at a time or all at once), and edits are marked against the master.
- **Fit bucket**: every analysis rates the job as a **Strong fit**, **Possible fit** or **Stretch**, with the verdict, matched and missing keywords, gaps and questions. The AI never invents numbers; it writes `[placeholders]` and asks you for the real value.
- **Deadlines**: give a job its application deadline; jobs closing soon are flagged on the list.
- **Submitted snapshot**: marking a job Applied (or jumping straight to Interview, Offer or Rejected) freezes an exact copy of the resume you sent (without your facts), sets today's date (your local day) and a 10-day follow-up, and records whether that tailored copy differed from the master resume. If the copy still has `[placeholders]` you're asked first. Moving the job back to To apply or Skipped offers to clear the submitted copy and Applied date. The tracker and the job page share this logic (`applyStatusChange` in `src/lib/status.ts`).
- **Outcomes**: the job list compares the interview rate of tailored and untailored applications (percentages appear once each group has 5 applications). A job counts as an interview if it reached Interview or Offer at any point, even if it later ended in Rejected (migration 0003; without it, only jobs currently in Interview or Offer count).
- **Saving on a bad connection**: every edit saves automatically. If a save fails (offline, a flaky phone connection), the change stays on screen, a "Not saved — retrying…" notice appears with **Retry now**, and the app retries after 3s, 10s, then every 30s and as soon as you're back online. On the job list, **Discard** next to a row puts back the saved value.
- **Export**: ATS-friendly one-page PDF, plain-text copy, an optional cover letter draft, and a JSON backup of all your data (`GET /api/export`, a download of your resumes and jobs). The backup is for safekeeping; there's no import, so restoring it is done by hand in Supabase.

Stack: Next.js 15 (App Router) · Supabase (Postgres + RLS + magic-link auth) · Google Gemini · @react-pdf/renderer · Tailwind v4 · Vitest.

## Setup

1. **Supabase**: create a project. In the SQL editor, run the files in `supabase/migrations/` in order:
   `0001_init.sql`, `0002_deadlines_snapshots.sql`, then `0003_reached_interview.sql`. If you set the app up before,
   run only the ones you haven't run yet (each is safe to re-run except 0001). 0003 adds `jobs.reached_interview`, which
   remembers that an application got to the interview stage even after a later Rejected, and backfills it for jobs
   currently in Interview or Offer. The app keeps working without 0002/0003 and shows a "Database update needed" note.
2. **Auth redirect URLs**: under Authentication → URL Configuration, set the Site URL to your deployed URL
   (e.g. `https://your-app.vercel.app`) and add `https://your-app.vercel.app/**` and `http://localhost:3000/**`
   to the Redirect URLs. The magic link returns to `/auth/callback`, which these patterns cover.
3. **Gemini key**: https://aistudio.google.com/apikey
4. **Env vars**: copy `.env.example` to `.env.local` for local dev, and add the same keys in Vercel → Project → Settings → Environment Variables.
5. `npm install && npm run dev`
6. **Turn off sign-ups (required)**: after your first sign-in, go to Supabase → Authentication → Sign In / Providers and
   turn off "Allow new users to sign up". The anon key is public, so with sign-ups on anyone can create an account in
   your project. `ALLOWED_EMAILS` is a second lock: the app signs out and refuses (pages, API routes) any account not on
   the list, but it can't stop accounts from being created.

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable / anon key (safe in the browser; RLS protects data) |
| `ALLOWED_EMAILS` | Comma-separated emails allowed to use the app (checked at sign-in, on every page and in every API route). Empty = any account in your Supabase project. |
| `GEMINI_API_KEY` | Server-only. Never commit it. |
| `GEMINI_MODEL` | Optional, defaults to `gemini-3.8-flash` |

## Tests

```bash
npm test
```

Unit tests (Vitest, in `tests/`) cover resume normalization and id reconciliation, analysis normalization and merging, facts, fit buckets, outcome stats, paste-only sites, job-link fetching (timeouts, size cap, invalid links) and the private-address guard with a mocked network and DNS, the three-way master resume merge and conflict-safe saves with a fake Supabase client (`master.test.ts`), local calendar dates, every branch of `applyStatusChange` (`status.test.ts`), and the email allow-list in middleware and API routes (`auth.test.ts`). They need no Supabase or Gemini access.

## Security headers

`next.config.ts` sends `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` (the app can't be framed), `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff` and a `Permissions-Policy` that turns off camera, microphone, location and similar APIs. There's deliberately no script CSP (Next's inline scripts would need nonces).
