"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLinks } from "./NavLinks";
import { Sidebar } from "./Sidebar";
import { SidebarIcon, Wordmark } from "./icons";
import { SidebarProvider, saveCollapsed, saveSidebarWidth } from "./sidebarState";
import { AccountProvider } from "./account";
import type { Account } from "@/lib/account";
import { clampSidebarWidth } from "@/lib/sidebar";

/** Hovering the expand button this long opens the peek (a pointer just passing by doesn't). */
const PEEK_OPEN_DELAY = 60;
/** Leaving the button and the peek this long closes it (time to cross the gap between them). */
const PEEK_CLOSE_DELAY = 220;

/**
 * The (app) shell. Desktop (lg and up): the sidebar rail on the grey window chrome beside the white canvas, or,
 * collapsed, the same canvas extended to the window's left edge (same margins, so its top bar keeps its row), with an
 * expand button in its top-left corner, in the sidebar icons' column. Hovering that
 * button opens the "peek": the same menu as a full-height dark panel over the page, with the rail's menu at the same
 * window coordinates (the peek has no Wordmark). Its toggle sits where the button is, and clicking it brings the rail
 * back at once. The sidebar stays mounted throughout (one instance), so its visit and pin state keeps recording and
 * nothing reloads. Below lg: a slim header and the bottom tab bar, no sidebar.
 */
