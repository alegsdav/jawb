# Job Pipeline

A small, single-user web app for applying to internships and jobs: keep one master resume, tailor a copy for each posting with AI suggestions you accept or reject, and track every application through to an offer.

## Features

- **Master resume**: a Google-Docs-style editor that shows your resume as a one-page Harvard-format document (Times, letter size, page-break guide). Import a PDF or pasted text; undo/redo with Ctrl/⌘+Z. Re-importing keeps the ids of unchanged and lightly edited bullets, so each job's "changes vs master" stays accurate.
- **Facts**: a list beside the master resume (below it on phones) for true things that don't fit on the page (numbers, tools, side projects, answers you gave the AI). Facts are never printed or exported to PDF; the AI uses them when it analyzes a job or drafts a cover letter, and won't ask you about them again. Saves are conflict-safe: if the master resume changed in another tab or device, your copy is kept and facts from both are merged, so a fact is never silently lost.
- **Add a job**: paste a link (Greenhouse, Lever, Ashby and other pages with JSON-LD fetch automatically) or paste the description. Links to private, local or internal network addresses are refused (every redirect is re-checked). LinkedIn, Handshake, Workday, Indeed, Glassdoor and Wellfound need a login or JavaScript, so for those you paste the description and the app keeps the link; the bookmarklet sends a posting from those pages in one click.
- **Per-job tailored copy**: each job gets its own copy of the master, analyzed on first open. Bullets are highlighted strong/okay/weak, suggested rewrites appear as tracked changes (accept or reject one at a time or all at once), and edits are marked against the master.
- **Fit bucket**: every analysis rates the job as a **Strong fit**, **Possible fit** or **Stretch**, with the verdict, matched and missing keywords, gaps and questions. The AI never invents numbers; it writes `[placeholders]` and asks you for the real value.
- **Deadlines**: give a job its application deadline; jobs closing soon are flagged on the list.
- **Submitted snapshot**: marking a job Applied freezes an exact copy of the resume you sent (without your facts), sets today's date (your local day) and a 10-day follow-up, and records whether that tailored copy differed from the master resume. Moving the job back to To apply or Skipped offers to clear the submitted copy and Applied date.
- **Outcomes**: the job list compares the interview rate of tailored and untailored applications (percentages appear once each group has 5 applications).
- **Export**: ATS-friendly one-page PDF, plain-text copy, an optional cover letter draft, and a JSON backup of all your data (`GET /api/export`, a download of your resumes and jobs). The backup is for safekeeping; there's no import, so restoring it is done by hand in Supabase.

Stack: Next.js 15 (App Router) · Supabase (Postgres + RLS + magic-link auth) · Google Gemini · @react-pdf/renderer · Tailwind v4 · Vitest.

## Setup

1. **Supabase**: create a project. In the SQL editor, run `supabase/migrations/0001_init.sql`, then
   `supabase/migrations/0002_deadlines_snapshots.sql` (if you set the app up before, run only 0002).
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

Unit tests (Vitest, in `tests/`) cover resume normalization and id reconciliation, analysis normalization and merging, facts, fit buckets, outcome stats, paste-only sites, job-link fetching and the private-address guard with a mocked network and DNS, conflict-safe master resume saves with a fake Supabase client, local calendar dates, status changes, and the email allow-list in middleware and API routes. They need no Supabase or Gemini access.
