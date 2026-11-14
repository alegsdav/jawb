/**
 * Create an invite code and print it.
 *
 *   node --env-file=.env.local scripts/create-invite.ts <single|reusable> [maxUses] [expiryDays] [note...]
 *
 *   node --env-file=.env.local scripts/create-invite.ts single - 14 "For Alex"
 *   node --env-file=.env.local scripts/create-invite.ts reusable 30 7 "CS club, fall cohort"
 *
 * `single` codes work once (maxUses must be 1 or "-"). `reusable` codes work up to maxUses times
 * (default 25). expiryDays is optional ("-" = never expires). Needs NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY. Node 22.18+ runs TypeScript directly; on older Node add
 * --experimental-strip-types. Self-contained on purpose: Node can't resolve the app's "@/" imports.
 */
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

/** RFC 4648 base32, 16 characters = 80 random bits. Same alphabet as src/lib/invites.ts. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newInviteCode(length = 16): string {
  const bytes = new Uint8Array(Math.max(12, length));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join("");
}

export type InviteArgs = { kind: "single" | "reusable"; maxUses: number; expiresAt: string | null; note: string };

/** Parse the command line (without "node script"). Throws a usage message on bad input. */
export function parseInviteArgs(argv: string[], now = new Date()): InviteArgs {
  const [kind, rawMax, rawDays, ...noteParts] = argv;
  if (kind !== "single" && kind !== "reusable") throw new Error("First argument must be single or reusable.");
  const skip = (v: string | undefined) => v === undefined || v === "" || v === "-";
  let maxUses = kind === "single" ? 1 : 25;
  if (!skip(rawMax)) {
    maxUses = Number(rawMax);
    if (!Number.isInteger(maxUses) || maxUses < 1) throw new Error("maxUses must be a whole number of at least 1.");
    if (kind === "single" && maxUses !== 1) throw new Error("A single-use code has maxUses 1. Use reusable for more.");
  }
  let expiresAt: string | null = null;
  if (!skip(rawDays)) {
    const days = Number(rawDays);
    if (!Number.isFinite(days) || days <= 0) throw new Error("expiryDays must be a positive number.");
    expiresAt = new Date(now.getTime() + days * 86400000).toISOString();
  }
  return { kind, maxUses, expiresAt, note: noteParts.join(" ").trim() };
}

async function main() {
  let args: InviteArgs;
  try {
    args = parseInviteArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${(e as Error).message}\nUsage: scripts/create-invite.ts <single|reusable> [maxUses] [expiryDays] [note...]`);
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. node --env-file=.env.local ...).");
    process.exit(1);
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const code = newInviteCode();
  const { error } = await admin.from("invite_codes").insert({
    code,
    kind: args.kind,
    max_uses: args.maxUses,
    expires_at: args.expiresAt,
    note: args.note,
  });
  if (error) {
    console.error(`Couldn't create the code: ${error.message}. Did you run supabase/migrations/0004_invites_usage.sql?`);
    process.exit(1);
  }
  const shown = code.match(/.{1,4}/g)!.join("-");
  console.log(shown);
  console.error(
    `${args.kind === "single" ? "Single-use" : `Reusable (${args.maxUses} uses)`}` +
      `${args.expiresAt ? `, expires ${args.expiresAt.slice(0, 10)}` : ", never expires"}` +
      `${args.note ? ` · ${args.note}` : ""}. Share it with /signup?code=${code}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
