import { describe, expect, it } from "vitest";
import { jobLabel } from "@/lib/jobLabel";

describe("jobLabel", () => {
  it("joins company and role with an en dash", () => {
    expect(jobLabel({ company: "Acme", title: "Staff Engineer" })).toBe("Acme – Staff Engineer");
    expect(jobLabel({ company: "Acme", title: "Staff Engineer" })).toContain("–");
  });

  it("shows the role alone when the company is empty", () => {
    expect(jobLabel({ company: "", title: "Staff Engineer" })).toBe("Staff Engineer");
    expect(jobLabel({ company: "   ", title: "Staff Engineer" })).toBe("Staff Engineer");
  });

  it("says Untitled role when the role is empty", () => {
    expect(jobLabel({ company: "Acme", title: "" })).toBe("Acme – Untitled role");
    expect(jobLabel({ company: "Acme", title: "  " })).toBe("Acme – Untitled role");
  });

  it("says Untitled role when both are empty", () => {
    expect(jobLabel({ company: "", title: "" })).toBe("Untitled role");
    expect(jobLabel({ company: " ", title: " " })).toBe("Untitled role");
  });

  it("trims both parts", () => {
    expect(jobLabel({ company: "  Acme  ", title: "  Designer " })).toBe("Acme – Designer");
  });
});
