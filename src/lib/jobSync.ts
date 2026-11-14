import type { SupabaseClient } from "@supabase/supabase-js";
import type { Analysis, Item, Job, Resume, Section } from "./types";
import { MASTER_RETRIES, mergeResumes, sameJson, type MergeConflict, type MergeResult } from "./master";
import { normalizeResume, bulletTextMap } from "./resume";
import { normalizeAnalysis } from "./analysis";
import { dbErrorMessage, isMissingColumn, OPTIONAL_JOB_COLUMNS } from "./db";
import {
  diffFields, HEADER_CONTACT, HEADER_NAME, JOB_FIELDS, makeBaseline, missingOptionalColumns, omitKeys, planPull, readBaseline,
  stripBaseline,
} from "./tailor";

/**
 * Keeping one job in sync across devices (laptop tab + phone, often open at the same time).
 *
 * Both rows the job page writes (`jobs` and the job's tailored copy in `resumes`) are written only
 * if the row's `updated_at` is still what this tab last loaded or saved. When another device saved
 * in between (0 rows match), the tab re-reads the row and merges:
 *
 * - Job fields: only the fields this tab changed since its last save are re-applied on top of the
 *   row as it is now (`rebaseJob`). The analysis is never replaced: `mergeAnalyses`.
 * - Tailored copy: a three-way merge like the master resume's (`mergeTailored`); if both devices
 *   changed the same line, the page stops autosaving and asks.
 *
 * Everything here except the few `supabase` helpers at the bottom is pure, so it's unit-tested.
 */

type Question = Analysis["questions"][number];

const normQ = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
const runTime = (a: Analysis) => {
  const t = Date.parse(a.analyzed_at ?? "");
  return Number.isFinite(t) ? t : 0;
};

// ---------- analysis ----------

/**
 * Three-way merge of a job's stored analysis. `base` is the analysis this tab last loaded or saved,
 * `local` what this tab has now, `server` what the row holds now.
 *
 * - The newer run (later `analyzed_at`) supplies the questions, ratings and suggestions. Answered
 *   questions only the other side has are kept (appended), so no answer is ever dropped.
 * - Answers merge per question (by id, or by question text across runs): whichever side changed an
 *   answer since `base` wins; a cleared answer stays cleared unless the other side edited it; if both
 *   changed it differently, this tab's answer wins (it was just saved here) unless this tab cleared it.
 * - `dismissed` (rejected suggestions) is the union of both sides for the same run; after a newer run
 *   it's that run's list (the old rejections were for the old suggestions).
 */
export function mergeAnalyses(base: Analysis | null, local: Analysis | null, server: Analysis | null): Analysis | null {
  if (!local) return server;
  if (!server) return local;
  if (sameJson(local, server)) return local;
  const lt = runTime(local);
  const st = runTime(server);
  const primary = st > lt ? server : local;

  const questions = [...primary.questions];
  const byId = new Map(questions.map((q) => [q.id, q]));
  const byText = new Map(questions.map((q) => [normQ(q.question), q.id]));
  /** Key of a question in the merged list; "~text" when it isn't there (yet). */
  const keyOf = (q: Question) => {
    const same = byId.get(q.id);
    if (same && normQ(same.question) === normQ(q.question)) return q.id;
    return byText.get(normQ(q.question)) ?? `~${normQ(q.question)}`;
  };
  type Entry = { v: string; q?: Question };
  const keyed = (a: Analysis | null) => {
    const out = new Map<string, Entry>();
    if (!a) return out;
    const qs = new Map(a.questions.map((q) => [q.id, q]));
    for (const [id, v] of Object.entries(a.answers ?? {})) {
      if (!v?.trim()) continue;
      const q = qs.get(id);
      out.set(q ? keyOf(q) : `#${id}`, { v, q });
    }
    return out;
  };
  const L = keyed(local);
  const S = keyed(server);
  const B = keyed(base);

  const answers: Record<string, string> = {};
  for (const k of new Set([...L.keys(), ...S.keys()])) {
    const l = L.get(k);
    const s = S.get(k);
    const lv = l?.v ?? "";
    const sv = s?.v ?? "";
    const bv = B.get(k)?.v ?? "";
    // Both changed it: this tab's answer, unless this tab cleared it (an edit beats a deletion).
    const win = lv === sv ? l : lv === bv ? s : sv === bv ? l : lv.trim() ? l : s;
    if (!win?.v.trim()) continue;
    if (k.startsWith("#")) answers[k.slice(1)] = win.v;
    else if (k.startsWith("~")) {
      // An answered question the newer run doesn't ask: keep it, with its answer.
      const q = win.q ?? l?.q ?? s?.q;
      if (!q) continue;
      let id = q.id;
      while (byId.has(id)) id = `${id}_`;
      const added = { ...q, id };
      questions.push(added);
      byId.set(id, added);
      byText.set(normQ(q.question), id);
      answers[id] = win.v;
    } else answers[k] = win.v;
  }

  const dismissed =
    st > lt ? server.dismissed : lt > st ? local.dismissed : [...new Set([...(local.dismissed ?? []), ...(server.dismissed ?? [])])];
  const out: Analysis = { ...primary, questions, answers };
  if (dismissed && (dismissed.length || local.dismissed || server.dismissed)) out.dismissed = dismissed;
  else delete out.dismissed;
  return out;
}

