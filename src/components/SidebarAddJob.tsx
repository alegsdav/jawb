"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addedOn, type ExistingJob } from "@/lib/addJob";
import { useAddJob } from "@/lib/useAddJob";
import { ICON, ROW, ROW_IDLE } from "./sidebarRows";
import { PlusIcon } from "./icons";

/** The field grows to this many lines (20px each) and scrolls past it. */
const MAX_FIELD_PX = 8 * 20;

/**
 * "Add job" in the sidebar: the nav row itself becomes the paste box. At rest it is the plain row; a click turns
 * that row, in place, into an editable field with the same icon and text column (`useAddJob` does the adding).
 * Paste a link or a description; Enter adds it, Shift+Enter starts a new line, Escape or leaving an empty field
 * puts the plain row back.
 */
export function SidebarAddJob() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  // The job list for the duplicate check, read again each time the box opens (the server checks too).
  const [existing, setExisting] = useState<ExistingJob[]>([]);
  const panelId = useId();
  const rowRef = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const sizer = useRef<HTMLDivElement>(null);
  // Set when the field closes from the keyboard, so focus goes back to the row once it is shown again.
  const returnFocus = useRef(false);

  const add = useAddJob({
    existing,
    // Added: the job page opens (the router), the box empties and closes, and the lists are told to reload.
    onAdded: () => {
      add.clear();
      setOpen(false);
      window.dispatchEvent(new CustomEvent("jawb:jobs-changed"));
    },
  });

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, url, company, title, created_at")
        .order("created_at", { ascending: false });
      if (alive && !error && data) setExisting(data as unknown as ExistingJob[]);
    })();
    return () => {
      alive = false;
    };
  }, [open, supabase]);

  // Autofocus when the row turns into the field; back on the row when the field closes from the keyboard.
  useEffect(() => {
    if (open) {
      box.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      rowRef.current?.focus();
    }
  }, [open]);

  const value = add.mode === "paste" ? add.desc : add.input;
  const paste = add.mode === "paste";
  const placeholder = paste ? "Paste the description" : "Paste link or JD";

  // Height follows the text. A hidden sizer with the same text and wrapping gives the height without touching the
  // field, so the column's height can be animated from its last value to the new one.
  useLayoutEffect(() => {
    if (!open) return;
    const col = column.current;
    const s = sizer.current;
    if (!col || !s) return;
    col.style.height = `${Math.min(s.offsetHeight, MAX_FIELD_PX)}px`;
  }, [value, paste, open]);

  function collapse() {
    returnFocus.current = true;
    setOpen(false);
  }

  function openDup(id: string) {
    add.clear();
    setOpen(false);
    router.push(`/jobs/${id}`);
  }

  const dup = add.dup;
  const notice = add.error || add.closedMsg;
  const pasteWhy = add.reason?.failed ?? (add.reason?.site ? `${add.reason.site} needs a login. Paste the job description below. The link is kept.` : "Paste the job description below. The link is kept.");

  return (
    <div>
      <div id={panelId} aria-busy={add.busy ? true : undefined}>
        <button
          ref={rowRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          // Hidden while the field shows: the field is the row now. Kept mounted so focus can return to it.
          style={{ display: open ? "none" : undefined }}
          // Keeps focus on the row when it is pressed, so the row doesn't take focus from a field it is about to show.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(true)}
          className={`${ROW} ${ROW_IDLE} w-full cursor-pointer`}
        >
          <PlusIcon className={ICON} />
          <span>Add job</span>
        </button>

        {open && (
          <div className="w-full space-y-1.5">
            {/* The row, turned editable: same padding, icon and background; the text column starts where the label did. */}
            <div className="flex w-full items-start gap-2.5 rounded-lg bg-fg/[0.04] px-2 py-1.5 focus-within:bg-fg/[0.06]">
              <PlusIcon className={`${ICON} mt-[1.5px]`} />
              <div ref={column} className="relative min-w-0 flex-1 overflow-hidden transition-[height] duration-150 ease-out motion-reduce:transition-none">
                {/* Invisible copy of the text, for the height only. */}
                <div
                  ref={sizer}
                  aria-hidden="true"
                  className="pointer-events-none invisible absolute inset-x-0 top-0 whitespace-pre-wrap text-[14px] leading-5 [overflow-wrap:break-word]"
                >
                  {`${value || placeholder}​`}
                </div>
                <textarea
                  ref={box}
                  rows={1}
                  aria-label="Job link or description"
                  placeholder={placeholder}
                  value={value}
                  disabled={add.busy}
                  onChange={(e) => {
                    if (paste) add.setDesc(e.target.value);
                    else add.setInput(e.target.value);
                    add.setDup(null);
                    add.setError("");
                    add.setClosedMsg(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      add.submit();
                    } else if (e.key === "Escape") {
                      // Prevented so the peek stays open: Escape here only closes this field.
                      e.preventDefault();
                      collapse();
                    }
                  }}
                  onBlur={() => {
                    // An empty field that loses focus goes back to the row (a paste step or a notice stays open).
                    if (!paste && !add.input.trim() && !add.busy && !add.dup) setOpen(false);
                  }}
                  className="sidebar-add-box absolute inset-0 block h-full w-full resize-none overflow-y-auto bg-transparent p-0 text-[14px] leading-5 text-fg outline-none placeholder:text-muted disabled:opacity-60 [overflow-wrap:break-word]"
                />
              </div>
            </div>

            {paste && <p role={add.reason?.failed ? "alert" : undefined} className={`px-2 text-[12px] leading-4 ${add.reason?.failed ? "text-bad" : "text-muted"}`}>{pasteWhy}</p>}

            {dup ? (
              <div role="alert" className="space-y-2 rounded-lg border border-ok/50 bg-ok-bg p-2.5">
                <p className="text-[12px] leading-4">
                  You already added this job{addedOn(dup.created_at) ? ` (added ${addedOn(dup.created_at)})` : ""}. Open it instead?
                </p>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-primary h-7 flex-1 px-2 text-[12px]" onClick={() => openDup(dup.id)}>
                    Open it
                  </button>
                  <button
                    type="button"
                    className="btn h-7 flex-1 px-2 text-[12px]"
                    disabled={add.busy}
                    onClick={() => add.send(dup.body, dup.fromUrl, true)}
                  >
                    Add anyway
                  </button>
                </div>
              </div>
            ) : add.busy ? (
              <p className="px-2 text-[12px] leading-4 text-muted">Adding…</p>
            ) : notice ? (
              <p role="alert" className="px-2 text-[12px] leading-4 text-bad">{notice}</p>
            ) : (
              add.hint && <p className="px-2 text-[12px] leading-4 text-muted">{add.hint}</p>
            )}

            {paste && (
              <button
                type="button"
                className="px-2 text-[12px] leading-4 text-muted hover:text-fg disabled:opacity-50"
                onClick={add.reset}
                disabled={add.busy}
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
