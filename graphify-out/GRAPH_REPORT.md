# Graph Report - jawb  (2026-11-15)

## Corpus Check
- 93 files · ~74,565 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: .example 1, (none) 1, .ico 1)

## Summary
- 730 nodes · 2069 edges · 24 communities (21 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22

## God Nodes (most connected - your core abstractions)
1. `JobPage()` - 109 edges
2. `TrackerPage()` - 31 edges
3. `bulletTextMap()` - 27 edges
4. `Resume` - 27 edges
5. `MasterResumePage()` - 26 edges
6. `normalizeResume()` - 25 edges
7. `next` - 22 edges
8. `vitest` - 22 edges
9. `react` - 21 edges
10. `ResumeDocument()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `analysis()` --calls--> `normalizeAnalysis()`  [EXTRACTED]
  tests/feedback.test.ts → src/lib/analysis.ts
- `g()` --calls--> `guardNumbers()`  [EXTRACTED]
  tests/honesty.test.ts → src/lib/analysis.ts
- `texts()` --calls--> `bulletTextMap()`  [EXTRACTED]
  tests/job-sync.test.ts → src/lib/resume.ts
- `change()` --calls--> `applyStatusChange()`  [EXTRACTED]
  tests/status.test.ts → src/lib/status.ts
- `setup()` --calls--> `createJobWrites()`  [EXTRACTED]
  tests/job-writes.test.ts → src/lib/jobWrites.ts

## Import Cycles
- None detected.

## Communities (24 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (80): addAll(), addOne(), changeStatus(), confirmSaveMaster(), keepMine(), leaveOut(), onRemoval(), reloadTheirs() (+72 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (59): react, Conflict, FitInput(), Flash, JobPage(), acceptAll(), copy(), copyCoverLetter() (+51 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (56): resetFromMaster(), Conflict, ConflictBanner(), loadOrCreateMaster(), MasterResumePage(), keepMine(), reloadTheirs(), MasterRow (+48 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (48): pullFromMaster(), setStatus(), addedOn(), AddJobForm(), send(), submit(), toPaste(), Capture (+40 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (33): nextConfig, SECURITY_HEADERS, next, AccountPage(), metadata, AppLayout(), dynamic, metadata (+25 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (41): Filter, FollowedUpButton(), followUpDue(), RowSaveNote(), Sort, TrackerPage(), followedUp(), setField() (+33 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (31): bad(), maxDuration, POST(), assertPublicUrl(), blockedIPv4(), FETCH_TIMEOUT_MS, FetchedJob, fetchJobFromUrl() (+23 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (31): isMissingColumn(), bindPageLifecycle(), createJobWrites(), conflict(), fail(), flush(), DbError, JobRowValues (+23 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (24): dynamic, GET(), maxDuration, POST(), ResumeImport(), ApiResult, postApi(), DbError (+16 more)

### Community 9 - "Community 9"
Cohesion: 0.15
Nodes (19): maxDuration, POST(), maxDuration, POST(), attachOriginals(), guardAnalysisNumbers(), guardCoverLetter(), mergeAnalysis() (+11 more)

### Community 10 - "Community 10"
Cohesion: 0.08
Nodes (28): AnalysisBullets, bulletFeedback(), COUNT_WORDS, emptyKnown(), escapeRe(), fitOfRaw(), FITS, MAGNITUDE (+20 more)

### Community 11 - "Community 11"
Cohesion: 0.16
Nodes (24): markPlaceholders(), PlaceholderTextarea(), Active, AutoInput(), AutoTextarea(), ContextBar(), isField(), locateBullet() (+16 more)

### Community 12 - "Community 12"
Cohesion: 0.13
Nodes (20): devDependencies, eslint@^9, eslint-config-next@15.5.29, tailwindcss@^4, @tailwindcss/postcss@^4, @types/node@^20, @types/react@^19, @types/react-dom@^19 (+12 more)

### Community 13 - "Community 13"
Cohesion: 0.17
Nodes (19): saveAnswers(), answerFact(), answerFactPlan(), answerFacts(), applyAnswerFacts(), BulletFeedback, carryClientState(), fillPlaceholder() (+11 more)

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 15 - "Community 15"
Cohesion: 0.19
Nodes (16): capitalizeLike(), glued(), guardWith(), keyOf(), knownNumbers(), numberWords(), overlaps(), protectedRanges() (+8 more)

### Community 16 - "Community 16"
Cohesion: 0.21
Nodes (11): AI_DOWN_MESSAGE, AI_KEY_MESSAGE, AI_LIMIT_MESSAGE, friendlyGeminiError(), GeminiFile, geminiJSON(), geminiText(), isDocUndoTarget() (+3 more)

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (13): dependencies, next@15.5.29, react@19.1.0, react-dom@19.1.0, @react-pdf/renderer@^4.9.0, server-only@^0.0.1, @supabase/ssr@^0.12.7, @supabase/supabase-js@^2.119.0 (+5 more)

### Community 18 - "Community 18"
Cohesion: 0.22
Nodes (9): arr(), guardNumbers(), KnownNumbers, normalizeAnalysis(), str(), usedPlaceholders(), analysis(), facts (+1 more)

### Community 19 - "Community 19"
Cohesion: 0.22
Nodes (6): compat, __dirname, eslintConfig, __filename, @eslint/eslintrc@^3, @eslint/eslintrc

### Community 20 - "Community 20"
Cohesion: 0.33
Nodes (6): scripts, build, dev, lint, start, test

## Knowledge Gaps
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `Community 4` to `Community 1`, `Community 2`, `Community 3`, `Community 5`, `Community 6`, `Community 8`, `Community 9`, `Community 12`, `Community 17`?**
  _High betweenness centrality (0.111) - this node is a cross-community bridge._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05128205128205128 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `Community 21` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 9`, `Community 12`, `Community 13`, `Community 16`, `Community 18`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06116700201207243 - nodes in this community are weakly interconnected._
- **Why does `JobPage()` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`, `Community 5`, `Community 7`, `Community 8`, `Community 10`, `Community 11`, `Community 13`, `Community 16`, `Community 18`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06540825285338016 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.06554019457245264 - nodes in this community are weakly interconnected._