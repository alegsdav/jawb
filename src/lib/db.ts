/** Postgres/PostgREST errors meaning migration 0002 hasn't been applied (a new column is missing). */
export const isMissingColumn = (e: { code?: string; message?: string } | null | undefined) =>
  !!e &&
  (e.code === "42703" || e.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(e.message ?? ""));

/** Unique-constraint violation (e.g. a second tab created the same master/tailored row first). */
export const isUniqueViolation = (e: { code?: string } | null | undefined) => e?.code === "23505";

export const MIGRATION_HINT =
  "Database update needed: run the files in supabase/migrations/ (0002 and 0003) in your Supabase SQL editor.";

/** Columns added by migration 0002; strip them from writes when the migration is missing. */
export const MIGRATION_0002_COLUMNS = ["deadline", "submitted_resume", "submitted_at", "submitted_tailored"] as const;

/** Every job column added after 0001; strip these from writes/selects when a migration is missing. */
export const OPTIONAL_JOB_COLUMNS = [...MIGRATION_0002_COLUMNS, "reached_interview"] as const;

type DbError = { code?: string; message?: string; status?: number; name?: string } | null | undefined;

/**
 * A plain sentence for a Supabase/PostgREST/network failure. Never shows raw backend text.
 * `action` picks the wording: "autosave" (it retries by itself), "save" (a one-off action) or "load".
 */
export function dbErrorMessage(e: DbError, action: "autosave" | "save" | "load" = "autosave"): string {
  if (isMissingColumn(e)) return MIGRATION_HINT;
  const code = e?.code ?? "";
  if (code === "PGRST301" || code === "PGRST302" || e?.status === 401 || /jwt|token.*expired|not authenticated/i.test(e?.message ?? "")) {
    return "You've been signed out. Reload the page and sign in again.";
  }
  if (code === "42501" || e?.status === 403) return "This account can't change that. Reload the page and sign in again.";
  if (action === "load") return "Couldn't load your data. Check your connection and reload the page.";
  if (action === "save") return "Couldn't save. Check your connection and try again.";
  return "Couldn't save. Check your connection; we'll keep retrying.";
}
