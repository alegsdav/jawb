import type { SupabaseClient } from "@supabase/supabase-js";
import type { Analysis, Job, Resume } from "./types";
import type { DocParagraph, FlatParagraph } from "./doc/types";
import { buildDoc, flattenDoc, removeParagraphs, setParagraphText } from "./doc/model";
import { headingPredicate } from "./doc/outline";
import {
  MASTER_RETRIES, mergeDocs, mergeResumes, placeInto, sameJson, sameParagraph, type MergeConflict, type MergeResult,
} from "./master";
import { normalizeResume, resumeDoc, setOpt, withDoc } from "./resume";
import { normalizeAnalysis } from "./analysis";
import { dbErrorMessage, isMissingColumn, OPTIONAL_JOB_COLUMNS } from "./db";
import { diffFields, JOB_FIELDS, makeBaseline, missingOptionalColumns, omitKeys, readBaseline, stripBaseline } from "./tailor";

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

/** The tailored copy stored in a `resumes` row, with its baseline read defensively (readBaseline drops bad values). */
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

/**
 * A run of master paragraphs the copy deleted (its baseline had them) that the master still has. Never removed unless
 * ticked. `id` is the run's first paragraph and `ids` every paragraph in it.
 */
export type MasterRemoval = {
  kind: "section" | "item" | "bullet";
  id: string;
  ids: string[];
  label: string;
  /** The section heading above it ("" for a section). */
  where: string;
};

export type SaveAsMasterPlan = {
  /** The master with this copy's edits and additions applied, nothing removed. */
  merged: Resume;
  /** Lines this copy changed (text or formatting) relative to its baseline. */
  edited: number;
  /** Non-blank lines added in this copy. */
  added: number;
  /** Non-blank master lines that the copy doesn't have and the baseline didn't either (added to the master later). */
  kept: number;
  /** Deleted in this copy, still on the master: offered as "Also remove from master" (unticked). */
  removals: MasterRemoval[];
  /** Lines both the copy and the master changed; the copy's version is used. */
  conflicts: MergeConflict[];
};

const shortLabel = (t: string, n = 90) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const isBlank = (p: FlatParagraph) => p.text.trim() === "";

const byParagraphId = (ps: FlatParagraph[]) => new Map(ps.map((p) => [p.id, p] as const));

/** `p`'s node with the text `text`; its formatting is kept when the text is unchanged. */
function withText(p: FlatParagraph, text: string): DocParagraph {
  if (p.text === text) return p.node;
  return setParagraphText({ type: "doc", content: [p.node] }, p.id, text).content[0] as DocParagraph;
}

/**
 * The master's paragraphs as the copy saw them: the ids in the copy's baseline, with the baseline's wording and the
 * master's formatting and list placement (the copy's where the master no longer has the paragraph). Copy order;
 * paragraphs the copy deleted, which the master still has, go after their nearest preceding neighbour.
 */
function baseEntries(copy: Resume, master: Resume): FlatParagraph[] {
  const baseline = copy.baseline ?? {};
  const copyParas = flattenDoc(resumeDoc(copy));
  const masterParas = flattenDoc(resumeDoc(master));
  const masterById = byParagraphId(masterParas);
  const copyIds = new Set(copyParas.map((p) => p.id));
  const fromCopy = copyParas.filter((p) => p.id in baseline);
  const deleted = masterParas.filter((p) => p.id in baseline && !copyIds.has(p.id));
  const pool = byParagraphId([...fromCopy, ...deleted]);
  const keep = new Set(pool.keys());
  return placeInto(
    fromCopy.map((p) => p.id),
    deleted.map((p) => p.id),
    keep,
  ).map((id) => {
    const src = masterById.get(id) ?? pool.get(id)!;
    const text = baseline[id];
    return { ...src, node: withText(src, text), text };
  });
}

/** The master as the copy saw it when the copy was made (or last pulled): see baseEntries. */
export function baseFromBaseline(copy: Resume, master: Resume): Resume {
  return withDoc({ ...master }, buildDoc(baseEntries(copy, master)));
}

/**
 * Runs of consecutive master paragraphs in `ids`, one removal each. A run starts at a line or heading and takes the
 * list lines right after it (an entry and its bullets); a section run takes everything removed after its heading.
 * Kind comes from the master's outline: a heading is a section, a plain line starts an entry, a list line is a bullet.
 * `where` is the heading above the run.
 */
