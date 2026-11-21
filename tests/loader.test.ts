import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { noteEditorKind, SLIDE_MS } from "@/lib/editorKind";

const css = readFileSync(`${process.cwd()}/src/app/globals.css`, "utf8");
// Component rendering is not set up for tests (tsconfig jsx is "preserve"), so check the source for the exports.
const loaderSource = readFileSync(`${process.cwd()}/src/components/Loader.tsx`, "utf8");

describe("page loader", () => {
  it("defines the flip keyframes and the reduced-motion fallback", () => {
    expect(css).toMatch(/@keyframes square-flip\s*{/);
    expect(css).toMatch(/@keyframes square-pulse\s*{/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*\.flipping-square-loader\s*{[^}]*square-pulse/);
  });

  it("draws the loader in the near-black foreground colour", () => {
    expect(css).toMatch(/\.flipping-square-loader\s*{[^}]*background-color: var\(--fg\)/);
  });

  it("exports Loader and PageLoader, and centres PageLoader in the content area", () => {
    expect(loaderSource).toMatch(/export function Loader\(/);
    expect(loaderSource).toMatch(/export function PageLoader\(/);
    expect(loaderSource).toMatch(/flex h-full min-h-\[60vh\] w-full items-center justify-center/);
  });
});

describe("noteEditorKind", () => {
  it("records the first kind without animating, and slides only when the kind changes", () => {
    // First call in this module: records "job" and returns null, so a first page load never animates.
    expect(noteEditorKind("job", 1000)).toBeNull();
    // Same kind (job to job) never animates, even right after the first call.
    expect(noteEditorKind("job", 1001)).toBeNull();
    // Kind changes (job to master): slide from its start.
    expect(noteEditorKind("master", 2000)).toBe(0);
    // A remounted toolbar within SLIDE_MS continues the same slide: returns the elapsed time.
    expect(noteEditorKind("master", 2100)).toBe(100);
    expect(noteEditorKind("master", 2000 + SLIDE_MS - 1)).toBe(SLIDE_MS - 1);
    // After SLIDE_MS the slide is over.
    expect(noteEditorKind("master", 2000 + SLIDE_MS)).toBeNull();
    // And a change back (master to job) starts a new slide.
    expect(noteEditorKind("job", 5000)).toBe(0);
    expect(noteEditorKind("job", 9000)).toBeNull();
  });

  it("keeps the slide short and defined in the stylesheet", () => {
    expect(SLIDE_MS).toBe(260);
    expect(css).toMatch(/\.editor-kind-slide\s*{\s*animation: editor-kind-slide 260ms/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*\.editor-kind-slide\s*{\s*animation: none/);
  });
});
