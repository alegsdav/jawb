"use client";

import { createContext, useContext } from "react";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";

type SidebarState = { collapsed: boolean; setCollapsed: (next: boolean) => void };
const SidebarContext = createContext<SidebarState>({ collapsed: false, setCollapsed: () => {} });

/** The desktop sidebar's collapsed state and how to change it. Outside an AppShell it reads as open. */
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
