"use client";

import { createContext, useContext } from "react";
import { SIDEBAR_COOKIE, SIDEBAR_WIDTH_COOKIE, SIDEBAR_WIDTH_DEFAULT } from "@/lib/sidebar";

type SidebarState = {
  collapsed: boolean;
  setCollapsed: (next: boolean) => void;
  /** The rail's width in px (the --sidebar-w the rail and the peek use). */
  width: number;
  setWidth: (px: number) => void;
};
const SidebarContext = createContext<SidebarState>({
  collapsed: false,
  setCollapsed: () => {},
  width: SIDEBAR_WIDTH_DEFAULT,
  setWidth: () => {},
});

/** The desktop sidebar's collapsed state and width, and how to change them. Outside an AppShell it reads as open. */
export const useSidebar = () => useContext(SidebarContext);
export const SidebarProvider = SidebarContext.Provider;

/**
 * Save the choice in a cookie (a year), so the server renders the shell right from the first paint: no flash of
 * the sidebar on reload. Blocked cookies just mean it lasts this page view.
 */
export function saveCollapsed(collapsed: boolean) {
  try {
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* blocked cookies */
  }
}

/** Save the rail's width in px in a cookie (a year), read by the (app) layout on the server. Blocked cookies: this page view only. */
export function saveSidebarWidth(px: number) {
  try {
    document.cookie = `${SIDEBAR_WIDTH_COOKIE}=${px}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* blocked cookies */
  }
}
