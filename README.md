# Job Pipeline

A small, single-user web app for applying to internships and jobs:

1. **Master resume**: a structured editor (sections → entries → bullets) holding everything true about you. Import it by pasting your resume text.
2. **Bullet bank**: extra facts, numbers and bullets that don't fit on one page. The analyzer pulls from it per job.
3. **Add a job**: paste a link (Greenhouse, Lever, Ashby and other JSON-LD pages fetch automatically) or paste/drop the description.
4. **Job workspace**: each job gets its own tailored copy of the master. **Analyze fit** returns a fit score, missing keywords, gaps, a strong/ok/weak rating for every bullet with one-click rewrites, and questions about the numbers it needs from you. Answer them and re-analyze.
5. **Export**: ATS-friendly one-page PDF, plain-text copy, and an optional cover letter draft.
6. **Tracker**: status, applied date, follow-up reminders (marking "Applied" sets a 10-day follow-up).

Stack: Next.js 15 (App Router) · Supabase (Postgres + RLS + magic-link auth) · Google Gemini · @react-pdf/renderer · Tailwind v4.

The AI is told never to invent facts or numbers. It uses `[placeholders]` and asks you instead.

## Setup

1. **Supabase**: create a project, then run `supabase/migrations/0001_init.sql` in the SQL editor.
   Under Authentication → URL Configuration, set the Site URL to your deployed URL and add
   `https://YOUR-APP.vercel.app/auth/callback` (and `http://localhost:3000/auth/callback`) to the redirect URLs.
2. **Gemini key**: https://aistudio.google.com/apikey
3. **Env vars**: copy `.env.example` to `.env.local` for local dev, and add the same keys in Vercel → Project → Settings → Environment Variables.
4. `npm install && npm run dev`

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable / anon key (safe in the browser; RLS protects data) |
| `ALLOWED_EMAILS` | Comma-separated emails allowed to sign in |
| `GEMINI_API_KEY` | Server-only. Never commit it. |
| `GEMINI_MODEL` | Optional, defaults to `gemini-2.5-flash` |

Tip: in Supabase → Authentication → Sign In / Providers, turn off "Allow new users to sign up" after your first login.
