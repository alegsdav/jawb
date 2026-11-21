"use client";

import Link from "next/link";
import { PAGE_DEFAULTS } from "@/lib/doc/types";
import { useKindSlide, type EditorKind } from "@/lib/editorKind";
import { DocToolbar, EditorToolbar, IconButton, MenuBar, ToolbarSep, useZoom } from "./DocToolbar";
import { FormatToolbar } from "./FormatToolbar";
import { EMPTY_FORMAT_STATE, NOOP_COMMANDS, type FormatState } from "./editorTypes";
import { DownloadIcon } from "./icons";
import { Loader } from "./Loader";
import { EditorCanvas } from "./ZoomFrame";

/**
 * The toolbar's format state with no selection. The real editor shows the size of the text under its caret, which
 * the skeleton can't know, so the size box stays empty here rather than showing a size that's wrong.
 */
const BLANK_FORMAT: FormatState = { ...EMPTY_FORMAT_STATE, fontSize: null };

/** The job page's tabs. The page and its loading state both read them from here, so they can't drift apart. */
export const JOB_TABS = [
  ["resume", "Resume"],
  ["analysis", "Analysis"], // phones/tablets only; desktop shows it in the sidebar
  ["job", "Posting"],
  ["cover", "Letter"],
] as const;

const noop = () => {};

/** A menu name in the top bar: the classes of a Menu trigger, with no popup yet. */
const MenuLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded px-1.5 py-1 text-[13px] text-fg sm:px-2">{children}</span>
);

/** The page as it is while its document loads: blank paper, with the loader centred over the visible canvas. */
export function BlankDocument({ zoom, className }: { zoom: number; className: string }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <EditorCanvas zoom={zoom} className={className}>
        {/* The wrapper ResumeDocument puts the page in: its top padding is what places the page on the canvas. */}
        <div className="doc-canvas">
          <div
            className="doc-page doc-page-blank"
            style={{
              padding: `${PAGE_DEFAULTS.marginTop}in ${PAGE_DEFAULTS.marginRight}in ${PAGE_DEFAULTS.marginBottom}in ${PAGE_DEFAULTS.marginLeft}in`,
            }}
          />
        </div>
      </EditorCanvas>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <Loader label="Loading document…" />
      </div>
    </div>
  );
}

/** The status bar's frame with no text yet: same height and border, so the page doesn't shift when it fills in. */
export function StatusBarFrame() {
  return <div className="h-7 shrink-0 flex items-center gap-3 px-3 border-t border-border bg-surface text-[11px] text-muted" />;
}