export function AppShell({
  initialCollapsed, initialWidth, account, children,
}: { initialCollapsed: boolean; initialWidth: number; account: Account | null; children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(initialCollapsed);
  // The rail's width (--sidebar-w, from the cookie on the server). Dragging changes it only through the CSS variable
  // until the drag ends; this is the committed value.
  const [width, setWidthState] = useState(initialWidth);
  const setWidth = useCallback((px: number) => {
    const next = clampSidebarWidth(px);
    setWidthState(next);
    saveSidebarWidth(next);
  }, []);
  const [peek, setPeek] = useState(false);
  // Whether the peek has opened since the last collapse. Until it has, the hidden peek is applied at once: no fade
  // from the rail's full opacity, which would flash.
  const [armed, setArmed] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The pointer is over the expand button or the peek.
  const hovering = useRef(false);
  // Set by collapsing: the pointer may already rest on the button that just appeared, so the peek waits until the
  // pointer has left the button and come back. Cleared when it leaves the button (or moves off it).
  const suppressUntilLeave = useRef(false);
  const path = usePathname();

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    setPeek(false);
    setArmed(false);
    suppressUntilLeave.current = next;
    saveCollapsed(next);
  }, []);
  const value = useMemo(
    () => ({ collapsed, setCollapsed, width, setWidth }),
    [collapsed, setCollapsed, width, setWidth],
  );

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  /** Something in the peek is in use: one of its menus is open, the search, a rename or the add-job box has focus,
   *  or the add-job box is submitting. */
  const peekBusy = () => {
    const aside = asideRef.current;
    if (!aside) return false;
    if (aside.querySelector('[aria-haspopup="menu"][aria-expanded="true"]')) return true;
    if (aside.querySelector('[aria-busy="true"]')) return true;
    const active = document.activeElement;
    return !!active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA") && aside.contains(active);
  };

  /** Close once the pointer has been away a moment, unless the peek is in use (then look again shortly). */
  const scheduleClose = (delay = PEEK_CLOSE_DELAY) => {
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      if (hovering.current) return;
      if (peekBusy()) return scheduleClose(300);
      setPeek(false);
    }, delay);
  };

  const openPeek = () => {
    setArmed(true);
    setPeek(true);
  };

  const enter = (e: React.PointerEvent, delay: number) => {
    if (e.pointerType !== "mouse") return;
    hovering.current = true;
    clearTimer();
    if (peek || suppressUntilLeave.current || !delay) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      openPeek();
    }, delay);
  };
  const leave = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    hovering.current = false;
    // Not the suppression: collapsing moves the aside's hidden peek out from under the pointer, which fires this
    // leave too. The suppression ends only when the pointer is seen outside the expand button (see the effect below).
    scheduleClose();
  };

  /** The peek's toggle: the layouts are identical, so the rail simply takes the peek's place, with no fade. */
  const expandFromPeek = () => {
    clearTimer();
    hovering.current = false;
    setCollapsed(false);
  };

  // After a collapse the pointer may still rest on the expand button: once it moves off the button, the peek may open.
  useEffect(() => {
    if (!collapsed) return;
    const onMove = (e: PointerEvent) => {
      if (!suppressUntilLeave.current) return;
      const r = expandRef.current?.getBoundingClientRect();
      if (!r || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        suppressUntilLeave.current = false;
      }
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [collapsed]);

  // While open: Escape or a press anywhere outside it (and outside its menus, which sit in document.body) closes it.
  useEffect(() => {
    if (!peek) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || asideRef.current?.contains(t) || t.closest?.('[role="menu"]')) return;
      setPeek(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setPeek(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [peek]);

  // Picking a page in the peek closes it.
  useEffect(() => {
    setPeek(false);
  }, [path]);

  useEffect(() => clearTimer, []);

  return (
    <AccountProvider value={account}>
      <SidebarProvider value={value}>
        <div
          className="min-h-dvh lg:flex lg:h-dvh lg:overflow-hidden"
          style={{ "--sidebar-w": `${width}px` } as React.CSSProperties}
        >
          {/* One element in both states, so the Sidebar inside never remounts: the rail (in flow), or collapsed, the
              peek (fixed, faded out and inert until hovered). Below lg it is hidden either way. */}
          <aside
            ref={asideRef}
            data-peek={collapsed ? (peek ? "open" : "closed") : undefined}
            data-instant={collapsed && !armed ? "" : undefined}
            inert={collapsed && !peek}
            onPointerEnter={collapsed ? (e) => enter(e, 0) : undefined}
            onPointerLeave={collapsed ? leave : undefined}
            className={
              collapsed
                ? "sidebar-peek hidden lg:fixed lg:bottom-0 lg:left-0 lg:top-0 lg:z-30 lg:block lg:w-[var(--sidebar-w)]"
                : "hidden lg:block lg:shrink-0 lg:sticky lg:top-0 lg:h-dvh"
            }
          >
            <Sidebar peek={collapsed} onExpand={expandFromPeek} />
          </aside>
          <div className="flex min-w-0 flex-1 flex-col pb-16 lg:pb-0">
            <header className="lg:hidden border-b border-border bg-surface sticky top-0 z-20">
              <div className="mx-auto max-w-7xl px-4 h-12 sm:h-14 flex items-center gap-6">
                <Link href="/" className="flex items-center">
                  <Wordmark />
                </Link>
              </div>
            </header>
            {/* The wrapper holds the button that opens a collapsed sidebar: it sits beside <main>, not in it, so it
                stays put while the page scrolls. <main> is the same white canvas in both states, inset by --chrome-gap
                on every side it isn't flush against; collapsed, only its left edge moves out to the window's. */}
            <div className="app-canvas relative flex min-w-0 flex-1 flex-col">
              <main
                data-collapsed={collapsed ? "" : undefined}
                className={`app-main min-w-0 flex-1 bg-surface lg:overflow-y-auto lg:flex-none lg:my-[var(--chrome-gap)] lg:mr-[var(--chrome-gap)] lg:h-[calc(100dvh-2*var(--chrome-gap))] lg:rounded-xl lg:border lg:border-border lg:shadow-[0_1px_3px_rgb(0_0_0/0.04)] ${
                  collapsed ? "lg:ml-[var(--chrome-gap)]" : ""
                }`}
              >
                {children}
              </main>
              {collapsed && (
                <button
                  ref={expandRef}
                  type="button"
                  onClick={() => setCollapsed(false)}
                  onPointerEnter={(e) => enter(e, PEEK_OPEN_DELAY)}
                  onPointerLeave={leave}
                  aria-label="Expand sidebar"
                  aria-expanded={false}
                  className="expand-btn absolute z-20 hidden h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-fg/[0.06] hover:text-fg lg:flex"
                >
                  <SidebarIcon className="h-[18px] w-[18px] shrink-0" />
                </button>
              )}
            </div>
            {/* Bottom tab bar below lg */}
            <div className="lg:hidden fixed bottom-0 inset-x-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]">
              <NavLinks mobile />
            </div>
          </div>
        </div>
      </SidebarProvider>
    </AccountProvider>
  );
}
