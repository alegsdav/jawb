import { describe, expect, it } from "vitest";
import { AI_DOWN_MESSAGE, AI_KEY_MESSAGE, AI_LIMIT_MESSAGE, friendlyGeminiError } from "@/lib/gemini";
import { isDocUndoTarget } from "@/lib/useHistory";

describe("friendlyGeminiError", () => {
  it("maps quota, key and outage errors to plain sentences", () => {
    expect(friendlyGeminiError(429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}')).toBe(AI_LIMIT_MESSAGE);
    expect(friendlyGeminiError(400, '{"error":{"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}')).toBe(
      AI_KEY_MESSAGE,
    );
    expect(friendlyGeminiError(403, '{"error":{"status":"PERMISSION_DENIED"}}')).toBe(AI_KEY_MESSAGE);
    expect(friendlyGeminiError(503, '{"error":{"message":"The model is overloaded."}}')).toBe(AI_DOWN_MESSAGE);
    expect(friendlyGeminiError(500, "")).toBe(AI_DOWN_MESSAGE);
  });

  it("never includes the raw body", () => {
    const body = '{"error":{"code":400,"message":"Invalid JSON payload received.","status":"INVALID_ARGUMENT"}}';
    const msg = friendlyGeminiError(400, body);
    expect(msg).not.toContain("{");
    expect(msg).not.toContain("INVALID_ARGUMENT");
    expect(friendlyGeminiError(404, body, "gemini-x")).toContain('"gemini-x"');
    expect(friendlyGeminiError(404, body)).not.toContain("payload");
  });
});

/** Minimal stand-in for a DOM element: `inside` lists the selectors its ancestors match. */
const el = (tagName: string, inside: string[] = []) => ({
  tagName,
  closest: (sel: string) => (sel.split(",").some((s) => inside.includes(s.trim())) ? {} : null),
});

describe("isDocUndoTarget (undo only for the resume document)", () => {
  it("handles keys typed in the document or with nothing focused", () => {
    expect(isDocUndoTarget(el("TEXTAREA", [".doc-canvas"]))).toBe(true);
    expect(isDocUndoTarget(el("INPUT", [".doc-canvas"]))).toBe(true);
    expect(isDocUndoTarget(el("BODY"))).toBe(true);
    expect(isDocUndoTarget(null)).toBe(true);
  });

  it("leaves other fields to the browser's native undo", () => {
    expect(isDocUndoTarget(el("TEXTAREA"))).toBe(false); // cover letter, notes, answers, facts
    expect(isDocUndoTarget(el("INPUT"))).toBe(false); // job title, company
    expect(isDocUndoTarget(el("SELECT"))).toBe(false);
  });

  it("allows toolbar buttons but not text fields in the toolbar", () => {
    expect(isDocUndoTarget(el("BUTTON", [".doc-toolbar"]))).toBe(true);
    expect(isDocUndoTarget(el("INPUT", [".doc-toolbar"]))).toBe(false);
    expect(isDocUndoTarget(el("BUTTON"))).toBe(false);
  });
});
