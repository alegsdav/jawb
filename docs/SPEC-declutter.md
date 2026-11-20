# Declutter spec (T5)

Source: the QA audit (52 findings) on the live app, filtered by the orchestrator. The goal is **minimal and clean**: one
place for each thing, no filler text, nothing broken-looking. **Change presentation only.** Don't change what any
feature does, how it saves, or its data. If removing a UI element would make a feature unreachable, it's out of scope;
stop and report it.

Ground rules from `docs/SPEC.md` apply: no git commands that change state, touch only your files, and run
`npx vitest run`, `npx tsc --noEmit` and `npm run lint` at the end. If a test asserts copy you were told to remove,
update that test's expectation. Never delete a test case that checks behaviour. Don't open a browser; one QA agent verifies afterwards.

Shared decision for both editor pages (D1 and D2 each apply it in their own page file):

- **Menu bar = File and Format only.** Remove the Edit, View and Help menus. Undo and redo stay on the toolbar and keyboard;
  cut, copy and paste are native; zoom moves to the status bar; the Help text is dropped.
  Keep the existing exports in `FormatMenus.tsx` and `DocToolbar.tsx` even if unused. The orchestrator cleans them up.
- **Toolbar** (left to right): Undo, Redo | Font, Size | Bold, Italic, Underline, Link | Bulleted list, Numbered list |
  (right side) Download PDF.
  - Remove from the toolbar: Print, zoom select, Copy as text, the four align buttons, the two indent buttons,
    "Spacing" and "Clear". Each is still in the File or Format menu.
  - On phones the toolbar is one horizontally scrollable row (`flex-nowrap overflow-x-auto`), never wrapping into several rows.
- **Zoom:** only the status-bar select.

---

## D1: Editor chrome (shared components + master resume page)

**Files:**
- `src/components/FormatToolbar.tsx`
- `src/components/FormatMenus.tsx`
- `src/components/Menu.tsx`
- `src/components/DocToolbar.tsx`
- `src/components/PageSetupDialog.tsx`
- `src/app/(app)/resume/page.tsx`

1. `FormatToolbar.tsx`: render only Font, Size, B, I, U, Link, Bulleted list and Numbered list. If the component takes
   props for the removed controls, keep the props (optional or ignored) so the job page still compiles.
2. `FormatMenus.tsx` Format menu:
   - keep every item. Format is now the home of alignment, spacing, Tab stops, the line and Clear formatting;
   - shorten the line-spacing labels to "1", "1.15", "1.5", "2" under a "Line spacing" group label;
   - alignment labels must not wrap ("Align left" stays on one line).
3. `Menu.tsx`:
   - menu panels on phones must fit above the 56px bottom nav. Use a max-height of `calc(100dvh - 8rem - 56px)` below `lg`, and scroll inside;
   - `MenuItem` hint text wraps (`whitespace-normal`, max width about 18rem) and never runs off-screen.
4. `DocToolbar.tsx`: `PageCount` renders nothing for 1 page. It keeps the over-length warning ("2 pages · ~N lines over").
5. `PageSetupDialog.tsx`:
   - delete the "Now: top … in" line and the "Presets" label;
   - shorten the subtitle to "Margins in inches (0.2–3).";
   - the three preset pills fit on one row on desktop; shorten the labels to "Narrow", "Moderate", "Normal" with the values in `title`.
6. `resume/page.tsx`:
   - menu bar = File and Format only, per the shared decision;
   - File menu: remove the hint lines ("Your resume as a PDF, ready to send", "Margins of every page");
   - remove the "Master resume" pill in the toolbar (the `h1` with DocIcon). Keep an `sr-only` `h1` "Master resume" for accessibility;
   - apply the toolbar line-up from the shared decision;
   - remove the now-unused `EDIT_TIPS`/`EDIT_SHORTCUTS` constants in this file if nothing else uses them.

---

## D2: Job page

**Files:**
- `src/app/(app)/jobs/[id]/page.tsx`
- `src/components/job/JobHeader.tsx`
- `src/components/job/JobTabs.tsx`
- `src/components/job/AppliedNotice.tsx` (only if needed)
- `src/components/PriorityList.tsx`
- `src/components/PullBanner.tsx`
- `src/components/AnalysisPanel.tsx`
- `src/components/StatusSelect.tsx`
- `src/components/DeadlineField.tsx`

1. **Menus and toolbar:**
   - menu bar = File and Format only;
   - the toolbar line-up from the shared decision;
   - the menu bar and formatting toolbar render **only on the Resume tab**. Hide them on Posting and Letter (on phones too);
   - remove the duplicated Help text constant in this file if it becomes unused.
2. **Tabs:**
   - labels are "Resume", "Posting" and "Letter" on every screen size;
   - no suggestion count in the tab ("Tailored resume (9)" becomes "Resume").
3. **Suggestions row** under the toolbar: remove the "N suggestions" text, the toolbar "Accept all" (the side panel keeps
   its own) and "1 page". Keep "Review" and the feedback toggle. Relabel the toggle "Highlights: On"/"Off".
4. **Title once:**
   - the breadcrumb becomes just "← Jobs" (a link to `/`);
   - the side-panel `h1` shows the full title wrapped (no clipping, no truncation).
