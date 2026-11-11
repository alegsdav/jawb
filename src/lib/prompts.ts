import "server-only";

const RULES = `
Hard rules:
- NEVER invent facts, numbers, tools, employers or results the candidate did not state.
- When a rewrite needs a number you don't have, use a placeholder like [X hrs] or [N users] and add a question asking for it.
- Keep bullets to one line where possible (~25 words max), starting with a strong past-tense verb (present tense only for current roles).
- Be honest and specific. A weak bullet should be called weak.`;

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
    { "title": "Education|Experience|Projects|Skills|Publications|Leadership|...",
      "items": [ { "title": "role or degree or skill category", "subtitle": "organization / school / skill list", "location": "", "dates": "", "bullets": ["..."] } ] }
  ]
}
For skills lines like "Languages: Python, SQL", use title "Languages", subtitle "Python, SQL", no bullets.
For publications, put each citation as its own item with the full citation in "title".
Keep the original section order. Drop page numbers, headers/footers and icons.
Return ONLY JSON.${text === null ? "" : `

RESUME TEXT:
"""
${text.slice(0, 15000)}
"""`}`;
}
