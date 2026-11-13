import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/supabase/allowlist";

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn(() => ({ auth })) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

import { middleware } from "@/middleware";
import { requireUser } from "@/lib/supabase/server";

const signedInAs = (email: string | null) =>
  auth.getUser.mockResolvedValue({ data: { user: email ? { id: "u1", email } : null }, error: null });

const req = (path: string) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: { cookie: "sb-proj-auth-token=base64-abc; theme=dark" } });

const envBefore = process.env.ALLOWED_EMAILS;
beforeEach(() => {
  process.env.ALLOWED_EMAILS = "me@school.edu, Other@Example.com";
  auth.getUser.mockReset();
  auth.signOut.mockClear();
});
afterEach(() => {
  process.env.ALLOWED_EMAILS = envBefore;
});

describe("isAllowedEmail", () => {
  it("is case-insensitive and allows everyone when the list is empty", () => {
    expect(isAllowedEmail("ME@school.edu")).toBe(true);
    expect(isAllowedEmail("other@example.com")).toBe(true);
    expect(isAllowedEmail("stranger@example.com")).toBe(false);
    expect(isAllowedEmail(undefined)).toBe(false);
    expect(isAllowedEmail("anyone@example.com", "")).toBe(true);
    expect(isAllowedEmail(undefined, " , ")).toBe(true);
  });
});

describe("requireUser", () => {
  it("returns the user only when the email is allowed", async () => {
    signedInAs("me@school.edu");
    expect((await requireUser()).user?.email).toBe("me@school.edu");
    signedInAs("stranger@example.com");
    expect((await requireUser()).user).toBeNull();
    process.env.ALLOWED_EMAILS = "";
    expect((await requireUser()).user?.email).toBe("stranger@example.com");
  });
});

describe("middleware allow-list", () => {
  it("lets an allowed user through", async () => {
    signedInAs("me@school.edu");
    const res = await middleware(req("/jobs/1"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("signs out a non-allowed user and redirects pages to /login with an explanation", async () => {
    signedInAs("stranger@example.com");
    const res = await middleware(req("/jobs/1?x=1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=not-allowed");
    expect(auth.signOut).toHaveBeenCalled();
    const cleared = res.cookies.get("sb-proj-auth-token");
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge).toBe(0);
    expect(res.cookies.get("theme")).toBeUndefined();
  });

  it("answers API calls from a non-allowed user with 403", async () => {
    signedInAs("stranger@example.com");
    const res = await middleware(req("/api/analyze"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This account isn't allowed to use this app." });
  });

  it("lets a non-allowed user see /login (signed out) instead of looping", async () => {
    signedInAs("stranger@example.com");
    const res = await middleware(req("/login?error=not-allowed"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get("sb-proj-auth-token")?.maxAge).toBe(0);
  });

  it("still sends signed-out visitors to /login and 401s the API", async () => {
    signedInAs(null);
    expect((await middleware(req("/"))).headers.get("location")).toBe("http://localhost:3000/login");
    expect((await middleware(req("/api/intake"))).status).toBe(401);
  });

  it("allows everyone when ALLOWED_EMAILS is empty", async () => {
    process.env.ALLOWED_EMAILS = "";
    signedInAs("stranger@example.com");
    const res = await middleware(req("/"));
    expect(res.status).toBe(200);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
