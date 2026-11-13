import { describe, expect, it } from "vitest";
import { authErrorMessage } from "@/lib/authErrors";

describe("authErrorMessage", () => {
  it("maps common Supabase Auth failures to plain language", () => {
    expect(authErrorMessage({ message: "Invalid login credentials" }, "sign-in")).toMatch(/Wrong email or password/);
    expect(authErrorMessage({ status: 429, message: "x" }, "link")).toMatch(/Too many attempts/);
    expect(authErrorMessage({ message: "For security purposes, you can only request this after 42 seconds." }, "link")).toMatch(/Too many/);
    expect(authErrorMessage({ message: "Signups not allowed for otp" }, "link")).toMatch(/no account/);
    expect(authErrorMessage({ message: "New password should be different from the old password." }, "password")).toMatch(/haven't used/);
    expect(authErrorMessage({ message: "Auth session missing!" }, "password")).toMatch(/signed out/);
    expect(authErrorMessage({ message: "fetch failed" }, "sign-in")).toMatch(/Couldn't reach/);
  });
  it("never echoes unknown raw messages", () => {
    const out = authErrorMessage({ message: "PGRST999 internal weirdness" }, "sign-in");
    expect(out).not.toMatch(/PGRST/);
  });
});
