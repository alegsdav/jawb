"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/**
 * The intro plays once per page view. The Overview remounts on every tab switch, so this module flag (not the
 * component's state) is what remembers the intro already played.
 */
let introPlayed = false;

function useIntro(): boolean {
  const [play] = useState(() => !introPlayed);
  useEffect(() => {
    introPlayed = true;
  }, []);
  return play;
}

const fadeClass = (play: boolean) => (play ? "ai-fade" : "");
const fadeStyle = (play: boolean, ms: number): CSSProperties | undefined => (play ? { animationDelay: `${ms}ms` } : undefined);

export type MasterOverviewProps = {
  /** The first-draft and next-step notices, shown above the bullet area. */
  notices: ReactNode;
  /** On phones the selected bullet's comment card is a sheet over the document; then its slot must stay fixed. */
  commentSheet: boolean;
  /** Receives the element the selected bullet's comment card is portalled into. */
  onCommentSlot: (el: HTMLDivElement | null) => void;
  /** The coach panel for the selected entry or bullet. */
  coach: ReactNode;
};

/**
 * The master resume's Overview: what the page is for, the notices, then the bullet area (blank until a bullet is
 * selected). Plain text on a white page, like the job's Overview.
 */
export function MasterOverview({ notices, commentSheet, onCommentSlot, coach }: MasterOverviewProps) {
  const play = useIntro();
  return (
    <div>
      <div className={fadeClass(play)} style={fadeStyle(play, 0)}>
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Master resume</h1>
      </div>
      <p className={`mt-2 text-[15px] text-muted ${fadeClass(play)}`} style={fadeStyle(play, 60)}>
        Every job you add gets its own tailored copy of this resume. Click any bullet to improve it.
      </p>

      {notices && <div className="mt-10 space-y-6">{notices}</div>}

      {/* The bullet area. Phones: the comment card is a sheet over the document while the Resume tab shows (fixed),
          otherwise it sits here like everything else. */}
      {/* Working in here (the card, questions, coach) keeps the bullet selected, so the card doesn't close and shift the panel mid-click. */}
      <div data-doc-keep-selection className="mt-12 space-y-10">
        <div
          ref={onCommentSlot}
          className={`empty:hidden ${
            commentSheet
              ? "max-lg:visible max-lg:fixed max-lg:inset-x-2 max-lg:bottom-[calc(4.25rem+env(safe-area-inset-bottom))] max-lg:z-30 max-lg:max-h-[45dvh] max-lg:overflow-y-auto max-lg:rounded-lg max-lg:shadow-lg"
              : ""
          }`}
        />
        {coach}
      </div>
    </div>
  );
}
