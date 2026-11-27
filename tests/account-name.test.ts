import { describe, expect, it } from "vitest";
import { ACCOUNT_NAME_MAX, accountFromUser, checkAccountName, hasProfileName, profileNameFromMetadata } from "@/lib/account";

describe("profileNameFromMetadata", () => {
  it("prefers full_name, then name, user_name, preferred_username, username; trims; empty when none", () => {
    expect(profileNameFromMetadata({ full_name: "  Ada Lovelace ", name: "A" })).toBe("Ada Lovelace");
    expect(profileNameFromMetadata({ name: "Ada" })).toBe("Ada");
    expect(profileNameFromMetadata({ user_name: "ada_l" })).toBe("ada_l");
    expect(profileNameFromMetadata({ preferred_username: "ada" })).toBe("ada");
    expect(profileNameFromMetadata({ username: "ada2" })).toBe("ada2");
    expect(profileNameFromMetadata({ full_name: "   ", avatar_url: "x" })).toBe("");
    expect(profileNameFromMetadata({})).toBe("");
    expect(profileNameFromMetadata(null)).toBe("");
    expect(profileNameFromMetadata(undefined)).toBe("");
  });
});

describe("hasProfileName", () => {
  it("is true only when the account has a non-blank profile name", () => {
    expect(hasProfileName({ full_name: "Ada" })).toBe(true);
    expect(hasProfileName({ user_name: "ada" })).toBe(true);
    expect(hasProfileName({ full_name: "  " })).toBe(false);
    expect(hasProfileName({ full_name: 42 })).toBe(false);
    expect(hasProfileName({})).toBe(false);
    expect(hasProfileName(null)).toBe(false);
  });
});

describe("checkAccountName", () => {
  it("trims and accepts 1 to 60 characters", () => {
    expect(checkAccountName("  Ada  ")).toEqual({ ok: true, name: "Ada" });
    expect(checkAccountName("A")).toEqual({ ok: true, name: "A" });
    expect(checkAccountName("x".repeat(ACCOUNT_NAME_MAX))).toEqual({ ok: true, name: "x".repeat(60) });
  });

  it("refuses blank names and names over 60 characters", () => {
    expect(checkAccountName("")).toEqual({ ok: false, error: "Enter a name." });
    expect(checkAccountName("   \t ")).toEqual({ ok: false, error: "Enter a name." });
    const long = checkAccountName("x".repeat(ACCOUNT_NAME_MAX + 1));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error).toContain("60");
  });
});

describe("accountFromUser profileName", () => {
  it("is the profile name, and empty for an email-only account (the email fallback is not a profile name)", () => {
    expect(accountFromUser({ email: "testalegs+claudetest@example.com", user_metadata: {} })).toEqual({
      name: "testalegs+claudetest",
      firstName: "testalegs+claudetest",
      avatarUrl: null,
      profileName: "",
    });
    expect(accountFromUser({ email: "a@b.c", user_metadata: { full_name: "Ada Lovelace" } })).toEqual({
      name: "Ada Lovelace",
      firstName: "Ada",
      avatarUrl: null,
      profileName: "Ada Lovelace",
    });
    expect(accountFromUser(null)).toBeNull();
  });
});
