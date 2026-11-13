import { MOCK_RE } from "@/lib/bank";

/** Renders text with [mock numbers] highlighted so example values are never mistaken for real ones. */
export function MockText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MOCK_RE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    parts.push(
      <mark key={i} className="rounded px-0.5 bg-[#fde9a8] text-[#5c4300]" title="Example number: replace with your real figure">
        {m[0].slice(1, -1)}
      </mark>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
