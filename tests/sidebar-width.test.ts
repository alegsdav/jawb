import { describe, expect, it } from "vitest";
import {
  SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, clampSidebarWidth, parseSidebarWidth,
} from "@/lib/sidebar";

describe("sidebar width", () => {
  it("the default is 248px and the range is 200 to 360px", () => {
    expect(SIDEBAR_WIDTH_DEFAULT).toBe(248);
    expect(SIDEBAR_WIDTH_MIN).toBe(200);
    expect(SIDEBAR_WIDTH_MAX).toBe(360);
  });

  it("clamps to the range and rounds to whole pixels", () => {
    expect(clampSidebarWidth(150)).toBe(200);
    expect(clampSidebarWidth(199.4)).toBe(200);
    expect(clampSidebarWidth(300.6)).toBe(301);
    expect(clampSidebarWidth(361)).toBe(360);
    expect(clampSidebarWidth(9999)).toBe(360);
    expect(clampSidebarWidth(-50)).toBe(200);
  });

  it("a non-finite width gives the default", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(248);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(248);
  });

  it("parses the cookie: a number, clamped; anything missing or not a number gives the default", () => {
    expect(parseSidebarWidth("280")).toBe(280);
    expect(parseSidebarWidth("120")).toBe(200);
    expect(parseSidebarWidth("1000")).toBe(360);
    expect(parseSidebarWidth("312.7")).toBe(313);
    expect(parseSidebarWidth(undefined)).toBe(248);
    expect(parseSidebarWidth(null)).toBe(248);
    expect(parseSidebarWidth("")).toBe(248);
    expect(parseSidebarWidth("   ")).toBe(248);
    expect(parseSidebarWidth("wide")).toBe(248);
    expect(parseSidebarWidth("NaN")).toBe(248);
  });
});