/**
 * The answer boxes after the analysis changed under them (a merge or a refresh from another device).
 * Boxes this tab hasn't touched since the last save show the new answers. Text typed here and not
 * saved yet (a "dirty" draft) stays, matched to the new question by id or question text; if the new
 * analysis doesn't ask that question any more, the question is kept (appended) so the text isn't lost.
 */
export function carryDrafts(
  prev: Analysis | null,
  next: Analysis | null,
  drafts: Record<string, string>,
): { analysis: Analysis | null; drafts: Record<string, string> } {
  if (!next) return { analysis: next, drafts };
  const out: Record<string, string> = { ...(next.answers ?? {}) };
  let analysis = next;
  for (const q of prev?.questions ?? []) {
    const d = drafts[q.id];
    if (d === undefined || d === (prev?.answers?.[q.id] ?? "")) continue; // not dirty
    const same = analysis.questions.find((x) => x.id === q.id && normQ(x.question) === normQ(q.question));
    const hit = same ?? analysis.questions.find((x) => normQ(x.question) === normQ(q.question));
    if (hit) {
      out[hit.id] = d;
      continue;
    }
    if (!d.trim()) continue;
    let id = q.id;
    while (analysis.questions.some((x) => x.id === id)) id = `${id}_`;
    analysis = { ...analysis, questions: [...analysis.questions, { ...q, id }] };
    out[id] = d;
  }
  return { analysis, drafts: out };
}

// ---------- job row ----------

/** The job fields this tab changed since `base` (the row as last loaded or saved here), analysis included. */
export function jobPatch(base: Job, local: Job): Partial<Job> {
  const patch: Partial<Job> = diffFields(base, local, JOB_FIELDS);
  if (!sameJson(base.analysis ?? null, local.analysis ?? null)) patch.analysis = local.analysis;
  return patch;
}

/**
 * This tab's job after another device saved the row: the row as it is now (`server`), with this
 * tab's unsaved field edits (fields that differ between `base` and `local`) re-applied on top, and
 * the analysis merged (mergeAnalyses), never replaced.
 */
export function rebaseJob(local: Job, base: Job, server: Job): Job {
  const dirty = diffFields(base, local, JOB_FIELDS);
  const analysis = mergeAnalyses(base.analysis ?? null, local.analysis ?? null, server.analysis ?? null);
  return { ...server, ...dirty, analysis };
}

/** A job row from the database, with its analysis normalized. */
export function jobFromRow(row: unknown): Job {
  const j = row as Job;
  return { ...j, analysis: j.analysis ? normalizeAnalysis(j.analysis) : null };
}

/** True when a status patch freezes a new "what you sent" snapshot (so it must not replace one). */
export const freezesSnapshot = (patch: Partial<Job>) => !!patch.submitted_at && "submitted_resume" in patch;

/**
 * What to do when a conditional status write matched 0 rows, given the row re-read just after.
 * - "already-applied": the patch would freeze a snapshot, but another device froze one first.
 *   Show theirs and tell the user; never overwrite it.
 * - "gone": the job was deleted elsewhere.
 * - "retry": something else changed; recompute the status change from the fresh row and try again.
 */
