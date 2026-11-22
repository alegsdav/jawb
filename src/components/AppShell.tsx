"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { NavLinks } from "./NavLinks";
import { Sidebar } from "./Sidebar";
import { Logo, SidebarIcon } from "./icons";
import { SidebarProvider, saveCollapsed } from "./sidebarState";

/**
 * The (app) shell. Desktop (lg and up): the sidebar on the grey window chrome, or, collapsed, hidden and the white
 * canvas takes the whole window. The sidebar stays mounted either way, so its visit and pin state keeps recording
 * and expanding doesn't reload the job list. Below lg: a slim header and the bottom tab bar, no sidebar.
 */
export function AppShell({ initialCollapsed, children }: { initialCollapsed: boolean; children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(initialCollapsed);
  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    saveCollapsed(next);
  }, []);
  const value = useMemo(() => ({ collapsed, setCollapsed }), [collapsed, setCollapsed]);

  return (
    <SidebarProvider value={value}>
      <div className="min-h-dvh lg:flex lg:h-dvh lg:overflow-hidden">
        {/* display:none when collapsed (every width), so nothing in it is focusable or takes space. */}
        <aside
          className={
            collapsed ? "hidden" : "hidden lg:block lg:shrink-0 lg:sticky lg:top-0 lg:h-dvh"
          }
        >
          <Sidebar />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col pb-16 lg:pb-0">
          <header className="lg:hidden border-b border-border bg-surface sticky top-0 z-20">
            <div className="mx-auto max-w-7xl px-4 h-12 sm:h-14 flex items-center gap-6">
              <Link href="/" className="flex items-center gap-2 font-semibold"><Logo size={22} />Jawb</Link>
            </div>
          </header>
          {/* The wrapper holds the button that opens a collapsed sidebar: it sits beside <main>, not in it, so it stays
              put while the page scrolls. */}
          <div className="relative flex min-w-0 flex-1 flex-col">
            <main
              className={`min-w-0 flex-1 bg-surface lg:h-[calc(100dvh-1rem)] lg:overflow-y-auto lg:flex-none lg:rounded-xl lg:border lg:border-border lg:shadow-[0_1px_3px_rgb(0_0_0/0.04)] ${
                collapsed ? "lg:m-2" : "lg:my-2 lg:mr-2"
              }`}
            >
              {children}
            </main>
            {collapsed && (
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                aria-label="Expand sidebar"
                aria-expanded={false}
                className="absolute left-4 top-4 z-20 hidden h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-fg/[0.04] hover:text-fg lg:flex"
              >
                <SidebarIcon className="h-[15px] w-[15px] shrink-0" />
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
  );
}
