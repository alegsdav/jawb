# Job Pipeline

A small, single-user web app for applying to internships and jobs:

1. **Master resume**: a Google-Docs-style editor that shows your resume as a one-page Harvard-format document (Times, letter size, page-break guide). Import a PDF or pasted text; undo/redo with Ctrl/⌘+Z.
2. **Bullet bank**: fills itself with every bullet from your uploaded resume and every suggested rewrite you accept (always appended, never overwritten). Each job's **Bullets** tab also generates strong, role-specific example bullets modeled on your experience; their numbers are mock values in `[brackets]`, highlighted, and the PDF export warns if any are left in.
3. **Add a job**: paste a link (Greenhouse, Lever, Ashby and other JSON-LD pages fetch automatically) or paste/drop the description.
4. **Job workspace**: each job gets its own tailored copy of the master, analyzed automatically on first open. Bullets are highlighted strong/okay/weak; suggested rewrites appear as tracked changes (accept/reject one by one or all at once), edits are marked against the master, and the panel shows fit score, missing keywords, gaps and questions about numbers it needs from you.
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
| `GEMINI_MODEL` | Optional, defaults to `gemini-3.8-flash` |

Tip: in Supabase → Authentication → Sign In / Providers, turn off "Allow new users to sign up" after your first login.