export function statusConflictOutcome(patch: Partial<Job>, fresh: Pick<Job, "submitted_at"> | null): "already-applied" | "gone" | "retry" {
  if (!fresh) return "gone";
  if (freezesSnapshot(patch) && fresh.submitted_at) return "already-applied";
  return "retry";
}

/** Whether the job page should show the quiet "you applied" view (back to To apply/Skipped shows the normal page). */
export const isApplied = (j: Pick<Job, "submitted_at" | "status">) =>
  !!j.submitted_at && ["applied", "interview", "offer", "rejected"].includes(j.status);

// ---------- tailored copy ----------

/** The tailored copy stored in a `resumes` row (normalizeResume drops `baseline`, so it's read back here). */
export function tailoredFromRow(content: unknown): Resume {
  const base = readBaseline(content);
  return { ...normalizeResume(content), ...(base ? { baseline: base } : {}) };
}

/** Key-wise three-way merge of a tailored copy's baseline (whichever side changed a key wins; both: local). */
export function mergeBaselines(
  b: Record<string, string> | undefined,
  l: Record<string, string> | undefined,
  s: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!l && !s) return undefined;
  if (sameJson(l, s)) return l;
  const base = b ?? {};
  const local = l ?? {};
  const server = s ?? {};
  const out: Record<string, string> = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(server)])) {
    const lv = local[k];
    const sv = server[k];
    const v = lv === sv ? lv : lv === base[k] ? sv : sv === base[k] ? lv : lv;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Three-way merge of a job's tailored copy (base = what this tab last loaded or saved, local = on
 * screen, server = the row now): mergeResumes for the content, mergeBaselines for the bookkeeping.
 */
export function mergeTailored(base: Resume, local: Resume, server: Resume): MergeResult {
  const { merged, conflicts } = mergeResumes(stripBaseline(base), stripBaseline(local), stripBaseline(server));
  const baseline = mergeBaselines(base.baseline, local.baseline, server.baseline);
  const body = stripBaseline(merged);
  return { merged: baseline ? { ...body, baseline } : body, conflicts };
}

export type RefreshPlan =
  | { kind: "none" }
  | { kind: "replace"; content: Resume }
  | { kind: "merge"; content: Resume }
  | { kind: "conflict"; conflicts: MergeConflict[] };

/**
 * What a refresh (the tab came back into view) does with a re-read tailored copy:
 * nothing new on the server -> "none"; nothing unsaved here -> show theirs ("replace");
 * unsaved edits here -> three-way merge ("merge", then save) or, if both changed the same line, "conflict".
 */
export function planTailoredRefresh(
  base: { content: Resume; updatedAt: string },
  local: Resume,
  server: { content: Resume; updatedAt: string },
): RefreshPlan {
  if (server.updatedAt === base.updatedAt || sameJson(server.content, base.content)) return { kind: "none" };
  if (sameJson(local, base.content)) return { kind: "replace", content: server.content };
  const { merged, conflicts } = mergeTailored(base.content, local, server.content);
  if (conflicts.length) return { kind: "conflict", conflicts };
  return { kind: "merge", content: merged };
}

// ---------- "Save this tailored copy as my master resume" ----------

const SECTION_KEY = "section:";
const ITEM_KEY = "item:";
const hasStructure = (base: Record<string, string>) => Object.keys(base).some((k) => k.startsWith(SECTION_KEY) || k.startsWith(ITEM_KEY));
const shortLabel = (t: string, n = 90) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const itemLabel = (it: Item) => [it.title, it.subtitle].map((x) => x.trim()).filter(Boolean).join(" — ") || "Untitled entry";

/**
 * The master as it was when the copy was made (or last pulled), rebuilt from the copy's structure
 * and its baseline: the copy's sections/entries/bullets that the baseline knows, with the baseline's
 * wording. Entry details the baseline doesn't record (second line, location, dates) use the master's
 * current value, so an edit made in the copy counts as an edit.
 */
