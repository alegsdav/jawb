"use client";

import { useEffect, useId, useRef, useState } from "react";
import { type PageSetup } from "@/lib/doc/types";
import {
  MARGIN_RANGE_IN,
  MARGIN_SIDES,
  MARGIN_STEP_IN,
  PAGE_PRESETS,
  inputsFromPage,
  pageFromInputs,
  type MarginSide,
} from "@/lib/pageSetup";

const SIDE_LABELS: Record<MarginSide, string> = {
  marginTop: "Top",
  marginBottom: "Bottom",
  marginLeft: "Left",
  marginRight: "Right",
};

/**
 * Page setup: the four margins of the resume page, in inches. Apply hands the new page to the caller, which
 * stores it like any other edit (it autosaves). Escape, Cancel and a click outside close it without changes.
 */
export function PageSetupDialog({
  page, onApply, onClose,
}: {
  /** The page as it is now (the imported or default margins). */
  page: PageSetup;
  onApply: (page: PageSetup) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState(() => inputsFromPage(page));
  const [invalid, setInvalid] = useState(false);
  const titleId = useId();
  const firstInput = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    firstInput.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = pageFromInputs(values);
    if (!next) return setInvalid(true);
    onApply(next);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={submit}
        noValidate
        className="w-full max-w-md space-y-4 rounded-xl border border-border bg-bg p-5 shadow-xl"
      >
        <div>
          <h2 id={titleId} className="font-semibold">Page setup</h2>
          <p className="text-xs text-muted">
            Margins in inches, from {MARGIN_RANGE_IN.min} to {MARGIN_RANGE_IN.max}. Applies to the editor, the PDF and the
            page count.
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Presets</legend>
          <div className="flex flex-wrap gap-1.5">
            {PAGE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setValues(inputsFromPage(preset.page));
                  setInvalid(false);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          {MARGIN_SIDES.map((key, i) => (
            <label key={key} className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{SIDE_LABELS[key]} (in)</span>
              <input
                ref={i === 0 ? firstInput : undefined}
                type="number"
                inputMode="decimal"
                step={MARGIN_STEP_IN}
                min={MARGIN_RANGE_IN.min}
                max={MARGIN_RANGE_IN.max}
                className="input w-full"
                value={values[key]}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [key]: e.target.value }));
                  setInvalid(false);
                }}
              />
            </label>
          ))}
        </div>

        <p className="text-xs text-muted">
          Now: top {page.marginTop.toFixed(2)} in, bottom {page.marginBottom.toFixed(2)} in, left{" "}
          {page.marginLeft.toFixed(2)} in, right {page.marginRight.toFixed(2)} in.
        </p>
        {invalid && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            Enter a number for each margin.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-sm btn-primary min-h-10 sm:min-h-0">
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}
