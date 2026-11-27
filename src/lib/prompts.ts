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
- Tailoring means rewording, reordering and emphasizing what is already there. Never suggest adding content or sections the resume doesn't have.`;

/**
 * Applied on top of the job match in analyzePrompt. Sales-document advice for student resumes.
 * Its first line makes the number-honesty rules win any conflict.
 */
const REVIEW_RUBRIC = `
Resume review rubric (apply it on top of the job match; the number-honesty rules above win any conflict with it):
1. Section order sends signals (student resumes):
- Education goes at the top: recruiters look for the graduation date and current-student status first.
- Technical Skills goes near the bottom: it mainly helps ATS keyword matching and doesn't prove depth.
- Leadership and extracurriculars matter: they show soft skills and teamwork.
- If the order is off, add a gap (severity "medium", or "low" if only minor).
- If there is no leadership or activities section, add a "low" gap phrased as "if you have any…". This is the ONE exception
  to the "never suggest adding content or sections" rule above. It never invents content.
2. Less experience, more impact. A resume is a sales document, not a timeline.
- Prefer fewer roles with strong, specific bullets.
- If an entry is weak and irrelevant to this job, a gap's fix may say to cut or condense it so stronger entries get the space.
3. Outcomes, not responsibilities.
- Rate a bullet "weak" when it describes duties or teamwork without a result ("Collaborated with engineers, designers, and PMs").
- Rewrites use Google's XYZ formula: "Accomplished X as measured by Y, by doing Z". Result first, then the measure, then how.
4. Specific, not fluffy.
- Vague metrics ("improved productivity by 20%") rate "ok" at best.
- The note says what is unclear: what was measured, how, and what changed.
- The question asks for the concrete definition.
5. Questions help the student find what matters for this role: how success was measured, what changed because of their work,
   and scale (users, revenue, time saved). They are still subject to the never-invent rules.`;

/** Shared by the coaching and builder prompts: what a strong bullet is made of. */
const BULLET_CRAFT = `BULLET CRAFT:
- Outcomes over duties: say what changed because of the student's work, not just what they were responsible for.
- XYZ shape: "Accomplished X as measured by Y, by doing Z". Lead with the result, then the measure, then how.
- Specific over vague: name what was measured and what changed. Any number the student didn't give is left as the blank
  this prompt specifies, never estimated.`;

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
${RULES}
${REVIEW_RUBRIC}

Return ONLY JSON with exactly this shape:
{
  "fit": "strong|possible|stretch",
  "verdict": "2-3 sentences: overall fit, and the single most important change to make",
  "keywords": { "matched": [important skills/terms from the posting the resume shows], "missing": [important posting terms absent from the resume] },
  "strengths": ["specific strengths for THIS job, citing resume content"],
  "gaps": [{ "issue": "what's missing or weak vs the posting", "severity": "high|medium|low", "fix": "concrete action" }],
  "bullets": [{ "bullet_id": "ID from [b:ID]", "rating": "strong|ok|weak", "note": "why, relative to this job", "rewrite": "improved bullet tailored to this job, or empty string if already strong", "why": "one sentence, at most 25 words, to the student: what the rewrite changes and why a recruiter for THIS job will care, or empty string when rewrite is empty" }],
  "questions": [{ "id": "q1", "question": "a question whose answer would strengthen the resume for this job (missing metrics, unlisted relevant experience, tools)", "why": "what it would improve", "bullet_id": "ID from [b:ID] when the question asks for the real value of a [placeholder] in that bullet's rewrite, else empty string", "placeholder": "that exact [placeholder] text, brackets included, copied from the rewrite, else empty string" }]
}
When a rewrite contains a [placeholder], ask one question per placeholder and set its bullet_id and placeholder so the answer can be filled in.
Fit (judge the candidate as shown by the resume plus the facts and answers below):
- "strong": meets the core requirements; a recruiter would likely move them forward.
- "possible": meets some core requirements, with gaps a tailored resume could reasonably cover.
- "stretch": missing several core requirements (level, degree, key skills); apply only if very interested.
Rate EVERY resume bullet. Ask 2-6 questions. Never ask anything the CANDIDATE FACTS or the candidate's answers below already cover; use that information in the rewrites instead. Order gaps by severity.
Never mention bullet ids ([b:…] or b:…) in any text field; refer to a bullet by its words instead.