export function baseFromBaseline(copy: Resume, master: Resume): Resume {
  const base = copy.baseline ?? {};
  const structured = hasStructure(base);
  const mSections = new Map(master.sections.map((s) => [s.id, s]));
  const mItems = new Map(master.sections.flatMap((s) => s.items.map((it) => [it.id, it] as const)));
  const sections: Section[] = [];
  for (const s of copy.sections) {
    const ms = mSections.get(s.id);
    const items: Item[] = [];
    for (const it of s.items) {
      const mi = mItems.get(it.id);
      const inBase = structured ? ITEM_KEY + it.id in base : !!mi || it.bullets.some((b) => b.id in base);
      if (!inBase) continue;
      items.push({
        id: it.id,
        title: base[ITEM_KEY + it.id] ?? mi?.title ?? it.title,
        subtitle: mi?.subtitle ?? it.subtitle,
        location: mi?.location ?? it.location,
        dates: mi?.dates ?? it.dates,
        bullets: it.bullets.filter((b) => b.id in base).map((b) => ({ id: b.id, text: base[b.id] })),
      });
    }
    const inBase = structured ? SECTION_KEY + s.id in base : !!ms || items.length > 0;
    if (!inBase) continue;
    sections.push({ id: s.id, title: base[SECTION_KEY + s.id] ?? ms?.title ?? s.title, items });
  }
  return {
    ...(master.version !== undefined ? { version: master.version } : {}),
    header: { name: base[HEADER_NAME] ?? master.header.name, contact: base[HEADER_CONTACT] ?? master.header.contact },
    sections,
  };
}

/** Master content this copy deleted (the baseline had it) that the master still has. Never removed unless ticked. */
export type MasterRemoval = { kind: "section" | "item" | "bullet"; id: string; label: string; where: string };

export type SaveAsMasterPlan = {
  /** The master with this copy's edits and additions applied, nothing removed. */
  merged: Resume;
  /** Bullets and lines this copy reworded (relative to its baseline). */
  edited: number;
  /** Bullets, entries and sections added in this copy. */
  added: number;
  /** Master content the copy doesn't have that is kept (added to the master later, or left out of this copy). */
  kept: number;
  /** Deleted in this copy, still on the master: offered as "Also remove from master" (unticked). */
  removals: MasterRemoval[];
  /** Lines both the copy and the master changed since the baseline; the copy's wording is used. */
  conflicts: MergeConflict[];
};

/**
 * What "Save this tailored copy as my master resume" does: apply this copy's edits relative to its
 * baseline (reworded bullets and lines, plus bullets/entries/sections added here, placed next to their
 * neighbours) to the CURRENT master, keeping everything the master has that the copy lacks. Where both
 * changed the same line, the copy's wording wins (that's what the user asked for). The master's legacy
 * `facts` JSON is left as stored (facts live in their own table).
 */
export function planSaveAsMaster(copy: Resume, master: Resume): SaveAsMasterPlan {
  const base = copy.baseline ?? {};
  const local = stripBaseline(copy);
  delete local.facts;
  const baseDoc = baseFromBaseline(copy, master);
  const { merged, conflicts } = mergeResumes(baseDoc, local, { ...master });
  const out: Resume = { ...stripBaseline(merged) };
  if (master.facts) out.facts = master.facts;
  else delete out.facts;

  // Counts for the confirmation.
  const baseTexts = bulletTextMap(baseDoc);
  const masterTexts = bulletTextMap(master);
  const baseItems = new Set(baseDoc.sections.flatMap((s) => s.items.map((it) => it.id)));
  const masterItems = new Set(master.sections.flatMap((s) => s.items.map((it) => it.id)));
  let edited = 0;
  let added = 0;
  for (const s of copy.sections) {
    for (const it of s.items) {
      if (!baseItems.has(it.id) && !masterItems.has(it.id)) {
        added++; // a new entry counts once, with its bullets
        continue;
      }
      for (const b of it.bullets) {
        if (baseTexts.has(b.id)) edited += baseTexts.get(b.id) !== b.text ? 1 : 0;
        else if (!masterTexts.has(b.id)) added++;
      }
    }
  }
  if (baseDoc.header.name !== copy.header.name) edited++;
  if (baseDoc.header.contact !== copy.header.contact) edited++;

  const copySections = new Set(copy.sections.map((s) => s.id));
  const copyItems = new Set(copy.sections.flatMap((s) => s.items.map((it) => it.id)));
  const copyBullets = new Set(bulletTextMap(copy).keys());
  const structured = hasStructure(base);
  const removals: MasterRemoval[] = [];
  let kept = 0;
  for (const s of out.sections) {
    if (!copySections.has(s.id)) {
      if (structured && SECTION_KEY + s.id in base) removals.push({ kind: "section", id: s.id, label: s.title.trim() || "Untitled section", where: "" });
      else kept++;
      continue;
    }
    for (const it of s.items) {
      if (!copyItems.has(it.id)) {
        if (structured && ITEM_KEY + it.id in base) removals.push({ kind: "item", id: it.id, label: itemLabel(it), where: s.title });
        else kept++;
        continue;
      }
      for (const b of it.bullets) {
        if (copyBullets.has(b.id)) continue;
        if (b.id in base) removals.push({ kind: "bullet", id: b.id, label: shortLabel(b.text), where: itemLabel(it) });
        else kept++;
      }
    }
  }
  return { merged: out, edited, added, kept, removals, conflicts };
}

