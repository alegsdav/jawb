"use client";

import { useEffect, useRef, useState } from "react";
import type { Fact, Resume } from "@/lib/types";
import { postApi } from "@/lib/api";
import {
  BUILDER_KEY, builderStepErrors, emptyBuilder, EXPERIENCE_TYPES, MIN_WHAT, newExperience, readBuilder, type BuilderState,
  type Experience, type StepErrors,
} from "@/lib/builder";

const STEPS = ["About you", "Experiences & projects", "Skills & tools"] as const;

/** A labeled text field; the error (if any) is announced and tied to the input. */
function Field({
  id, label, value, onChange, error, hint, optional, type = "text", autoComplete, placeholder, multiline,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  optional?: boolean;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    value,
    placeholder,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    className: `input w-full ${multiline ? "min-h-28" : ""} ${error ? "border-bad" : ""}`,
  };
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label} {optional && <span className="font-normal text-muted">(optional)</span>}
      </label>
      {multiline ? (
        <textarea {...common} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type={type} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-xs text-bad">{error}</p>}
    </div>
  );
}

/**
 * "I don't have a resume yet": about you, experiences and projects (repeatable), skills and tools,
 * then "Build my resume". Answers are kept in localStorage (if available) so a refresh doesn't lose
 * them, and cleared once the resume is built.
 */
