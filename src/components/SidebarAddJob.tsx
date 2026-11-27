"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addedOn, type ExistingJob } from "@/lib/addJob";
import { useAddJob } from "@/lib/useAddJob";
import { ICON, ROW, ROW_IDLE } from "./Sidebar";
import { PlusIcon } from "./icons";

/**
 * "Add job" in the sidebar: the nav row opens a box right under it, in the same flow as the dashboard's Jobs box
 * (`useAddJob`). Paste a link or a description; Enter adds it. Escape or a click on the row closes the box.
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

  // Autofocus when it opens (the box is inert while closed, so this runs once it can take focus).
  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);

  // Grows with the text: two lines up to about eight, then it scrolls.
  const value = add.mode === "paste" ? add.desc : add.input;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, add.mode]);

  function collapse() {
    setOpen(false);
    rowRef.current?.focus();
  }

  function toggle() {
    if (open) collapse();
    else setOpen(true);
  }

  function openDup(id: string) {
    add.clear();
    setOpen(false);
    router.push(`/jobs/${id}`);
  }

  const dup = add.dup;
  const notice = add.error || add.closedMsg;
  const paste = add.mode === "paste";
  const pasteWhy = add.reason?.failed ?? (add.reason?.site ? `${add.reason.site} needs a login. Paste the job description below. The link is kept.` : "Paste the job description below. The link is kept.");

  return (
    <div>
      <button
        ref={rowRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        // Keeps focus in the box when the row is pressed, so the box's blur doesn't close it a moment before the click.
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        className={`${ROW} ${ROW_IDLE} w-full cursor-pointer`}
      >
        <PlusIcon className={ICON} />
        <span>Add job</span>
      </button>

      <div
        id={panelId}
        inert={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-[180ms] [transition-timing-function:ease] motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div aria-busy={add.busy ? true : undefined} className="space-y-1.5 pb-1 pt-1.5">
            {paste && (
              <p role={add.reason?.failed ? "alert" : undefined} className={`text-[12px] leading-4 ${add.reason?.failed ? "text-bad" : "text-muted"}`}>
                {pasteWhy}
              </p>
            )}
            <textarea
              ref={box}
              rows={2}
              aria-label="Job link or description"
              placeholder={paste ? "Paste the job description" : "Paste a job link or description"}
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
                  // Prevented so the peek stays open: Escape here only closes this box.
                  e.preventDefault();
                  collapse();
                }
              }}
              onBlur={() => {
                // An empty box that loses focus closes (a paste step or a notice stays open).
                if (!paste && !add.input.trim() && !add.busy && !add.dup) setOpen(false);
              }}
              className="block max-h-44 w-full resize-none overflow-y-auto rounded-lg bg-fg/[0.04] px-2.5 py-2 text-[14px] leading-5 text-fg outline-none placeholder:text-muted focus:bg-fg/[0.06] disabled:opacity-60 motion-reduce:transition-none"
            />

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
              <p className="text-[12px] leading-4 text-muted">Adding…</p>
            ) : notice ? (
              <p role="alert" className="text-[12px] leading-4 text-bad">{notice}</p>
            ) : (
              add.hint && <p className="text-[12px] leading-4 text-muted">{add.hint}</p>
            )}

            {paste && (
              <button
                type="button"
                className="text-[12px] leading-4 text-muted hover:text-fg disabled:opacity-50"
                onClick={add.reset}
                disabled={add.busy}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