function masterRemovals(masterParas: FlatParagraph[], ids: Set<string>): MasterRemoval[] {
  // The same heading rule as the master's outline (its own heading style), so a removed entry is not called a section.
  const isHeading = headingPredicate(buildDoc(masterParas));
  const out: MasterRemoval[] = [];
  let section = "";
  let run: MasterRemoval | undefined;
  let prevRemoved = false;
  for (const p of masterParas) {
    if (isHeading(p)) section = p.text.trim();
    const removed = ids.has(p.id);
    const continues = run !== undefined && (run.kind === "section" || p.listType !== null);
    if (removed && prevRemoved && continues) {
      run!.ids.push(p.id);
    } else if (removed) {
      const kind = isHeading(p) ? "section" : p.listType === null ? "item" : "bullet";
      const text = p.text.replace(/\t+/g, " — ").trim();
      run = {
        kind,
        id: p.id,
        ids: [p.id],
        label: shortLabel(text) || `Untitled ${kind}`,
        where: kind === "section" ? "" : section,
      };
      out.push(run);
    }
    prevRemoved = removed;
  }
  return out;
}

/**
 * What "Save this tailored copy as my master resume" does: apply this copy's edits relative to its baseline (changed
 * lines and lines added here, placed next to their neighbours) to the CURRENT master, keeping everything the master
 * has that the copy lacks. Where both changed the same line, the copy's wording wins (that's what the user asked
 * for). Lines the copy deleted are not removed here; they are offered as `removals`.
 */
export function planSaveAsMaster(copy: Resume, master: Resume): SaveAsMasterPlan {
  const baseline = copy.baseline ?? {};
  const copyDoc = resumeDoc(copy);
  const copyParas = flattenDoc(copyDoc);
  const copyIds = new Set(copyParas.map((p) => p.id));
  const masterParas = flattenDoc(resumeDoc(master));

  // The base without the copy's deletions: the master's lines the copy deleted then count as master-only, so they are kept.
  const baseDoc = removeParagraphs(resumeDoc(baseFromBaseline(copy, master)), Object.keys(baseline).filter((id) => !copyIds.has(id)));
  const { doc, conflicts } = mergeDocs(baseDoc, copyDoc, resumeDoc(master));
  const merged = withDoc({ ...master }, doc);
  setOpt(merged, "page", copy.page ?? master.page);

  const baseParas = byParagraphId(flattenDoc(baseDoc));
  let edited = 0;
  let added = 0;
  for (const p of copyParas) {
    if (p.id in baseline) {
      const b = baseParas.get(p.id);
      if (b && !sameParagraph(p, b)) edited++;
    } else if (!isBlank(p)) added++;
  }
  let kept = 0;
  for (const p of masterParas) if (!copyIds.has(p.id) && !(p.id in baseline) && !isBlank(p)) kept++;
  const deleted = new Set(masterParas.filter((p) => p.id in baseline && !copyIds.has(p.id)).map((p) => p.id));
  return { merged, edited, added, kept, removals: masterRemovals(masterParas, deleted), conflicts };
}

/** `r` without the paragraphs whose ids are in `ids` (lists left empty disappear). */
export function removeIds(r: Resume, ids: Set<string>): Resume {
  if (!ids.size) return r;
  return withDoc(r, removeParagraphs(resumeDoc(r), ids));
}

/** The new master for "Save as master": planSaveAsMaster's merge, minus the removals the user ticked. Pure (safe to re-run in updateMaster). */
export function applySaveAsMaster(copy: Resume, master: Resume, remove: Set<string>): Resume {
  const plan = planSaveAsMaster(copy, master);
  const drop = new Set(plan.removals.filter((r) => remove.has(r.id)).flatMap((r) => r.ids));
  const next = removeIds(plan.merged, drop);
  return sameJson(next, master) ? master : next;
}

/**
 * The copy's baseline after it was saved into the master: the master's current wording, except that master lines
 * added after the copy was made stay out (so they're still offered as new), lines the master removed keep their old
 * wording (so they're still listed), and lines the master reworded that this copy never touched keep their old
 * wording (so Pull still offers the master's new wording).
 */
export function baselineAfterMasterSave(copy: Resume, master: Resume): Record<string, string> {
  const old = copy.baseline ?? {};
  const next = makeBaseline(master);
  const copyParas = byParagraphId(flattenDoc(resumeDoc(copy)));
  const masterParas = byParagraphId(flattenDoc(resumeDoc(master)));
  for (const id of Object.keys(next)) if (!(id in old) && !copyParas.has(id)) delete next[id];
  for (const [id] of copyParas) if (old[id] !== undefined && !masterParas.has(id)) next[id] = old[id];
  for (const [id, p] of copyParas) {
    const m = masterParas.get(id);
    if (old[id] !== undefined && p.text === old[id] && m && m.text !== old[id]) next[id] = old[id];
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