/** Shell of the job editor: the top bar, the formatting row and the panel frame, with no data. */
function JobSkeleton() {
  const slide = useKindSlide("job");
  const [zoom] = useZoom("job");
  const tabs = (className: string) => (
    <div className={className}>
      {JOB_TABS.map(([key, label]) => (
        <span
          key={key}
          className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-[1.5px] px-0.5 text-[13px] transition-colors ${
            key === "analysis" ? "xl:hidden" : ""
          } ${key === "resume" ? "border-fg text-fg" : "border-transparent text-muted"}`}
        >
          {label}
        </span>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col min-h-[calc(100dvh-7rem)] sm:min-h-[calc(100dvh-7.5rem)] lg:h-full lg:min-h-0">
      <div className="sticky top-0 z-10 shrink-0">
        <DocToolbar>
          <Link href="/" className={`shrink-0 rounded-md px-1.5 py-1 text-xs text-muted hover:text-fg ${slide.className}`} style={slide.style}>
            <span aria-hidden="true">← </span>Jobs
          </Link>
          <div className="ml-2 whitespace-normal sm:whitespace-nowrap [&>div]:gap-0 [&_button[aria-haspopup]]:px-1.5 [&_[role=menu]]:min-w-44 sm:[&>div]:gap-0.5 sm:[&_button[aria-haspopup]]:px-2 sm:[&_[role=menu]]:min-w-56">
            <MenuBar>
              <MenuLabel>File</MenuLabel>
              <MenuLabel>Format</MenuLabel>
            </MenuBar>
          </div>
          {tabs(`ml-2 hidden h-full min-w-0 flex-1 items-stretch gap-3 overflow-x-auto sm:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${slide.className}`)}
          <div className="w-[112px] shrink-0 items-center justify-end ml-auto hidden pl-2 sm:flex" />
        </DocToolbar>
        <div className="flex h-10 items-center gap-2 border-b border-border bg-surface px-3 sm:hidden">
          {tabs(`flex h-full min-w-0 flex-1 items-stretch gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${slide.className}`)}
          <div className="w-[84px] shrink-0 items-center justify-end flex text-[11px] [&_*]:text-[11px]" />
        </div>
      </div>

      <div className="shrink-0">
        <EditorToolbar>
          <div className="flex shrink-0 items-center">
            <FormatToolbar fmt={BLANK_FORMAT} commands={NOOP_COMMANDS} />
          </div>
          <ToolbarSep />
          <div className={`ml-auto flex shrink-0 items-center gap-1 ${slide.className}`} style={slide.style}>
            <IconButton label="Download PDF" onClick={noop} disabled>
              <DownloadIcon />
            </IconButton>
          </div>
        </EditorToolbar>
      </div>

      <div className="flex flex-col lg:min-h-0 lg:flex-1 xl:flex-row">
        <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <BlankDocument zoom={zoom} className="min-w-0 flex-1 lg:overflow-auto" />
            <StatusBarFrame />
          </div>
        </div>
        {/* The right panel's frame, empty. Phones: hidden on the Resume tab, as on the real page. */}
        <aside className="relative order-first space-y-3 border-b border-border p-4 lg:min-h-0 lg:overflow-y-auto xl:order-none xl:space-y-4 xl:w-[340px] xl:shrink-0 xl:border-b-0 xl:border-l max-xl:space-y-0 max-xl:border-b-0 max-xl:p-0" />
      </div>
    </div>
  );
}

/** Shell of the master resume editor: the top bar, the formatting row and the panel frame, with no data. */
function MasterSkeleton() {
  const slide = useKindSlide("master");
  const [zoom] = useZoom("resume");
  return (
    <div className="flex flex-col lg:h-full lg:min-h-0">
      <DocToolbar>
        <h1 className="sr-only">Master resume</h1>
        <div className="ml-1 flex min-w-0 items-center whitespace-normal sm:whitespace-nowrap [&>div]:gap-0 [&_button[aria-haspopup]]:px-1.5 [&_[role=menu]]:min-w-36 sm:[&>div]:gap-0.5 sm:[&_button[aria-haspopup]]:px-2 sm:[&_[role=menu]]:min-w-56">
          <MenuBar>
            <MenuLabel>File</MenuLabel>
            <MenuLabel>Format</MenuLabel>
          </MenuBar>
        </div>
        <div className={`ml-auto flex min-w-0 items-center gap-2 ${slide.className}`} style={slide.style}>
          <span className="block min-w-0 max-w-[72px] overflow-hidden text-right sm:max-w-none" />
          <span aria-hidden="true" className="invisible hidden rounded-md px-2 py-1 text-xs text-muted sm:inline-flex xl:hidden">
            Facts (0)
          </span>
        </div>
      </DocToolbar>

      {/* Phones and tablets: the Resume and Coach switch, as on the real page. */}
      <div className="flex items-stretch gap-3 border-b border-border px-4 pt-1 xl:hidden">
        <span className="-mb-px flex shrink-0 items-center whitespace-nowrap border-b-[1.5px] px-0.5 py-1.5 text-[13px] border-fg text-fg">Resume</span>
        <span className="-mb-px flex shrink-0 items-center whitespace-nowrap border-b-[1.5px] px-0.5 py-1.5 text-[13px] border-transparent text-muted">Coach &amp; facts</span>
      </div>

      <div data-doc-keep-selection className="flex min-h-10 flex-nowrap items-center gap-1 overflow-x-auto border-b border-border bg-surface px-2 py-1">
        <div className="flex shrink-0 items-center">
          <FormatToolbar fmt={BLANK_FORMAT} commands={NOOP_COMMANDS} />
        </div>
        <div className="ml-auto shrink-0">
          <IconButton label="Download PDF" onClick={noop} disabled>
            <DownloadIcon />
          </IconButton>
        </div>
      </div>

      <div className="flex flex-col lg:min-h-0 lg:flex-1 xl:flex-row">
        <div className="min-w-0 flex-1 flex-col lg:min-h-0 xl:flex flex">
          <BlankDocument zoom={zoom} className="min-w-0 flex-1 pb-6 lg:min-h-0 lg:overflow-auto" />
          <StatusBarFrame />
        </div>
        {/* The right panel's frame, empty. */}
        <div id="side-panel" className="scroll-mt-16 border-border lg:min-h-0 lg:overflow-y-auto xl:relative xl:w-[340px] xl:shrink-0 xl:space-y-4 xl:border-l xl:p-4" />
      </div>
    </div>
  );
}

/** The loading state of either editor page, with the chrome the real page shows. Nothing in it is data. */
export function EditorSkeleton({ kind }: { kind: EditorKind }) {
  return kind === "job" ? <JobSkeleton /> : <MasterSkeleton />;
}
