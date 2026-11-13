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
