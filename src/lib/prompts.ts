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

/**
 * Split one of the student's answers into atomic facts. The model may only restate what the student
 * wrote; the server also drops any fact with a number the answer doesn't contain (guardNumbers).
 */
export function extractFactsPrompt(args: { answer: string; question: string; context: string }) {
  return `A college student answered a question about their own experience. Turn their answer into short, atomic facts
that can be reused on a resume later.

QUESTION THEY WERE ASKED (for context only; it is NOT a source of facts):
"""
${args.question.slice(0, 600) || "(none)"}
"""

THE RESUME LINE OR ENTRY IT'S ABOUT (for context only; it is NOT a source of facts):
"""
${args.context.slice(0, 1500) || "(none)"}
"""

THE STUDENT'S ANSWER (the ONLY source of facts):
"""
${args.answer.slice(0, 4000)}
"""

Rules:
- Restate ONLY what the student literally wrote in their answer. Never add, infer, round, combine or improve anything.
- NEVER invent numbers, tools, employers, titles or results. Every number in a fact must appear in the answer exactly
  (same value and unit); any fact with another number is thrown away automatically.
- Each fact is one self-contained statement that makes sense without the question, in resume style without "I"
  (e.g. "Tutored about 20 students a week in calculus"). Name what it's about (the club, class, job or project) when the
  answer or the context makes that clear.
- Skip anything vague, joking, or not about the student (e.g. "not sure", "n/a"). Zero facts is a fine answer.
- At most 6 facts.

Return ONLY JSON: {"facts": ["...", "..."]}`;
}

/** What the coaching prompts know about the entry being coached (the student's own resume text). */
export type CoachContext = {
  /** "Acme Corp | Data Analyst Intern | Boston, MA | Jun 2025 – Aug 2025". */
  entry: string;
  /** The entry's bullets, as written. */
  bullets: string[];
  /** The selected bullet, when a bullet (not the whole entry) is selected. */
  bullet: string;
  /** Output of formatFacts(...) for the relevant active facts. */
  facts: string;
  /** The job posting on a job tab; "" on the master resume. */
  job: string;
};

function coachHeader(c: CoachContext, task: string) {
  const target = c.job
    ? `They are tailoring it to the job posting below: use the posting's language and priorities (what this employer will look for).`
    : `This is their master resume (no specific job): aim for what makes a bullet strong to any recruiter for this kind of role.`;
  return `You are a warm, honest resume coach for college students who don't yet know what recruiters value. ${task}
${target}

RESUME ENTRY:
"""
${c.entry || "(untitled entry)"}
${c.bullets.map((b) => `- ${b}`).join("\n") || "(no bullets yet)"}
"""

${c.bullet ? `SELECTED BULLET:\n"""\n${c.bullet}\n"""\n` : ""}
STUDENT'S FACTS (true, things they told us; may be empty):
"""
${c.facts || "(none)"}
"""
${c.job ? `\nJOB POSTING:\n"""\n${c.job.slice(0, 8000)}\n"""\n` : ""}${RULES}
- Never fabricate employers, tools, technologies, titles or results the student did not state in the entry or facts.
- In coaching, a metric you don't know is a blank token like {{b1}} (described below), not a [placeholder].`;
}

/**
 * Example bullets with a blank for every metric. `round` > 1 ("More examples") asks for different
 * angles; earlier examples are never sent back (they're ephemeral and must not reach any prompt).
 */
export function coachExamplesPrompt(c: CoachContext & { round: number }) {
  return `${coachHeader(c, `Show the student up to 3 example bullets for ${c.bullet ? "the selected bullet" : "this entry"}, so they can see what a strong version looks like.`)}

How to write the examples:
- Build each example only from what the entry, the selected bullet and the facts say the student did. Same employer,
  same tools, same kind of work. You may suggest a stronger verb, clearer scope, and WHERE a result or metric would go.
- EVERY metric (any count, %, $, time, frequency, size, rank, or number word like "five" or "twice") must be a blank token
  {{b1}}, {{b2}}... in the text. Never write a number outside a blank, and never use [brackets]. Examples with a stray
  number are thrown away automatically.
- If one of the STUDENT'S FACTS states the value for a blank, set "from_fact" to that fact copied exactly and "fact_value"
  to the value exactly as the fact writes it. Otherwise leave both "".
- "why": one line on why a recruiter for this kind of role cares about this bullet. No statistics or numbers.
- "anatomy": label the parts, each with a span copied exactly from the text: "verb" (the opening action), "scope" (who/what/
  how big), "tool" (method or technology, if any), "result" (the outcome or impact).
- For each blank: "label" (what to measure, 2-5 words, e.g. "students tutored per week"), "hint" (a typical honest range
  for a student, phrased as a hint, e.g. "Most student tutors see somewhere between a handful and a few dozen a week"),
  "example_value" (an illustrative value with its unit, e.g. "15"), and "question" (plain language: how to find the real
  number, with an estimation tip, e.g. "Count a typical week and multiply by the weeks in the semester").
${c.round > 1 ? `- This is set #${c.round}: take different angles than the most obvious ones (for example lead with the outcome, the process, collaboration, or who benefited), with different verbs.\n` : ""}
Return ONLY JSON:
{ "examples": [ { "text": "Led {{b1}} weekly calculus review sessions...", "why": "", "anatomy": [{ "part": "verb", "span": "Led" }],
  "blanks": [{ "key": "b1", "label": "", "hint": "", "example_value": "", "question": "", "from_fact": "", "fact_value": "" }] } ] }`;
}

/** 3 to 5 questions that help the student find the real details and numbers for an entry. */
export function coachQuestionsPrompt(c: CoachContext) {
  return `${coachHeader(c, `Ask the student 3 to 5 short questions that would let them write a strong bullet for ${c.bullet ? "the selected bullet" : "this entry"}: real numbers, scope, tools, and results they may not realize count.`)}

- Ask about what they actually did; never assume results.
- Don't ask anything the STUDENT'S FACTS already answer.
- Each question must be answerable in rough form ("about 20", "maybe 3 hours a week") or skipped.
- "why": one line on why it matters to a recruiter. "tip": how to estimate if they don't know exactly
  (e.g. "Think of a typical week and multiply").

Return ONLY JSON: { "questions": [ { "question": "", "why": "", "tip": "" } ] }`;
}
