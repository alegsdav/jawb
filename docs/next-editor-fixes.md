# Resume editor: open issues for the next session

State: the master/tailored resume editor is a Google-Docs-style ProseMirror document (src/components/ResumeDocument.tsx).
Each line has a paragraph style (name, contact, heading, entry, role, bullet, text) that tells the app what the line IS;
formatting is explicit data (resume version 3: `marks` = bold/italic/underline/size ranges over plain text fields,
`para` = align/rule/caps/spaceBefore per line; see src/lib/types.ts). Text stays plain, so the AI reads clean text.
The Harvard look is a template (src/lib/template.ts) applied only to pasted-text imports and the guided builder;
PDF imports come in unformatted. Fixed page setup: Letter, margins 0.2in top/bottom and 0.42in left/right, Calibri
(Carlito fallback, public/fonts) 11pt, line-height 1.15. Key files: src/lib/docLines.ts (Resume <-> lines),
src/lib/pmSchema.ts (ProseMirror schema), src/lib/docEditing.ts (commands/keymap), src/components/docDecorations.ts
(AI highlights), src/components/ResumeView.tsx + ResumePdf.tsx (read-only + PDF), src/lib/richText.ts (mark helpers).

An end-to-end UX test (Playwright against a sandbox using the real menus/editor/PDF) found the issues below.

## Required fixes (users hit these)

1. **Format menu taller than the screen, can't scroll.** ~1100px tall (12 sizes, 4 aligns, 3 toggles, 7 styles, Clear
   formatting); items from "Normal text" down are unreachable by mouse at 768–900px height and on phones.
   Fix: `src/components/Menu.tsx` popup (~line 99) gets `max-h-[calc(100dvh-8rem)] overflow-y-auto`; also shorten the
   size list in the Format menus of `src/app/(app)/resume/page.tsx` (~417–505) and `src/app/(app)/jobs/[id]/page.tsx`
   (e.g. 8, 10, 11, 12, 14, 16, 18, 24; the toolbar select keeps the full list).

2. **Undo/Redo via toolbar button or Edit menu drops editor focus; the next keystrokes are lost.** Ctrl+Z is fine.
   Fix: after `doc.undo()` / `doc.redo()` from the toolbar (`UndoRedo` in DocToolbar.tsx) and the Edit menu, refocus the
   editor (e.g. add `focus()` to DocCommands in src/components/editorTypes.ts, implement in ResumeDocument, call it from
   both pages after undo/redo; keep the caret where the external sync restores it).

3. **Phantom blank line for text before the first heading.** Any line between the header and the first heading (e.g. a
   second contact line set to Normal text) lands in an untitled section (`ensureSection`, src/lib/docLines.ts ~158).
   `resumeToLines` (~59) always emits a `heading` line per section, so after any rebuild (undo/redo, view page, PDF) an
   empty heading line appears. Fix: don't emit a heading line for a section with title "" and no marks/para (and make
   sure linesToResume → resumeToLines stays stable for it; add tests in tests/doc-lines.test.ts).

4. **Typing from scratch puts the contact in the wrong place.** Empty resume: type name, Enter, type email → the email
   becomes a text line and the empty contact line stays stranded below. Cause: src/lib/docEditing.ts ~225–227
   (`nextKind(name)` = contact, but an empty contact line already exists → falls back to "text" and splits).
   Fix: Enter at the end of the name line moves the caret to the next line when that line is an empty contact line
   (no split). Add a test.

5. **Enter at the end of the contact line creates a section heading** (src/lib/docLines.ts NEXT_KIND `contact: "heading"`,
   ~271), so a second contact line is read by the AI as a section title. Fix: contact → "text".

## Decision pending (ask the user)
- When a line is changed to Section heading / Entry title / Entry subtitle it keeps its plain look, so a new heading
  doesn't match the others. Proposed (Docs-like, nothing hardcoded): setLineKind copies the marks-format and para of the
  nearest existing line of that kind in the document (plain if none). Not implemented yet — confirm with the user first.

## Nice-to-haves
- Escape doesn't close the bullet comment card (ResumeDocument.tsx ~575 only clears toolbar activity).
- Right-aligned bullet: editor/view draw "•Text" jammed together; PDF puts the dot left, text right.
- PDF: a bullet whose line has a 14pt word gets a larger, raised "•" (give the dot Text a fixed 11pt size/lineHeight).
- Phone: toolbar scrolls sideways (B/I/U off-screen) — consider wrapping or a compact overflow.
- Undo coalescing (1s) merges typing on two different lines into one step (src/lib/useHistory.ts).
- Cut across a heading + bullet, then paste at the start of a bullet turns the remainder into a heading (PM join; rare).
- Centered bullet is ~6pt right of true center (marker box counts in alignment).
- README still says the master resume is "Harvard-format… (Times…)" — now Calibri, template optional.
- No test pins `linesInSelection` for a selection ending on an empty last line.
- "Save as master" doesn't carry formatting-only edits from a tailored copy (only reworded text). Kept as is; revisit if wanted.
- PDF imports lose the PDF's own bold/italic (the AI parse returns text only). A "Reformat to our template" button is a
  planned follow-up the user mentioned.

## How to verify
`npx tsc --noEmit -p .`, `npx eslint src tests`, `npx vitest run` (699 tests passing at handoff), `npx next build`.
For UX: a temporary public route under `src/app/login/<sandbox>/` (paths under /login skip auth) rendering
ResumeDocument with `useHistory` and the page's Format/Edit menu JSX, dev server with
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npx next dev`, driven by Playwright;
delete the sandbox (and the generated `.next/types`) afterwards.
