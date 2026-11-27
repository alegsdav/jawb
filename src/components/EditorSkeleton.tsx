"use client";

import { PAGE_DEFAULTS } from "@/lib/doc/types";
import { DocToolbar, EditorToolbar, IconButton, MenuBar, ToolbarSep, useZoom } from "./DocToolbar";
import { FormatToolbar } from "./FormatToolbar";
import { REVIEW_SPLIT_KEY, SplitPane } from "./SplitPane";
import { EMPTY_FORMAT_STATE, NOOP_COMMANDS } from "./editorTypes";
import { DownloadIcon } from "./icons";
import { EditorCanvas } from "./ZoomFrame";

/** The two editor pages: a tailored job copy, or the master resume. */
export type EditorKind = "job" | "master";

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
  tabList, active, className,
}: {
  tabList: readonly (readonly [string, string])[];
  active: string;
  className: string;
}) {
  return (
    <div className={className}>
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

/**
 * Shell of an editor page: the same frame as the real page (document column, panel column), with no data. The job and
 * master pages share it; only the tab lists and the document's zoom key differ, and the zoom key is shared too.
 */
function SkeletonFrame({ tabs, panelTabs, active }: {
  tabs: readonly (readonly [string, string])[];
  panelTabs: readonly (readonly [string, string])[];
  active: string;
}) {
  const [zoom] = useZoom("doc");
  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col sm:min-h-[calc(100dvh-7.5rem)] lg:h-full lg:min-h-0">
      <SplitPane storageKey={REVIEW_SPLIT_KEY}>
        <section className="flex min-w-0 flex-col max-lg:flex-1 lg:min-h-0">
          <div className="sticky top-0 z-10 shrink-0">
            <DocToolbar>
              <div className="ml-2 whitespace-normal sm:whitespace-nowrap [&>div]:gap-0 [&_button[aria-haspopup]]:px-1.5 [&_[role=menu]]:min-w-44 sm:[&>div]:gap-0.5 sm:[&_button[aria-haspopup]]:px-2 sm:[&_[role=menu]]:min-w-56">
                <MenuBar>
                  <MenuLabel>File</MenuLabel>
                  <MenuLabel>Format</MenuLabel>
                </MenuBar>
              </div>
            </DocToolbar>
            <div className="flex h-9 items-center border-b border-border bg-surface px-3 lg:hidden">
              <SkeletonTabs
                tabList={tabs}
                active={active}
                className="flex h-full min-w-0 flex-1 items-stretch gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              />
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col max-lg:hidden lg:flex">
            <div className="shrink-0">
              <EditorToolbar>
                <div className="flex shrink-0 items-center">
                  <FormatToolbar fmt={EMPTY_FORMAT_STATE} commands={NOOP_COMMANDS} />
                </div>
                <ToolbarSep />
                <div className="ml-auto flex shrink-0 items-center gap-1">
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
        <section className="hidden min-w-0 flex-col lg:flex lg:min-h-0">
          <div className="app-bar flex shrink-0 items-stretch border-b border-border pl-6 pr-1.5">
            <SkeletonTabs tabList={panelTabs} active="overview" className="flex h-full min-w-0 items-stretch gap-4 overflow-hidden" />
          </div>
        </section>
      </SplitPane>
    </div>
  );
}

/** The loading state of either editor page, with the chrome the real page shows. Nothing in it is data. */
export function EditorSkeleton({ kind }: { kind: EditorKind }) {
  return kind === "job" ? (
    <SkeletonFrame tabs={JOB_TABS} panelTabs={PANEL_TABS} active="resume" />
  ) : (
    <SkeletonFrame tabs={MASTER_TABS} panelTabs={MASTER_PANEL_TABS} active="resume" />
  );
}