/** `r` without the sections, entries and bullets whose ids are in `ids`. */
export function removeIds(r: Resume, ids: Set<string>): Resume {
  if (!ids.size) return r;
  return {
    ...r,
    sections: r.sections
      .filter((s) => !ids.has(s.id))
      .map((s) => ({
        ...s,
        items: s.items.filter((it) => !ids.has(it.id)).map((it) => ({ ...it, bullets: it.bullets.filter((b) => !ids.has(b.id)) })),
      })),
  };
}

/** The new master for "Save as master": planSaveAsMaster's merge, minus the removals the user ticked. Pure (safe to re-run in updateMaster). */
export function applySaveAsMaster(copy: Resume, master: Resume, remove: Set<string>): Resume {
  const plan = planSaveAsMaster(copy, master);
  const allowed = new Set(plan.removals.map((r) => r.id).filter((id) => remove.has(id)));
  const next = removeIds(plan.merged, allowed);
  return sameJson(next, master) ? master : next;
}

/** Every baseline key for a section/entry/bullet and everything inside it. */
function subtreeKeys(r: Resume, kind: "section" | "item" | "bullet", id: string): string[] {
  if (kind === "bullet") return [id];
  for (const s of r.sections) {
    if (kind === "section" && s.id === id) {
      return [SECTION_KEY + s.id, ...s.items.flatMap((it) => [ITEM_KEY + it.id, ...it.bullets.map((b) => b.id)])];
    }
    for (const it of s.items) if (kind === "item" && it.id === id) return [ITEM_KEY + it.id, ...it.bullets.map((b) => b.id)];
  }
  return [];
}

/**
 * The copy's baseline after it was saved into the master. It now matches the new master, except:
 * master content the copy never had (added to the master later) stays out, so it's still offered as
 * "new in your master resume"; things the master removed keep their old entry, so they're still listed;
 * and lines the master reworded that this copy never touched keep their old wording, so "Pull" still
 * offers the master's new wording instead of the copy silently counting as edited.
 */
export function baselineAfterMasterSave(copy: Resume, master: Resume): Record<string, string> {
  const old = copy.baseline ?? {};
  const next = makeBaseline(master);
  const plan = planPull(copy, master);
  for (const a of plan.additions) for (const k of subtreeKeys(master, a.kind, a.id)) delete next[k];
  for (const r of plan.removals) for (const k of subtreeKeys(copy, r.kind, r.id)) if (k in old) next[k] = old[k];
  const m = bulletTextMap(master);
  for (const [id, text] of bulletTextMap(copy)) {
    if (old[id] !== undefined && text === old[id] && m.get(id) !== undefined && m.get(id) !== old[id]) next[id] = old[id];
  }
  for (const [key, field] of [[HEADER_NAME, "name"], [HEADER_CONTACT, "contact"]] as const) {
    if (old[key] !== undefined && copy.header[field] === old[key] && master.header[field] !== old[key]) next[key] = old[key];
  }
  return next;
}

// ---------- database helpers (conditional on updated_at) ----------

export type TailoredSaveResult =
  | { kind: "saved"; content: Resume; updatedAt: string; merged: boolean }
  | { kind: "conflict"; server: Resume; serverUpdatedAt: string; conflicts: MergeConflict[] };