export function Builder({
  email, onBuilt, onCancel,
}: {
  email: string;
  onBuilt: (resume: Resume, facts: Fact[], entryIds: string[]) => void;
  onCancel: () => void;
}) {
  // Saved answers are read synchronously (the builder only mounts in the browser, after a click), so
  // the first save below can never overwrite them with a blank form.
  const [s, setS] = useState<BuilderState>(() => {
    try {
      const saved = readBuilder(localStorage.getItem(BUILDER_KEY));
      if (saved) return { ...saved, about: { ...saved.about, email: saved.about.email || email } };
    } catch {
      /* storage unavailable (private mode): the wizard still works, it just won't survive a refresh */
    }
    return emptyBuilder(email);
  });
  const [errors, setErrors] = useState<StepErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Save every change.
  useEffect(() => {
    try {
      localStorage.setItem(BUILDER_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, [s]);
  useEffect(() => headingRef.current?.focus(), [s.step]);
  useEffect(() => {
    if (!email) return;
    setS((cur) => (cur.about.email ? cur : { ...cur, about: { ...cur.about, email } }));
  }, [email]);

  const about = (k: keyof BuilderState["about"]) => (v: string) => setS((cur) => ({ ...cur, about: { ...cur.about, [k]: v } }));
  const exp = (i: number, patch: Partial<Experience>) =>
    setS((cur) => ({ ...cur, experiences: cur.experiences.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const skills = (k: keyof BuilderState["skills"]) => (v: string) => setS((cur) => ({ ...cur, skills: { ...cur.skills, [k]: v } }));

  function next() {
    const e = builderStepErrors(s, s.step);
    setErrors(e);
    if (Object.keys(e).length) {
      const first = Object.keys(e)[0].replace(".", "-");
      document.getElementById(`b-${first}`)?.focus();
      return;
    }
    setS((cur) => ({ ...cur, step: (cur.step + 1) as BuilderState["step"] }));
  }

  async function build() {
    for (const step of [1, 2] as const) {
      const e = builderStepErrors(s, step);
      if (Object.keys(e).length) {
        setErrors(e);
        setS((cur) => ({ ...cur, step }));
        return;
      }
    }
    setBusy(true);
    setError("");
    const { data, error: e } = await postApi<{ resume: Resume; facts: Fact[]; factsError?: string }>("/api/builder/draft", s);
    setBusy(false);
    if (e || !data?.resume) return setError(e ?? "Your resume didn't come back. Try again.");
    try {
      localStorage.removeItem(BUILDER_KEY);
    } catch {
      /* ignore */
    }
    // The experiences' entries (everything but Education and Skills), for "Go deeper".
    const entryIds = data.resume.sections
      .filter((sec) => sec.title !== "Education" && sec.title !== "Skills")
      .flatMap((sec) => sec.items.map((it) => it.id));
    onBuilt(data.resume, data.facts ?? [], entryIds);
  }

  const a = s.about;
  return (
    <div className="card p-4 sm:p-6 space-y-5 max-w-2xl">
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={s.step === i + 1 ? "step" : undefined} className={s.step === i + 1 ? "font-semibold text-accent" : "text-muted"}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
        {STEPS[s.step - 1]}
      </h2>

      {s.step === 1 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id="b-name" label="Full name" value={a.name} onChange={about("name")} error={errors.name} autoComplete="name" />
          </div>
          <Field id="b-email" label="Email" type="email" value={a.email} onChange={about("email")} error={errors.email} autoComplete="email" />
          <Field id="b-phone" label="Phone" type="tel" value={a.phone} onChange={about("phone")} optional autoComplete="tel" />
          <Field id="b-location" label="City, state" value={a.location} onChange={about("location")} optional placeholder="Boston, MA" />
          <Field id="b-links" label="LinkedIn, GitHub or portfolio" value={a.links} onChange={about("links")} optional placeholder="linkedin.com/in/you" />
          <div className="sm:col-span-2">
            <Field id="b-school" label="School" value={a.school} onChange={about("school")} error={errors.school} />
          </div>
          <Field id="b-degree" label="Degree" value={a.degree} onChange={about("degree")} error={errors.degree} placeholder="B.S." />
          <Field id="b-major" label="Major" value={a.major} onChange={about("major")} error={errors.major} placeholder="Data Science" />
          <Field id="b-graduation" label="Graduation date" value={a.graduation} onChange={about("graduation")} error={errors.graduation} placeholder="May 2027" />
          <Field id="b-gpa" label="GPA" value={a.gpa} onChange={about("gpa")} error={errors.gpa} optional hint="Include it if it's 3.0 or higher." />
        </div>
      )}

      {s.step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Jobs, internships, class or personal projects, clubs, volunteering, research. Anything counts. Tell us what you
            actually did in plain words; we&apos;ll turn it into resume bullets using only what you write.
          </p>
          {errors.experiences && <p role="alert" className="text-sm text-bad">{errors.experiences}</p>}
          {s.experiences.map((x, i) => (
            <fieldset key={x.id} className="rounded-lg border border-border p-3 space-y-3">
              <legend className="px-1 text-sm font-medium">
                {x.org.trim() || `Experience ${i + 1}`}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label htmlFor={`b-exp${i}-type`} className="text-sm font-medium">Type</label>
                  <select
                    id={`b-exp${i}-type`}
                    className="input w-full"
                    value={x.type}
                    onChange={(e) => exp(i, { type: e.target.value as Experience["type"] })}
                  >
                    {EXPERIENCE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <Field
                  id={`b-exp${i}-org`}
                  label={x.type === "project" ? "Project name" : "Organization"}
                  value={x.org}
                  onChange={(v) => exp(i, { org: v })}
                  error={errors[`exp${i}.org`]}
                />
                <Field id={`b-exp${i}-role`} label={x.type === "project" ? "Your role or tech stack" : "Your role"} value={x.role} onChange={(v) => exp(i, { role: v })} optional />
                <Field id={`b-exp${i}-location`} label="Location" value={x.location} onChange={(v) => exp(i, { location: v })} optional placeholder="Remote" />
                <Field id={`b-exp${i}-start`} label="Start" value={x.start} onChange={(v) => exp(i, { start: v })} optional placeholder="Sep 2024" />
                <Field id={`b-exp${i}-end`} label="End" value={x.end} onChange={(v) => exp(i, { end: v })} optional placeholder="Leave empty if ongoing" />
              </div>
              <Field
                id={`b-exp${i}-what`}
                label="What did you actually do?"
                multiline
                value={x.what}
                onChange={(v) => exp(i, { what: v })}
                error={errors[`exp${i}.what`]}
                hint={`A few sentences: what you did, for whom, with what tools, and anything that came of it. Rough numbers help (${Math.max(0, MIN_WHAT - x.what.trim().length) || "✓"}).`}
              />
              {s.experiences.length > 1 && (
                <button
                  type="button"
                  className="btn btn-sm text-bad"
                  onClick={() => setS((cur) => ({ ...cur, experiences: cur.experiences.filter((_, j) => j !== i) }))}
                >
                  Remove this one
                </button>
              )}
            </fieldset>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => setS((cur) => ({ ...cur, experiences: [...cur.experiences, newExperience()] }))}>
            + Add another
          </button>
        </div>
      )}

      {s.step === 3 && (
        <div className="space-y-3">
          <Field id="b-languages" label="Languages" value={s.skills.languages} onChange={skills("languages")} optional placeholder="Python, SQL, Spanish" />
          <Field id="b-tools" label="Tools and software" value={s.skills.tools} onChange={skills("tools")} optional placeholder="Excel, Tableau, Figma, Git" />
          <Field id="b-other" label="Other skills or interests" value={s.skills.other} onChange={skills("other")} optional />
          <p className="text-xs text-muted">
            Building your resume uses one of your daily analyses. The AI writes bullets only from what you wrote, with a
            [placeholder] where a number would help; nothing is invented.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-bad/40 bg-bad-bg px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {s.step > 1 ? (
          <button type="button" className="btn min-h-10" disabled={busy} onClick={() => setS((cur) => ({ ...cur, step: (cur.step - 1) as BuilderState["step"] }))}>
            Back
          </button>
        ) : (
          <button type="button" className="btn min-h-10" onClick={onCancel}>
            Other ways to start
          </button>
        )}
        <span className="text-xs text-muted">Your answers are saved on this device as you type.</span>
        {s.step < 3 ? (
          <button type="button" className="btn btn-primary min-h-10 ml-auto" onClick={next}>
            Next
          </button>
        ) : (
          <button type="button" className="btn btn-primary min-h-10 ml-auto" disabled={busy} onClick={build}>
            {busy ? "Building your resume…" : "Build my resume"}
          </button>
        )}
      </div>
    </div>
  );
}
