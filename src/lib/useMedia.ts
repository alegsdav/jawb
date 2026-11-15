"use client";

import { useEffect, useState } from "react";

/** Whether a media query matches (false on the server and on the first render). */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const update = () => setMatch(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, [query]);
  return match;
}

/** Tailwind's lg breakpoint (1024px): the sidebar layout. */
export const useIsDesktop = () => useMedia("(min-width: 1024px)");
