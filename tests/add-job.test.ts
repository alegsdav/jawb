import { describe, expect, it } from "vitest";
import { addHint, addedOn, classifyOneBox, pasteBody } from "@/lib/addJob";

describe("classifyOneBox", () => {
  it("is empty for blank text", () => {
    expect(classifyOneBox("   ")).toEqual({ kind: "empty" });
  });

  it("sends a readable link as a link", () => {
    expect(classifyOneBox("  https://acme.example/jobs/42 ")).toEqual({ kind: "url", url: "https://acme.example/jobs/42" });
  });

  it("sends a link to a login-walled site to the paste step, with the site's name", () => {
    const c = classifyOneBox("https://www.linkedin.com/jobs/view/123456");
    expect(c.kind).toBe("site");
    if (c.kind === "site") {
      expect(c.url).toBe("https://www.linkedin.com/jobs/view/123456");
      expect(c.site).toBeTruthy();
    }
  });

  it("treats a multi-word entry as a pasted description", () => {
    expect(classifyOneBox("Senior engineer at Acme, remote")).toEqual({ kind: "text", text: "Senior engineer at Acme, remote" });
  });

  it("refuses a half-typed link (no spaces, looks like a link)", () => {
    for (const v of ["http//x", "www.acme", "acme.com/jobs"]) {
      const c = classifyOneBox(v);
      expect(c.kind).toBe("error");
      if (c.kind === "error") expect(c.message).toMatch(/^That doesn't look like a link/);
    }
  });

  it("refuses a single stray word", () => {
    const c = classifyOneBox("engineer");
    expect(c).toEqual({ kind: "error", message: "Paste a link to the posting or the full job description." });
  });
});

describe("pasteBody", () => {
  it("needs a description", () => {
    expect(pasteBody("", "  ")).toEqual({ ok: false, message: "Paste the job description first." });
  });

  it("rejects a link that is not an http(s) address", () => {
    const r = pasteBody("linkedin.com/jobs/1", "Role text");
    expect(r.ok).toBe(false);
  });

  it("keeps the link and trims the description", () => {
    expect(pasteBody(" https://jobs.example/1 ", " Role text ")).toEqual({
      ok: true,
      body: { url: "https://jobs.example/1", text: "Role text" },
    });
  });

  it("sends only the description when there is no link", () => {
    expect(pasteBody("", "Role text")).toEqual({ ok: true, body: { text: "Role text" } });
  });
});

describe("addHint", () => {
  it("says what Add job will do for each kind of entry", () => {
    expect(addHint("one", "", "")).toBe("");
    expect(addHint("one", "https://acme.example/jobs/1", "")).toBe("Reads the posting from the link.");
    expect(addHint("one", "Some role description here", "")).toBe("Uses the pasted description.");
    expect(addHint("one", "engineer", "")).toBe("Uses the pasted description.");
  });

  it("explains the paste step", () => {
    expect(addHint("paste", "", "https://jobs.example/1")).toBe("Saves the description and keeps the link.");
    expect(addHint("paste", "", "")).toBe("");
  });
});

describe("addedOn", () => {
  it("is empty for a timestamp that can't be read", () => {
    expect(addedOn("not a date")).toBe("");
  });
});