/**
 * Save a job's tailored copy only if nobody saved it since `base.updatedAt`. If someone did, three-way
 * merge (base = what this tab last loaded or saved) and save the merge; if both changed the same line,
 * write nothing and return the conflict. Throws a plain sentence on database/network errors.
 */
export async function saveTailoredDocument(
  supabase: SupabaseClient,
  id: string,
  local: Resume,
  base: { content: Resume; updatedAt: string },
): Promise<TailoredSaveResult> {
  let content = local;
  let baseContent = base.content;
  let known = base.updatedAt;
  for (let attempt = 0; attempt <= MASTER_RETRIES; attempt++) {
    const { data: rows, error } = await supabase
      .from("resumes")
      .update({ content })
      .eq("id", id)
      .eq("updated_at", known)
      .select("updated_at");
    if (error) throw new Error(dbErrorMessage(error, "autosave"));
    if (rows?.length) {
      return { kind: "saved", content, updatedAt: (rows[0] as { updated_at: string }).updated_at, merged: content !== local };
    }
    const { data: row, error: e2 } = await supabase.from("resumes").select("content, updated_at").eq("id", id).maybeSingle();
    if (e2) throw new Error(dbErrorMessage(e2, "autosave"));
    if (!row) throw new Error("This job's tailored copy was deleted on another device. Reload the page.");
    const s = row as { content: unknown; updated_at: string };
    const server = tailoredFromRow(s.content);
    const { merged, conflicts } = mergeTailored(baseContent, content, server);
    if (conflicts.length) return { kind: "conflict", server, serverUpdatedAt: s.updated_at, conflicts };
    if (sameJson(merged, server)) return { kind: "saved", content: server, updatedAt: s.updated_at, merged: !sameJson(server, local) };
    baseContent = server;
    content = merged;
    known = s.updated_at;
  }
  throw new Error("This tailored copy kept changing on another device while saving. Reload the page.");
}

export type JobWriteResult =
  | { kind: "saved"; updatedAt: string; written: Partial<Job>; droppedColumns: boolean }
  | { kind: "stale"; droppedColumns: boolean };

/**
 * Write `patch` to the job only if its `updated_at` is still `version` (and, with `requireNoSnapshot`,
 * only if no "what you sent" snapshot exists yet). Optional columns the database lacks (migrations not
 * run) are dropped from the write and added to `missing`. "stale" = 0 rows matched: re-read and decide.
 * Throws the raw error on anything else (callers turn it into a sentence).
 */
export async function writeJobIfUnchanged(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<Job>,
  version: string,
  missing: Set<string>,
  opts: { requireNoSnapshot?: boolean } = {},
): Promise<JobWriteResult> {
  let droppedColumns = false;
  for (let attempt = 0; attempt <= OPTIONAL_JOB_COLUMNS.length; attempt++) {
    const write = omitKeys(patch, [...missing]) as Partial<Job>;
    if (Object.keys(write).length < Object.keys(patch).length) droppedColumns = true;
    if (!Object.keys(write).length) return { kind: "saved", updatedAt: version, written: write, droppedColumns };
    let q = supabase.from("jobs").update(write).eq("id", id).eq("updated_at", version);
    if (opts.requireNoSnapshot && !missing.has("submitted_at")) q = q.is("submitted_at", null);
    const { data, error } = await q.select("updated_at");
    if (!error) {
      if (data?.length) return { kind: "saved", updatedAt: (data[0] as { updated_at: string }).updated_at, written: write, droppedColumns };
      return { kind: "stale", droppedColumns };
    }
    const left = OPTIONAL_JOB_COLUMNS.filter((c) => !missing.has(c) && (c in write || (c === "submitted_at" && opts.requireNoSnapshot)));
    if (!isMissingColumn(error) || !left.length) throw error;
    for (const c of missingOptionalColumns(error.message, left)) missing.add(c);
  }
  throw new Error("Couldn't save. Check your connection; we'll keep retrying.");
}

/** Re-read a job row (null when it was deleted). Throws on database/network errors. */
export async function readJob(supabase: SupabaseClient, id: string): Promise<Job | null> {
  const { data, error } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? jobFromRow(data) : null;
}
