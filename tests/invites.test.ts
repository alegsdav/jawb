import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  formatInviteCode, generateInviteCode, INVITE_ALPHABET, normalizeInviteCode, signupWithInvite, SIGNUP_MESSAGES, THROTTLE,
  type InviteAdmin,
} from "@/lib/invites";
import { newInviteCode, parseInviteArgs } from "../scripts/create-invite";

type Code = { code: string; kind: "single" | "reusable"; max_uses: number; uses: number; expires_at: string | null };

/** Fake service-role client: redeem_invite/release_invite behave like the SQL (one conditional update). */
function fakeAdmin(clock: { now: number }, codes: Code[]) {
  const attempts: { ip_hash: string; created_at: string }[] = [];
  const users: { email: string; app_metadata: Record<string, unknown>; email_confirm: boolean }[] = [];
  const state = { createError: null as null | { code?: string; message?: string }, createThrows: false };
  const admin: InviteAdmin = {
    rpc: (fn, args) => {
      const c = codes.find((x) => x.code === args.p_code);
      if (fn === "redeem_invite") {
        const ok = !!c && c.uses < c.max_uses && (!c.expires_at || Date.parse(c.expires_at) > clock.now);
        if (ok) c!.uses++;
        return Promise.resolve({ data: ok, error: null });
      }
      if (fn === "release_invite") {
        if (c && c.uses > 0) c.uses--;
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(fn);
    },
    from: () => ({
      select: () => ({
        eq: (_k, ip) => ({
          gte: (_k2, since) =>
            Promise.resolve({ count: attempts.filter((a) => a.ip_hash === ip && a.created_at >= String(since)).length, error: null }),
        }),
      }),
      insert: (row) => {
        attempts.push({ ip_hash: String(row.ip_hash), created_at: new Date(clock.now).toISOString() });
        return Promise.resolve({ error: null });
      },
    }),
    auth: {
      admin: {
        createUser: async (attrs) => {
          await new Promise((r) => setTimeout(r, 1));
          if (state.createThrows) throw new Error("network");
          if (state.createError) return { data: { user: null }, error: state.createError };
          if (users.some((u) => u.email === attrs.email)) {
            return { data: { user: null }, error: { code: "email_exists", message: "A user with this email address has already been registered" } };
          }
          users.push({ email: attrs.email, app_metadata: attrs.app_metadata, email_confirm: attrs.email_confirm });
          return { data: { user: { id: `u${users.length}` } }, error: null };
        },
      },
    },
  };
  return { admin, attempts, users, state };
}

const T0 = Date.parse("2026-11-14T12:00:00Z");
const single = (code = "AAAABBBBCCCCDDDD"): Code => ({ code, kind: "single", max_uses: 1, uses: 0, expires_at: null });

let clock: { now: number };
let signIn: ReturnType<typeof vi.fn<(email: string, password: string) => Promise<{ error: unknown }>>>;
beforeEach(() => {
  clock = { now: T0 };
  signIn = vi.fn(async (): Promise<{ error: unknown }> => ({ error: null }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const deps = (admin: InviteAdmin) => ({ admin, signIn, now: () => new Date(clock.now) });
const input = (over: Partial<{ email: string; password: string; code: string; ip: string }> = {}) => ({
  email: "Student@School.edu",
  password: "correct horse",
  code: "aaaa-bbbb-cccc-dddd",
  ip: "1.2.3.4",
  ...over,
});

describe("invite codes", () => {
  it("are 16 base32 characters from a crypto source, shown in groups of four", () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[A-Z2-7]{16}$/);
    expect(new Set(Array.from({ length: 50 }, generateInviteCode)).size).toBe(50);
    expect(formatInviteCode("ABCDEFGHIJKLMNOP")).toBe("ABCD-EFGH-IJKL-MNOP");
    expect(newInviteCode()).toMatch(/^[A-Z2-7]{16}$/);
    expect(INVITE_ALPHABET).toHaveLength(32);
  });

  it("typed codes are normalized (case, dashes, spaces, 0/1/8 look-alikes)", () => {
    expect(normalizeInviteCode(" abcd-efgh ijkl-mnop ")).toBe("ABCDEFGHIJKLMNOP");
    expect(normalizeInviteCode("0182")).toBe("OIB2");
  });

  it("create-invite parses its arguments", () => {
    const now = new Date(T0);
    expect(parseInviteArgs(["single"], now)).toEqual({ kind: "single", maxUses: 1, expiresAt: null, note: "" });
    expect(parseInviteArgs(["reusable", "30", "7", "CS", "club"], now)).toEqual({
      kind: "reusable", maxUses: 30, expiresAt: new Date(T0 + 7 * 86400000).toISOString(), note: "CS club",
    });
    expect(parseInviteArgs(["single", "-", "-", "for Alex"], now).note).toBe("for Alex");
    expect(() => parseInviteArgs(["single", "3"], now)).toThrow(/single-use/);
    expect(() => parseInviteArgs(["many"], now)).toThrow(/single or reusable/);
    expect(() => parseInviteArgs(["reusable", "0"], now)).toThrow(/at least 1/);
  });

  it("the tables are locked down: RLS on, no policies, functions only for the service role", () => {
    const sql = readFileSync("supabase/migrations/0004_invites_usage.sql", "utf8");
    expect(sql).toMatch(/alter table public\.invite_codes enable row level security/);
    expect(sql).toMatch(/alter table public\.signup_attempts enable row level security/);
    expect(sql).not.toMatch(/create policy[^;]*invite_codes/);
    expect(sql).toMatch(/revoke all on function public\.redeem_invite\(text\) from public, anon, authenticated/);
    expect(sql).toMatch(/uses < max_uses\s+and \(expires_at is null or expires_at > now\(\)\)/);
  });
});

describe("signupWithInvite", () => {
  it("a single-use code creates one confirmed, invited account and signs in; the second try fails", async () => {
    const { admin, users } = fakeAdmin(clock, [single()]);
    await expect(signupWithInvite(deps(admin), input())).resolves.toEqual({ ok: true });
    expect(users).toEqual([{ email: "student@school.edu", app_metadata: { invited: true }, email_confirm: true }]);
    expect(signIn).toHaveBeenCalledWith("student@school.edu", "correct horse");
    await expect(signupWithInvite(deps(admin), input({ email: "other@school.edu" }))).resolves.toEqual({
      ok: false, message: SIGNUP_MESSAGES.code, field: "code",
    });
    expect(users).toHaveLength(1);
  });

  it("a reusable code works up to its limit", async () => {
    const code: Code = { code: "REUSEREUSEREUSE2", kind: "reusable", max_uses: 2, uses: 0, expires_at: null };
    const { admin } = fakeAdmin(clock, [code]);
    const go = (email: string) => signupWithInvite(deps(admin), input({ email, code: code.code }));
    expect((await go("a@x.edu")).ok).toBe(true);
    expect((await go("b@x.edu")).ok).toBe(true);
    expect(await go("c@x.edu")).toMatchObject({ ok: false, field: "code" });
    expect(code.uses).toBe(2);
  });

  it("an expired code is refused", async () => {
    const code = { ...single(), expires_at: new Date(T0 - 1000).toISOString() };
    const { admin, users } = fakeAdmin(clock, [code]);
    expect(await signupWithInvite(deps(admin), input())).toMatchObject({ ok: false, message: SIGNUP_MESSAGES.code });
    expect(users).toHaveLength(0);
  });

  it("two people racing for a single-use code: exactly one gets an account", async () => {
    const { admin, users } = fakeAdmin(clock, [single()]);
    const results = await Promise.all(
      ["a@x.edu", "b@x.edu", "c@x.edu"].map((email, i) => signupWithInvite(deps(admin), input({ email, ip: `9.9.9.${i}` }))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(users).toHaveLength(1);
  });

  it("gives the use back when creating the account fails (email taken, or an error)", async () => {
    const code = single();
    const { admin, state } = fakeAdmin(clock, [code]);
    state.createError = { code: "email_exists", message: "already registered" };
    expect(await signupWithInvite(deps(admin), input())).toEqual({ ok: false, message: SIGNUP_MESSAGES.exists, field: "email" });
    expect(code.uses).toBe(0);
    state.createError = null;
    state.createThrows = true;
    expect(await signupWithInvite(deps(admin), input())).toMatchObject({ ok: false, message: SIGNUP_MESSAGES.failed });
    expect(code.uses).toBe(0);
    state.createThrows = false;
    expect(await signupWithInvite(deps(admin), input())).toEqual({ ok: true });
    expect(code.uses).toBe(1);
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("checks the email and password before touching the code", async () => {
    const code = single();
    const { admin } = fakeAdmin(clock, [code]);
    expect(await signupWithInvite(deps(admin), input({ email: "nope" }))).toMatchObject({ field: "email" });
    expect(await signupWithInvite(deps(admin), input({ password: "short" }))).toMatchObject({ field: "password" });
    expect(code.uses).toBe(0);
  });

  it("throttles an IP after 5 wrong codes in 10 minutes (even a valid code is refused), then lets it try again", async () => {
    const { admin, attempts } = fakeAdmin(clock, [single()]);
    for (let i = 0; i < THROTTLE.maxFailures; i++) {
      clock.now = T0 + i * 1000;
      expect(await signupWithInvite(deps(admin), input({ code: `WRONGWRONGWRON${"ABCDE"[i]}` }))).toMatchObject({ message: SIGNUP_MESSAGES.code });
    }
    expect(attempts).toHaveLength(5);
    expect(attempts[0].ip_hash).toMatch(/^[0-9a-f]{64}$/); // hashed, never the raw IP
    expect(await signupWithInvite(deps(admin), input())).toMatchObject({ ok: false, message: SIGNUP_MESSAGES.throttled });
    // Another connection isn't affected.
    expect(await signupWithInvite(deps(admin), input({ ip: "5.6.7.8", email: "x@y.edu", code: "NOPENOPENOPENOPE" }))).toMatchObject({
      message: SIGNUP_MESSAGES.code,
    });
    clock.now = T0 + THROTTLE.windowMs + 5000;
    expect(await signupWithInvite(deps(admin), input())).toEqual({ ok: true });
  });

  it("a too-short code counts as a wrong code without a database call", async () => {
    const { admin, attempts } = fakeAdmin(clock, []);
    const rpc = vi.spyOn(admin, "rpc");
    expect(await signupWithInvite(deps(admin), input({ code: "abc" }))).toMatchObject({ field: "code" });
    expect(rpc).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(1);
  });

  it("without the service-role key, says sign-ups aren't set up", async () => {
    expect(await signupWithInvite({ admin: null, signIn }, input())).toEqual({ ok: false, message: SIGNUP_MESSAGES.notConfigured });
  });

  it("the service-role key stays on the server", () => {
    const src = readFileSync("src/lib/supabase/admin.ts", "utf8");
    expect(src).toMatch(/^import "server-only";/);
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(/NEXT_PUBLIC_SUPABASE_SERVICE/);
  });
});
