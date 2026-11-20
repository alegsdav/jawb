import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(`${process.cwd()}/src/app/globals.css`, "utf8");
// Component rendering is not set up for tests (tsconfig jsx is "preserve"), so check the source for the exports.
const loaderSource = readFileSync(`${process.cwd()}/src/components/Loader.tsx`, "utf8");

describe("page loader", () => {
  it("defines the flip keyframes and the reduced-motion fallback", () => {
    expect(css).toMatch(/@keyframes square-flip\s*{/);
    expect(css).toMatch(/@keyframes square-pulse\s*{/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*\.flipping-square-loader\s*{[^}]*square-pulse/);
  });

  it("exports Loader and PageLoader", () => {
    expect(loaderSource).toMatch(/export function Loader\(/);
    expect(loaderSource).toMatch(/export function PageLoader\(/);
  });
});
