"use client";

import { usePathname } from "next/navigation";
import { EditorSkeleton } from "@/components/EditorSkeleton";

/**
 * Shown between page switches in the app shell. Before a route's own loading.tsx has been fetched (a first visit to
 * an editor), this is what shows, so it picks the editor's skeleton by the path. Other pages stay blank until loaded.
 */
export default function Loading() {
  const pathname = usePathname();
  if (/^\/jobs\/[^/]+/.test(pathname)) return <EditorSkeleton kind="job" />;
  if (pathname === "/resume" || pathname.startsWith("/resume/")) return <EditorSkeleton kind="master" />;
  return null;
}
