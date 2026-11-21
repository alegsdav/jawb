"use client";

import { usePathname } from "next/navigation";
import { EditorSkeleton } from "@/components/EditorSkeleton";
import { PageLoader } from "@/components/Loader";

/**
 * Shown between page switches in the app shell. Before a route's own loading.tsx has been fetched (a first visit to
 * an editor), this is what shows, so it picks the editor's skeleton by the path rather than the generic loader.
 */
export default function Loading() {
  const pathname = usePathname();
  if (/^\/jobs\/[^/]+/.test(pathname)) return <EditorSkeleton kind="job" />;
  if (pathname === "/resume" || pathname.startsWith("/resume/")) return <EditorSkeleton kind="master" />;
  return <PageLoader />;
}