The job posting, the candidate's resume, their facts and their answers follow. Apply everything above to them.

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
"""`;
}

export function coverLetterPrompt(args: { resume: string; job: string; facts: string; answers: string }) {
  return `Write a concise cover letter (under 250 words, 3 short paragraphs) for this candidate and job.
Sound like a sharp, genuine college student, not a template: no "I am writing to express my interest", no clichés.
Paragraph 1: why this specific company/role (use concrete details from the posting).
Paragraph 2: 2 most relevant accomplishments from the resume (or the true facts below), tied to the role's needs.
Paragraph 3: short close.
${RULES}
Use [placeholders] for anything you'd have to invent (e.g. hiring manager name). Return plain text only, starting with "Dear".

The job posting, the candidate's resume, their facts and their answers follow. Write the letter from them.

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

/**
 * One light read of a fetched job link: is the page one open posting, closed, or something else (a list of
 * openings, a careers home page)? Also returns the company, title and location as written in the posting.
 */
export function checkJobPagePrompt(pageText: string, pageTitle: string) {
  return `You are checking a web page that a student gave as a link to a job posting.
Decide whether the page is ONE specific job posting that is still open for applications.

Answer "closed" if the page says the job is no longer available or accepting applications, has been filled or has
expired, or shows an error such as "job not found".
Answer "not_a_posting" if the page is a list of many openings, a company careers or home page, a search page, a login
page, or anything other than a single job posting.
Otherwise answer "open". When unsure, answer "open".

Also extract the hiring company's name as people write it (e.g. "Belvedere Trading", not "belvederetrading"), the job
title and the location, from the posting only. Use "" for anything not stated.

Return ONLY JSON: {"status": "open" | "closed" | "not_a_posting", "company": "", "title": "", "location": ""}

The page details follow.

PAGE TITLE: ${pageTitle.slice(0, 200) || "(none)"}
PAGE TEXT:
"""
${pageText.slice(0, 6000)}
"""`;
}

export function extractJobMetaPrompt(text: string) {
  return `From this job posting, extract the company name, job title and location.
Return ONLY JSON: {"company": "", "title": "", "location": ""}. Use "" for anything not stated.

The posting follows.

"""
${text.slice(0, 6000)}
"""`;
}

/**
 * Split one of the student's answers into atomic facts. The model may only restate what the student
 * wrote; the server also drops any fact with a number the answer doesn't contain (guardNumbers).
 */
export function extractFactsPrompt(args: { answer: string; question: string; context: string }) {
  return `A college student answered a question about their own experience. Turn their answer into short, atomic facts
that can be reused on a resume later. Three labelled sections follow the rules: the resume line the answer is about,
the question they were asked, and their answer. Only the answer is a source of facts; the other two are context.

Rules:
- Restate ONLY what the student literally wrote in their answer. Never add, infer, round, combine or improve anything.
- NEVER invent numbers, tools, employers, titles or results. Every number in a fact must appear in the answer exactly
  (same value and unit); any fact with another number is thrown away automatically.
- Each fact is one self-contained statement that makes sense without the question, in resume style without "I"
  (e.g. "Tutored about 20 students a week in calculus"). Name what it's about (the club, class, job or project) when the
  answer or the context makes that clear.
- Skip anything vague, joking, or not about the student (e.g. "not sure", "n/a"). Zero facts is a fine answer.
- At most 6 facts.

Return ONLY JSON: {"facts": ["...", "..."]}

The student's details follow.

THE RESUME LINE OR ENTRY IT'S ABOUT (for context only; it is NOT a source of facts):
"""
${args.context.slice(0, 1500) || "(none)"}
"""

QUESTION THEY WERE ASKED (for context only; it is NOT a source of facts):
"""
${args.question.slice(0, 600) || "(none)"}
"""

THE STUDENT'S ANSWER (the ONLY source of facts):
"""
${args.answer.slice(0, 4000)}
"""`;
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

/** Fixed coaching instructions: the role, the rules every coaching prompt shares, then the task's own rules. */
function coachInstructions(task: string, taskRules: string) {
  return `You are a warm, honest resume coach for college students who don't yet know what recruiters value. ${task}
Check the JOB POSTING section below. If it holds a posting, they are tailoring this entry to that job: use the posting's language and priorities (what this employer will look for). If it says (none), this is their master resume (no specific job): aim for what makes a bullet strong to any recruiter for this kind of role.

${RULES}
- Never fabricate employers, tools, technologies, titles or results the student did not state in the entry or facts.
- In coaching, a metric you don't know is a blank token like {{b1}} (described in the rules below), not a [placeholder].

${taskRules}`;
}

/** The variable coaching data, most stable first: the job posting, the entry, its facts, then the selected bullet. */
function coachData(c: CoachContext) {
  return `JOB POSTING:
"""
${c.job ? c.job.slice(0, 8000) : "(none: this is the master resume)"}
"""

RESUME ENTRY:
"""
${c.entry || "(untitled entry)"}
${c.bullets.map((b) => `- ${b}`).join("\n") || "(no bullets yet)"}
"""

STUDENT'S FACTS (true, things they told us; may be empty):
"""
${c.facts || "(none)"}
"""

SELECTED BULLET (when it says (none), the whole entry is the subject):
"""
${c.bullet || "(none)"}
"""`;
}

/**
 * Example bullets with a blank for every metric. `round` > 1 ("More examples") asks for different
 * angles; earlier examples are never sent back (they're ephemeral and must not reach any prompt).
 */
export function coachExamplesPrompt(c: CoachContext & { round: number }) {
  return `${coachInstructions("Show the student up to 3 example bullets for the SELECTED BULLET below (or for the whole entry when it says (none)), so they can see what a strong version looks like.", `${BULLET_CRAFT}

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
- If the ROUND line below is more than 1, this is a "More examples" set: take different angles than the most obvious ones (for example lead with the outcome, the process, collaboration, or who benefited), with different verbs.

Return ONLY JSON:
{ "examples": [ { "text": "Led {{b1}} weekly calculus review sessions...", "why": "", "anatomy": [{ "part": "verb", "span": "Led" }],
  "blanks": [{ "key": "b1", "label": "", "hint": "", "example_value": "", "question": "", "from_fact": "", "fact_value": "" }] } ] }`)}

The student's details follow.

${coachData(c)}

ROUND: ${c.round}`;
}

/** 3 to 5 questions that help the student find the real details and numbers for an entry. */
export function coachQuestionsPrompt(c: CoachContext) {
  return `${coachInstructions("Ask the student 3 to 5 short questions that would let them write a strong bullet for the SELECTED BULLET below (or for the whole entry when it says (none)): real numbers, scope, tools, and results they may not realize count.", `- Ask about what they actually did; never assume results.
- Don't ask anything the STUDENT'S FACTS already answer.
- Each question must be answerable in rough form ("about 20", "maybe 3 hours a week") or skipped.
- "why": one line on why it matters to a recruiter. "tip": how to estimate if they don't know exactly
  (e.g. "Think of a typical week and multiply").

Return ONLY JSON: { "questions": [ { "question": "", "why": "", "tip": "" } ] }`)}

The student's details follow.

${coachData(c)}`;
}

/**
 * Draft bullets for the guided builder. The page builds everything else (header, education, dates,
 * skills) from the student's answers; the model only writes bullets, keyed by experience id.
 */
export function builderDraftPrompt(experiences: { id: string; type: string; org: string; role: string; what: string }[], major: string) {
  return `A college student is writing their first resume. The MAJOR line below gives their major, or says (not given). For each experience in the EXPERIENCES section below, write 2 to 4
Harvard-style resume bullets from what they wrote.
${RULES}
- Use ONLY what the student wrote for THAT experience: never add tools, people, employers, numbers or results they didn't
  state. If a strong bullet needs a metric they didn't give, write a [placeholder] such as [N students] or [X%] instead.
- Every number you keep must appear in that experience's own answer, with the same unit; any other number becomes a
  placeholder automatically.
- Start each bullet with a strong past-tense verb (present tense if it's ongoing). One line each.

${BULLET_CRAFT}

Return ONLY JSON: { "bullets": { "<experience id>": ["...", "..."] } }

The student's details follow.

MAJOR: ${major || "(not given)"}

EXPERIENCES (JSON):
${JSON.stringify(experiences.map((x) => ({ id: x.id, type: x.type, organization: x.org, role: x.role, what_they_did: x.what })), null, 1).slice(0, 14000)}`;
}

/**
 * Pasted resume text (or a .txt/.md upload) as JSON. The text has no formatting, so the model works out the
 * structure. It copies the wording exactly and never invents anything.
 */
export function parseResumePrompt(text: string) {
  return `Convert this resume text into JSON. The text is unformatted: work out the structure yourself, meaning the name,
the contact line, the section headings (Education, Experience, Projects, Skills...), and within each section each entry
(a job, school, project or activity) with its dates and its bullets.
Preserve the wording exactly; do not improve, correct or invent anything.

Shape:
{
  "header": { "name": "the candidate's name", "contact": "one line: location • email • phone • links, as written, with each link's label and address (e.g. LinkedIn (https://www.linkedin.com/in/x))" },
  "sections": [
    { "title": "section heading exactly as written (e.g. Education, Experience, Projects, Skills)",
      "items": [ {
        "title": "organization, school or project name (\\"\\" if none)",
        "subtitle": "job title/position, degree, or tech stack (\\"\\" if none)",
        "location": "city/state or Remote (\\"\\" if none)",
        "dates": "date range or graduation date (\\"\\" if none)",
        "bullets": ["one string per bullet, without the bullet glyph"] } ] }
  ]
}

Rules:
- NEVER invent facts, numbers, dates, names, employers, tools or results. Copy the candidate's words verbatim.
- A line that is a single labelled list, such as "Languages: Python, SQL", is an item whose "title" is the label
  ("Languages"), whose "subtitle" is the value ("Python, SQL"), with "location": "", "dates": "" and "bullets": [].
- Lines under an entry that start with a bullet glyph (•, -, *, ●) or are clearly separate points are its "bullets".
- Keep every URL, email address and link label exactly as written, including a label followed by its address in
  brackets such as "LinkedIn (https://www.linkedin.com/in/x)". Never drop, shorten or reword a link.
- Keep [placeholders] exactly as written, brackets included.
- Use "" for anything not stated. Return ONLY the JSON.

The resume text follows.

RESUME TEXT:
"""
${text}
"""`;
}
