import "server-only";

const RULES = `
Hard rules:
- NEVER invent facts, numbers, tools, employers or results the candidate did not state.
- When a rewrite needs a number you don't have, use a placeholder like [X hrs] or [N users] and add a question asking for it.
  Every number you write (counts, %, $, "10K", "3x", and words like "five", "a dozen", "twice", "doubled", "half") must be
  stated by the candidate with the same unit: a bullet's rewrite may only use numbers from THAT bullet, the facts or the
  answers (never another bullet, the contact line, dates, GPA or course numbers, and never the job posting).
  Any other number is replaced with a placeholder automatically.
- Keep bullets to one line where possible (~25 words max), starting with a strong past-tense verb (present tense only for current roles).
- Be honest and specific. A weak bullet should be called weak.
- Tailoring means rewording, reordering and emphasizing what is already there. Never suggest adding a section the resume doesn't have.`;

/** Master-resume facts as a bulleted list for prompts ("" when there are none). */
export function formatFacts(facts: string[] | undefined): string {
  return (facts ?? [])
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => `- ${f}`)
    .join("\n");
}

export function analyzePrompt(args: {
  resume: string;
  job: string;
  /** Output of formatFacts(master.facts). */
  facts: string;
  answers: string;
}) {
  return `You are a blunt, expert tech recruiter and resume coach helping a college student tailor their resume to one job or internship.

JOB POSTING:
"""
${args.job.slice(0, 15000)}
"""

CANDIDATE RESUME (bullets are tagged [b:ID]):
"""
${args.resume}
"""

CANDIDATE FACTS (true, from their master resume; may be empty). Real details that didn't fit on the page;
use them in rewrites (numbers, tools, scope) only where they belong to that bullet's experience:
"""
${args.facts || "(none)"}
"""

CANDIDATE'S ANSWERS TO YOUR EARLIER QUESTIONS (true; may be empty):
"""
${args.answers || "(none)"}
"""
${RULES}

Return ONLY JSON with exactly this shape:
{
  "fit": "strong|possible|stretch",
  "verdict": "2-3 sentences: overall fit, and the single most important change to make",
  "keywords": { "matched": [important skills/terms from the posting the resume shows], "missing": [important posting terms absent from the resume] },
  "strengths": ["specific strengths for THIS job, citing resume content"],
  "gaps": [{ "issue": "what's missing or weak vs the posting", "severity": "high|medium|low", "fix": "concrete action" }],
  "bullets": [{ "bullet_id": "ID from [b:ID]", "rating": "strong|ok|weak", "note": "why, relative to this job", "rewrite": "improved bullet tailored to this job, or empty string if already strong" }],
  "questions": [{ "id": "q1", "question": "a question whose answer would strengthen the resume for this job (missing metrics, unlisted relevant experience, tools)", "why": "what it would improve", "bullet_id": "ID from [b:ID] when the question asks for the real value of a [placeholder] in that bullet's rewrite, else empty string", "placeholder": "that exact [placeholder] text, brackets included, copied from the rewrite, else empty string" }]
}
When a rewrite contains a [placeholder], ask one question per placeholder and set its bullet_id and placeholder so the answer can be filled in.
Fit (judge the candidate as shown by the resume plus the facts and answers above):
- "strong": meets the core requirements; a recruiter would likely move them forward.
- "possible": meets some core requirements, with gaps a tailored resume could reasonably cover.
- "stretch": missing several core requirements (level, degree, key skills); apply only if very interested.
Rate EVERY resume bullet. Ask 2-6 questions. Never ask anything the CANDIDATE FACTS or earlier answers already cover; use that information in the rewrites instead. Order gaps by severity.`;
}

export function coverLetterPrompt(args: { resume: string; job: string; facts: string; answers: string }) {
  return `Write a concise cover letter (under 250 words, 3 short paragraphs) for this candidate and job.
Sound like a sharp, genuine college student, not a template: no "I am writing to express my interest", no clichés.
Paragraph 1: why this specific company/role (use concrete details from the posting).
Paragraph 2: 2 most relevant accomplishments from the resume (or the true facts below), tied to the role's needs.
Paragraph 3: short close.
${RULES}
Use [placeholders] for anything you'd have to invent (e.g. hiring manager name). Return plain text only, starting with "Dear".

JOB:
"""
${args.job.slice(0, 12000)}
"""

RESUME:
"""
${args.resume}
"""

EXTRA TRUE FACTS ABOUT THE CANDIDATE (from their master resume; may be empty):
"""
${args.facts || "(none)"}
"""

CANDIDATE'S ANSWERS TO EARLIER QUESTIONS (may be empty):
"""
${args.answers || "(none)"}
"""`;
}

export function extractJobMetaPrompt(text: string) {
  return `From this job posting, extract the company name, job title and location.
Return ONLY JSON: {"company": "", "title": "", "location": ""}. Use "" for anything not stated.

"""
${text.slice(0, 6000)}
"""`;
}

export function parseResumePrompt(text: string | null) {
  return `Convert ${text === null ? "the attached resume PDF" : "this resume text"} into JSON. Preserve the wording exactly; do not improve or invent anything.
Shape:
{
  "header": { "name": "", "contact": "single line: location • email • phone • links" },
  "sections": [
    { "title": "section heading exactly as written (e.g. Education, Experience, Projects, Skills)",
      "items": [ {
        "title": "line 1, left: organization, school or project name",
        "location": "line 1, right: city/state or Remote (\"\" if none)",
        "subtitle": "line 2, left: job title/position, degree, or tech stack",
        "dates": "date range or graduation date (\"\" if none)",
        "bullets": ["..."] } ] }
  ]
}
Only include sections that appear in the resume. Never add sections, entries or content.
For skills lines like "Languages: Python, SQL", use title "Languages", subtitle "Python, SQL", no bullets, no dates.
For publications or memberships, put each one as its own item with the full text in "title" and no bullets.
Lines like "GPA: 3.85 | Dean's List" under a school go in that school's bullets.
Keep the original section order. Drop page numbers, headers/footers and icons.
Return ONLY JSON.${text === null ? "" : `

RESUME TEXT:
"""
${text.slice(0, 15000)}
"""`}`;
}
