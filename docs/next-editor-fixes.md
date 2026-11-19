# Resume editor: state and open items

The resume is a plain rich-text document (resume version 4, `Resume.doc`, TipTap JSON; contract in
src/lib/doc/types.ts). The editor is TipTap (src/components/ResumeDocument.tsx, extensions in src/lib/doc/extensions.ts).
There are no sections or line kinds: what the AI needs (name, contact, headings, entries, bullets, with paragraph ids)
is derived by src/lib/doc/outline.ts and cached on the Resume as `header`/`sections` by `withDoc`. Every write must
change `doc` and go through `withDoc`.

Key files: src/lib/doc/model.ts (flatten/build and paragraph edits), src/lib/doc/legacy.ts (v1-3 migration),
src/lib/import/pdfToDoc.ts + textToDoc.ts (import, no AI), src/lib/docRender.ts + ResumeView.tsx + ResumePdf.tsx
(read-only and PDF), src/components/aiHighlights.ts (AI tints, dots, changed bar), src/lib/template.ts (Harvard
template, builder only), src/lib/tailor.ts / jobSync.ts / master.ts (paragraph-level pull, save-as-master, 3-way merge).

## Known limitations
- The outline is a heuristic (all-caps / bordered / known heading words). An entry titled with a heading word
  ("Volunteer") can be read as a section; two short plain lines in a row can be read as one entry.
- The tailored copy's baseline holds text only, so a formatting change the master makes later can be carried back by
  "Save as master" as if the copy made it.
- PDF import: underline isn't detected; spacing above paragraphs comes back about 1pt smaller; scanned PDFs need text.
- A horizontal line inserted from inside a list goes after the whole list.

## How to verify
`npx tsc --noEmit -p .`, `npx eslint src tests`, `npx vitest run`, `npx next build`. For UX: a temporary public
route under `src/app/login/<sandbox>/` (paths under /login skip auth) rendering ResumeDocument with an `actionsSlot`,
dev server with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npx next dev`, driven
by Playwright with short pauses between a typed burst and the next click (ProseMirror, like any contenteditable editor,
ignores selection changes for a moment after it updates the DOM). Delete the sandbox and `.next` afterwards.