5. **Metadata block** (company · location, Status, Deadline, Follow up):
   - a 2-column grid of label and control. All controls are the same width and height;
   - Follow up shows only when status is applied or later (`SUBMITTED_STATUSES` or the equivalent);
   - "Delete job" moves into a small "⋯" menu button next to the title (use the existing `Menu` components). Keep its confirm behaviour.
6. **"Reset to master resume" pill** (`PullBanner`): when there is no conflict, don't render the floating pill. The action
   stays in the File menu. When there IS a conflict or a replaced master, keep today's banner.
7. **Colour legend** ("Colours in the document ?"):
   - collapsed by default;
   - rendered at the bottom of the side panel, after the analysis, not between the metadata and the tabs.
8. **`AnalysisPanel.tsx`:**
   - remove the repeated "Analysis" heading text;
   - the fit pill sits next to Re-analyze on one line.
9. **`PriorityList.tsx`:**
   - one "Accept all" (the panel header);
   - remove the "Show in resume" button. Clicking the card body (not its buttons) does what "Show in resume" did. Make it keyboard-accessible: a `button` or a `role=button` with Enter/Space;
   - don't repeat the same rating heading on every card. Group by rating, with one heading per group.
10. **`JobTabs.tsx`** Letter tab: delete the helper line "Only send one if the application asks. Replace every [placeholder] first."
    The placeholder text stays.

---

## D3: Dashboard

**Files:**
- `src/app/(app)/page.tsx`
- `src/components/dashboard/*`
- `src/components/AddJobForm.tsx`
- `src/components/Bookmarklet.tsx`
- `src/components/OutcomeStats.tsx`
- `src/components/CompanyMark.tsx` (only if needed)

1. Delete the "Recommended internships" and "Inbox updates" Coming-soon cards and `dashboard/ComingSoon.tsx`.
2. `Overview.tsx`:
   - remove the greeting subtitle ("2 jobs waiting to be tailored.");
   - the stat strip shows only tiles with a value above 0. With nothing to show, render no strip.
3. `InProgress.tsx`:
   - remove the Sort select. Fixed order: deadline soonest first, no deadline last, then most recently updated;
   - remove the "Continue" button. The whole row is the link;
   - remove the fit pill from these rows (the table has it);
   - progress shows the bar plus a compact "2/11" (no "suggestions reviewed" sentence).
4. **Applications table** (in `page.tsx`):
   - filter pills: show "All" and only the statuses or "Closing soon" with count > 0;
   - Deadline, Applied and Follow up cells show plain text dates (`shortDate`, "–" when empty) instead of date inputs. Editing them is on the job page;
   - keep the inline Status select and the "Followed up" button with Undo;
   - the table must fit its card at 1440px with no clipped column.
5. Phones: remove the "Jobs + Add job" header row on the dashboard. The Add-a-job card is on the page.
6. `AddJobForm.tsx`: delete the help paragraph ("Paste a job link (Greenhouse, Lever…)…"). The placeholder becomes "Job link or description".
7. `Bookmarklet.tsx`:
   - the disclosure body becomes one sentence ("Saves the posting you're viewing on LinkedIn, Handshake and other sites that need a login.");
   - then the two buttons;
   - then one line: "Drag it to your bookmarks bar, or on iPhone tap Copy code and save it as a bookmark's address.";
   - no bordered box.

---

## D4: Shell, Account, side panels

**Files:**
- `src/components/Sidebar.tsx`
- `src/components/NavLinks.tsx`
- `src/components/UsageMeter.tsx`
- `src/app/(app)/account/page.tsx`
- `src/components/PasswordForm.tsx`
- `src/components/CoachPanel.tsx`
- `src/components/FactsPanel.tsx`
- `src/components/SideTabs.tsx` (only if needed)

1. **Sidebar:**
   - the usage meter shows only when 2 or fewer analyses are left (or 0). Otherwise render nothing;
   - keep Recent jobs and search.
2. **Account page:**
   - container `max-w-lg`;
   - the email wraps at sensible points (`break-words`, not `break-all`);
   - replace the bordered cards with plain sections divided by spacing or a hairline;
   - captions:
     - delete "Set or change the password you sign in with.";
     - in the usage section, keep the two "N of M … left" lines and drop the explanatory captions under them;
     - in Export, keep one line ("A JSON backup of your resumes, facts and jobs.") and delete the "restoring it is done by hand in Supabase" sentence;
   - password: the inputs sit behind a "Change password" disclosure button. The same form opens.
   - Keep the admin "Manage AI limits →" link where it is.
3. **`CoachPanel.tsx`:**
   - remove the "Coach" heading inside the Coach tab;
   - the empty-state intro becomes one line: "Select a bullet to improve it.";
   - once a bullet is selected, remove "Make this stronger for any recruiter. Pick how you'd like to start:" and keep the two buttons;
   - keep one "nothing goes on your resume until you choose it" sentence at most.
4. **`FactsPanel.tsx`:**
   - remove the "Facts · N" heading (the tab shows the count);
   - the intro becomes one line: "True things about you the AI uses. Never printed.";
   - remove the "Add facts" label (keep an `aria-label` on the textarea).
