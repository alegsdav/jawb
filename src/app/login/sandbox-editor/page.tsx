"use client";

import { useState } from "react";
import { ResumeDocument } from "@/components/ResumeDocument";
import { emptyResume, withDoc } from "@/lib/resume";
import { paragraph, buildDoc } from "@/lib/doc/model";
import type { Resume } from "@/lib/types";
import type { DocJSON } from "@/lib/doc/types";

const sample = (): DocJSON =>
  buildDoc([
    { node: paragraph("Jane Doe", { marks: [{ type: "bold" }] }), listType: null, depth: 0, bullet: false },
    { node: paragraph("jane@example.com | 555-1234"), listType: null, depth: 0, bullet: false },
    { node: paragraph("EXPERIENCE", { attrs: { borderBottom: true } }), listType: null, depth: 0, bullet: false },
    { node: paragraph("Acme Corp"), listType: "bulletList", depth: 1, bullet: true },
    { node: paragraph("Led a team of five engineers"), listType: "bulletList", depth: 1, bullet: true },
    { node: paragraph("Shipped the billing rewrite"), listType: "bulletList", depth: 1, bullet: true },
    { node: paragraph("Plain line after the list"), listType: null, depth: 0, bullet: false },
  ]);

export default function SandboxEditor() {
  const [value, setValue] = useState<Resume>(() => withDoc(emptyResume(), sample()));
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [comment, setComment] = useState<HTMLDivElement | null>(null);
  return (
    <div style={{ padding: 8 }}>
      <div ref={setSlot} id="slot" style={{ display: "flex", flexWrap: "wrap", gap: 4 }} />
      <button id="ext" onClick={() => setValue((v) => withDoc(v, { ...v.doc!, content: [...(v.doc!.content as DocJSON["content"]).slice(0, 2), ...(v.doc!.content as DocJSON["content"]).slice(3)] }))}>ext</button>
      <div id="comment" ref={setComment} />
      <ResumeDocument value={value} onChange={setValue} actionsSlot={slot} commentSlot={comment} />
    </div>
  );
}
