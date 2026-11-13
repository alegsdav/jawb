import "server-only";

const RULES = `
Hard rules:
- NEVER invent facts, numbers, tools, employers or results the candidate did not state.
- When a rewrite needs a number you don't have, use a placeholder like [X hrs] or [N users] and add a question asking for it.
- Keep bullets to one line where possible (~25 words max), starting with a strong past-tense verb (present tense only for current roles).
- Be honest and specific. A weak bullet should be called weak.
- Tailoring means rewording, reordering and emphasizing what is already there. Never suggest adding a section the resume doesn't have.`;

export function analyzePrompt(args: {
  resume: string;
  job: string;
  bank: string;
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

BULLET BANK (extra true facts/bullets the candidate has, tagged [bank:ID]; may be empty):
"""
${args.bank || "(empty)"}
"""

CANDIDATE'S ANSWERS TO YOUR EARLIER QUESTIONS (may be empty):
"""
${args.answers || "(none)"}
"""
${RULES}

Return ONLY JSON with exactly this shape:
{
  "fit_score": integer 0-100 (how well this resume, as written, matches the posting),
  "verdict": "2-3 sentences: overall fit, and the single most important change to make",
  "keywords": { "matched": [important skills/terms from the posting the resume shows], "missing": [important posting terms absent from the resume] },
  "strengths": ["specific strengths for THIS job, citing resume content"],
  "gaps": [{ "issue": "what's missing or weak vs the posting", "severity": "high|medium|low", "fix": "concrete action" }],
  "bullets": [{ "bullet_id": "ID from [b:ID]", "rating": "strong|ok|weak", "note": "why, relative to this job", "rewrite": "improved bullet tailored to this job, or empty string if already strong" }],
  "bank_suggestions": [{ "bank_id": "ID from [bank:ID]", "reason": "why to add it for this job" }],
  "questions": [{ "id": "q1", "question": "a question whose answer would strengthen the resume for this job (missing metrics, unlisted relevant experience, tools)", "why": "what it would improve" }]
}
Rate EVERY resume bullet. Ask 2-6 questions, skipping anything already answered. Order gaps by severity.`;
}

export function coverLetterPrompt(args: { resume: string; job: string; answers: string }) {
  return `Write a concise cover letter (under 250 words, 3 short paragraphs) for this candidate and job.
Sound like a sharp, genuine college student, not a template: no "I am writing to express my interest", no clichés.
Paragraph 1: why this specific company/role (use concrete details from the posting).
Paragraph 2: 2 most relevant accomplishments from the resume, tied to the role's needs.
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

EXTRA FACTS FROM THE CANDIDATE:
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

export function exampleBulletsPrompt(args: { job: string; entries: string; resume: string; mine: string }) {
  return `You are an expert tech recruiter. Write EXAMPLE resume bullets showing what a top-tier candidate's bullets
look like for this specific job, modeled on this candidate's real experiences. They are inspiration for the candidate,
clearly labeled as examples, not claims.

JOB POSTING:
"""
${args.job.slice(0, 12000)}
"""

CANDIDATE'S RESUME ENTRIES (tagged [entry:ID]):
${args.entries}

FULL RESUME:
"""
${args.resume}
"""

CANDIDATE'S OWN BULLET BANK (facts they've written; may be empty):
"""
${args.mine || "(empty)"}
"""

Rules:
- Write 8-10 bullets total. Cover each entry that is relevant to this job (1-2 bullets each); skip irrelevant ones.
- Stay close to what the candidate actually did at each entry (same organization, domain and tools), but phrase it the
  way the strongest applicant for THIS role would, using the posting's language and priorities.
- EVERY number, metric, count, percentage or scale MUST be a mock example wrapped in square brackets, e.g. "[40%]",
  "[12K+ records]", "[3 teams]", "[~200 ms]". Pick values that are strong but realistic for a student intern.
- One line each (~20-28 words), strong past-tense verb first, what + how (tools) + measurable result.
- No first person, no fluff ("responsible for", "helped with").

Return ONLY JSON:
{ "examples": [ { "entry_id": "ID from [entry:ID], or \\"\\" if it fits no entry", "text": "bullet", "why": "one short phrase on what makes it strong for this role" } ] }`;
}
