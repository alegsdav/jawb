"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLinks } from "./NavLinks";
import { Sidebar } from "./Sidebar";
import { SidebarIcon, Wordmark } from "./icons";
import { SidebarProvider, saveCollapsed } from "./sidebarState";
import { AccountProvider } from "./account";
import type { Account } from "@/lib/account";

/** How long the peek takes to fade (ms); expanding waits for it before the rail appears. */
const PEEK_FADE = 160;
/** Hovering the expand button this long opens the peek (a pointer just passing by doesn't). */
const PEEK_OPEN_DELAY = 60;
/** Leaving the button and the peek this long closes it (time to cross the gap between them). */
const PEEK_CLOSE_DELAY = 220;

/**
 * The (app) shell. Desktop (lg and up): the sidebar rail on the grey window chrome beside the white canvas, or,
 * collapsed, a white page filling the whole window with an expand button in its top-left corner. Hovering that
 * button opens the "peek": the same sidebar in a floating glass panel over the page, whose own toggle (white) sits
 * where the button is; clicking it fades the peek away and brings the rail back. The sidebar stays mounted
 * throughout (one instance, restyled), so its visit and pin state keeps recording and nothing reloads.
 * Below lg: a slim header and the bottom tab bar, no sidebar.
 */
export function AppShell({
  initialCollapsed, account, children,
}: { initialCollapsed: boolean; account: Account | null; children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(initialCollapsed);
  const [peek, setPeek] = useState(false);
  // The rail fades in once, right after the peek expanded it.
  const [railEnter, setRailEnter] = useState(false);
  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    setPeek(false);
    saveCollapsed(next);
  }, []);
  const value = useMemo(() => ({ collapsed, setCollapsed }), [collapsed, setCollapsed]);

  const asideRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The pointer is over the expand button or the peek.
  const hovering = useRef(false);
  // The peek's toggle was clicked: the peek is fading out and the rail comes next, so hovering can't reopen it.
  const expanding = useRef(false);
  const path = usePathname();

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  /** Something in the peek is in use: one of its menus is open, or the search or a rename has focus. */
  const peekBusy = () => {
    const aside = asideRef.current;
    if (!aside) return false;
    if (aside.querySelector('[aria-haspopup="menu"][aria-expanded="true"]')) return true;
    const active = document.activeElement;
    return !!active && active.tagName === "INPUT" && aside.contains(active);
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

  const enter = (e: React.PointerEvent, delay: number) => {
    if (e.pointerType !== "mouse" || expanding.current) return;
    hovering.current = true;
    clearTimer();
    if (!peek && delay) timer.current = setTimeout(() => setPeek(true), delay);
  };
  const leave = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || expanding.current) return;
    hovering.current = false;
    scheduleClose();
  };

  /** The peek's toggle: fade the peek out, then show the rail. */
  const expandFromPeek = () => {
    clearTimer();
    expanding.current = true;
    setPeek(false);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    timer.current = setTimeout(
      () => {
        timer.current = null;
        expanding.current = false;
        hovering.current = false;
        setRailEnter(!reduce);
        setCollapsed(false);
      },
      reduce ? 0 : PEEK_FADE,
    );
  };

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
        <div className="min-h-dvh lg:flex lg:h-dvh lg:overflow-hidden">
          {/* One element in both states, so the Sidebar inside never remounts: the rail (in flow), or collapsed, the
              peek (fixed, faded out and inert until hovered). Below lg it is hidden either way. */}
          <aside
            ref={asideRef}
            data-peek={collapsed ? (peek ? "open" : "closed") : undefined}
            inert={collapsed && !peek}
            onPointerEnter={collapsed ? (e) => enter(e, 0) : undefined}
            onPointerLeave={collapsed ? leave : undefined}
            onAnimationEnd={() => setRailEnter(false)}
            className={
              collapsed
                ? "sidebar-peek float-dark hidden lg:fixed lg:bottom-2 lg:left-2 lg:top-2 lg:z-30 lg:block lg:w-[248px] lg:rounded-2xl"
                : `hidden lg:block lg:shrink-0 lg:sticky lg:top-0 lg:h-dvh ${railEnter ? "sidebar-rail-enter" : ""}`
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
                stays put while the page scrolls. */}
            <div className="app-canvas relative flex min-w-0 flex-1 flex-col">
              <main
                data-collapsed={collapsed ? "" : undefined}
                className={`app-main min-w-0 flex-1 bg-surface lg:overflow-y-auto lg:flex-none ${
                  collapsed
                    ? "lg:h-dvh"
                    : "lg:my-2 lg:mr-2 lg:h-[calc(100dvh-1rem)] lg:rounded-xl lg:border lg:border-border lg:shadow-[0_1px_3px_rgb(0_0_0/0.04)]"
                }`}
              >
                {children}
              </main>
              {collapsed && (
                <button
                  type="button"
                  onClick={() => setCollapsed(false)}
                  onPointerEnter={(e) => enter(e, PEEK_OPEN_DELAY)}
                  onPointerLeave={leave}
                  aria-label="Expand sidebar"
                  aria-expanded={false}
                  className="expand-btn absolute left-5 top-5 z-20 hidden h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-fg/[0.05] hover:text-fg lg:flex"
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
