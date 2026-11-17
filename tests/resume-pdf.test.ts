import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { ResumePdf } from "@/components/ResumePdf";
import type { Resume } from "@/lib/types";

/** A realistic version 3 resume with formatting everywhere. */
const resume: Resume = {
  version: 3,
  header: {
    name: "Ada Lovelace",
    contact: "London • ada@example.com • (555) 010-0199",
    marks: { name: [{ from: 0, to: 12, bold: true, size: 16 }] },
    para: { name: { align: "center" }, contact: { align: "center" } },
  },
  sections: [
    {
      id: "edu",
      title: "Education",
      marks: [{ from: 0, to: 9, bold: true }],
      para: { rule: true, caps: true, spaceBefore: 6 },
      items: [
        {
          id: "i1",
          title: "University of London",
          subtitle: "",
          location: "London, UK",
          dates: "",
          bullets: [],
          marks: { title: [{ from: 0, to: 21, bold: true }] },
          para: { entry: {} },
        },
        {
          id: "i2",
          title: "",
          subtitle: "BSc Mathematics",
          location: "",
          dates: "2019 – 2022",
          bullets: [],
          marks: { subtitle: [{ from: 0, to: 15, italic: true }] },
          para: { role: {} },
        },
      ],
    },
    {
      id: "exp",
      title: "Experience",
      marks: [{ from: 0, to: 10, bold: true }],
      para: { rule: true, caps: true },
      items: [
        {
          id: "i3",
          title: "Analytical Engine Ltd",
          subtitle: "Engineer",
          location: "London",
          dates: "2022 – Present",
          bullets: [
            {
              id: "b1",
              text: "Wrote the first published algorithm for the machine.",
              marks: [{ from: 6, to: 10, bold: true }, { from: 40, to: 49, underline: true }],
            },
            { id: "b2", text: "Documented the engine's instruction set." },
          ],
          marks: { title: [{ from: 0, to: 22, bold: true }] },
        },
      ],
    },
    {
      id: "misc",
      title: "Skills",
      items: [
        { id: "i4", title: "", subtitle: "", location: "", dates: "", bullets: [] },
        { id: "i5", title: "Languages: Python, Ada", subtitle: "", location: "", dates: "", bullets: [] },
      ],
    },
  ],
};

describe("ResumePdf", () => {
  it("renders a formatted v3 resume to a PDF buffer", async () => {
    const buffer = await renderToBuffer(ResumePdf({ resume }));
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(2000);
  });

  it("renders large runs, a bullet with a 14pt run, and an empty entry line", async () => {
    const big: Resume = {
      version: 3,
      header: {
        name: "Grace Hopper",
        contact: "New York • grace@example.com",
        marks: { name: [{ from: 0, to: 12, bold: true, size: 16 }] },
        para: { name: { align: "center" }, contact: { align: "center" } },
      },
      sections: [
        {
          id: "exp",
          title: "Experience",
          items: [
            {
              id: "e1",
              title: "",
              subtitle: "",
              location: "",
              dates: "",
              bullets: [
                {
                  id: "b1",
                  text: "Led the compiler team to a 14pt milestone.",
                  marks: [{ from: 0, to: 10, size: 14 }],
                },
              ],
              para: { entry: {} },
            },
          ],
        },
      ],
    };
    const buffer = await renderToBuffer(ResumePdf({ resume: big }));
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
