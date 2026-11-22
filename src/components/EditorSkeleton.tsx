"use client";

import { PAGE_DEFAULTS } from "@/lib/doc/types";
import { useKindSlide, type EditorKind } from "@/lib/editorKind";
import { DocToolbar, EditorToolbar, IconButton, MenuBar, ToolbarSep, useZoom } from "./DocToolbar";
import { FormatToolbar } from "./FormatToolbar";
import { EMPTY_FORMAT_STATE, NOOP_COMMANDS, type FormatState } from "./editorTypes";
import { DownloadIcon } from "./icons";
import { EditorCanvas } from "./ZoomFrame";

/**
 * The toolbar's format state with no selection. The real editor shows the size of the text under its caret, which
 * the skeleton can't know, so the size box stays empty here rather than showing a size that's wrong.
 */
const BLANK_FORMAT: FormatState = { ...EMPTY_FORMAT_STATE, fontSize: null };

/**
 * The job page's tabs. The page and its loading state both read them from here, so they can't drift apart.
 * PANEL_TABS is the right-hand panel's row (desktop); JOB_TABS is the phone row, which starts with Resume.
 */
export const PANEL_TABS = [
  ["overview", "Overview"],
  ["job", "Posting"],
  ["cover", "Letter"],
  ["facts", "Facts"],
] as const;
export const JOB_TABS = [["resume", "Resume"], ...PANEL_TABS] as const;
/** The master page's tabs: the right panel's row, and the phone row (which starts with Resume). */
export const MASTER_PANEL_TABS = [
  ["overview", "Overview"],
  ["facts", "Facts"],
] as const;
export const MASTER_TABS = [["resume", "Resume"], ...MASTER_PANEL_TABS] as const;

const noop = () => {};

/** A menu name in the top bar: the classes of a Menu trigger, with no popup yet. */
const MenuLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded px-1.5 py-1 text-[13px] text-fg sm:px-2">{children}</span>
);

/** The page as it is while its document loads: blank paper; the document appears on it once it has fully loaded. */
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
    </div>
  );
}

/** The status bar's frame with no text yet: same height and border, so the page doesn't shift when it fills in. */
export function StatusBarFrame() {
  return <div className="h-7 shrink-0 flex items-center gap-3 px-3 border-t border-border bg-surface text-[11px] text-muted" />;
}

/** A tab row as the real page draws it (same labels, same underline), with no clicks: the loading state's tabs. */
function SkeletonTabs({
  tabList, active, className, slide,
}: {
  tabList: readonly (readonly [string, string])[];
  active: string;
  className: string;
  slide: ReturnType<typeof useKindSlide>;
}) {
  return (
    <div className={`${className} ${slide.className}`} style={slide.style}>
      {tabList.map(([key, label]) => (
        <span
          key={key}
          className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-[1.5px] px-0.5 text-[13px] transition-colors ${
            key === active ? "border-fg text-fg" : "border-transparent text-muted"
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

/** Shell of the job editor: the same frame as the page (document column, panel column), with no data. */
function JobSkeleton() {
  const slide = useKindSlide("job");
  const [zoom] = useZoom("job");
  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col sm:min-h-[calc(100dvh-7.5rem)] lg:h-full lg:min-h-0">
      <div className="flex flex-1 flex-col lg:grid lg:min-h-0 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
        <section className="flex min-w-0 flex-col max-lg:flex-1 lg:min-h-0">
          <div className="sticky top-0 z-10 shrink-0">
            <DocToolbar>
              <div className="ml-2 whitespace-normal sm:whitespace-nowrap [&>div]:gap-0 [&_button[aria-haspopup]]:px-1.5 [&_[role=menu]]:min-w-44 sm:[&>div]:gap-0.5 sm:[&_button[aria-haspopup]]:px-2 sm:[&_[role=menu]]:min-w-56">
                <MenuBar>
                  <MenuLabel>File</MenuLabel>
                  <MenuLabel>Format</MenuLabel>
                </MenuBar>
              </div>
              <div className="ml-auto w-[112px] shrink-0 items-center justify-end flex" />
            </DocToolbar>
            <div className="flex h-11 items-center border-b border-border bg-surface px-3 lg:hidden">
              <SkeletonTabs
                tabList={JOB_TABS}
                active="resume"
                className="flex h-full min-w-0 flex-1 items-stretch gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                slide={slide}
              />
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col max-lg:hidden lg:flex">
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
            <BlankDocument zoom={zoom} className="min-w-0 flex-1 lg:overflow-auto" />
            <StatusBarFrame />
          </div>
        </section>

        {/* The panel's frame: its tab row (desktop only; phones have the row above) and an empty column. */}
        <section className="hidden min-w-0 flex-col border-l border-border lg:flex lg:min-h-0">
          <div className="flex h-11 shrink-0 items-stretch border-b border-border px-6">
            <SkeletonTabs tabList={PANEL_TABS} active="overview" className="flex h-full min-w-0 items-stretch gap-4 overflow-hidden" slide={slide} />
          </div>
        </section>
      </div>
    </div>
  );
}

/** Shell of the master resume editor: the same frame as the page (document column, panel column), with no data. */
function MasterSkeleton() {
  const slide = useKindSlide("master");
  const [zoom] = useZoom("resume");
  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col sm:min-h-[calc(100dvh-7.5rem)] lg:h-full lg:min-h-0">
      <div className="flex flex-1 flex-col lg:grid lg:min-h-0 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
        <section className="flex min-w-0 flex-col max-lg:flex-1 lg:min-h-0">
          <div className="sticky top-0 z-10 shrink-0">
            <DocToolbar>
              <div className="ml-2 whitespace-normal sm:whitespace-nowrap [&>div]:gap-0 [&_button[aria-haspopup]]:px-1.5 [&_[role=menu]]:min-w-44 sm:[&>div]:gap-0.5 sm:[&_button[aria-haspopup]]:px-2 sm:[&_[role=menu]]:min-w-56">
                <MenuBar>
                  <MenuLabel>File</MenuLabel>
                  <MenuLabel>Format</MenuLabel>
                </MenuBar>
              </div>
              <div className="ml-auto w-[112px] shrink-0 items-center justify-end flex" />
            </DocToolbar>
            <div className="flex h-11 items-center border-b border-border bg-surface px-3 lg:hidden">
              <SkeletonTabs
                tabList={MASTER_TABS}
                active="resume"
                className="flex h-full min-w-0 flex-1 items-stretch gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                slide={slide}
              />
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col max-lg:hidden lg:flex">
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
            <BlankDocument zoom={zoom} className="min-w-0 flex-1 pb-6 lg:min-h-0 lg:overflow-auto" />
            <StatusBarFrame />
          </div>
        </section>

        {/* The panel's frame: its tab row (desktop only; phones have the row above) and an empty column. */}
        <section className="hidden min-w-0 flex-col border-l border-border lg:flex lg:min-h-0">
          <div className="flex h-11 shrink-0 items-stretch border-b border-border px-6">
            <SkeletonTabs tabList={MASTER_PANEL_TABS} active="overview" className="flex h-full min-w-0 items-stretch gap-4 overflow-hidden" slide={slide} />
          </div>
        </section>
      </div>
    </div>
  );
}

/** The loading state of either editor page, with the chrome the real page shows. Nothing in it is data. */
export function EditorSkeleton({ kind }: { kind: EditorKind }) {
  return kind === "job" ? <JobSkeleton /> : <MasterSkeleton />;
}
