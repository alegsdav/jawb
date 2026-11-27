/** One row of the sidebar: 32px tall, 14px text, muted until it is the current page. Shared by Sidebar and SidebarAddJob. */
// leading-5, not leading-none: a 13px line box would cut off descenders (g, y, p) where a title truncates (overflow hidden).
export const ROW_BASE = "flex h-8 w-full items-center gap-2.5 rounded-lg text-[14px] leading-5 whitespace-nowrap";
export const ROW = `${ROW_BASE} px-2`;
/** A job row keeps room on the right for its ⋯ button, so long titles truncate before it. */
export const JOB_ROW = `${ROW_BASE} pl-2 pr-8`;
export const ROW_IDLE = "text-muted hover:bg-fg/[0.04] hover:text-fg";
export const ROW_ACTIVE = "bg-fg/[0.05] font-medium text-fg";
export const ICON = "h-[17px] w-[17px] shrink-0";
