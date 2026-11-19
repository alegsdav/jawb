"use client";

import { useState } from "react";
import { postApi } from "@/lib/api";
import type { Resume } from "@/lib/types";

const REBUILD_CONFIRM =
  "Rebuild your resume in the app's clean template? Your text is kept; the layout and fonts change. Uses 1 AI analysis.";

/**
 * "Check it looks like your original" banner after a PDF or Word import, above the document. The import keeps the
 * file's layout, which can come out wrong; this gives the way out: keep it, rebuild the text in the clean template
 * (one AI analysis), or undo the import. Nothing changes until a button is tapped.
 */
export function ImportReview({
  fileName, rebuilt, resumeText, onRebuilt, onUndo, onDismiss,
}: {
  fileName: string;
  /** True once the text has been rebuilt; the banner then says so. */
  rebuilt: boolean;
  /** The resume's plain text, read when the user asks to rebuild (so edits made since the import are kept). */
  resumeText: () => string;
  onRebuilt: (r: Resume) => void;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function rebuild() {
    if (!window.confirm(REBUILD_CONFIRM)) return;
    const text = resumeText();
    if (!text) {
      setError("There is no text to rebuild.");
      return;
    }
    setBusy(true);
    setError("");
    const { data, error: apiError } = await postApi<{ resume: Resume }>("/api/parse-resume", { text });
    setBusy(false);
    if (apiError || !data) {
      setError(apiError ?? "Couldn't rebuild the resume. Try again.");
      return;
    }
    onRebuilt(data.resume);
  }

  return (
    <section aria-labelledby="import-review-heading" className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
      <h2 id="import-review-heading" className="font-medium">
        {rebuilt ? "Rebuilt in the clean template." : `Imported from ${fileName}.`}{" "}
        <span className="font-normal text-muted">
          {rebuilt ? "Check it reads right. Undo puts back your original import." : "Check it looks like your original."}
        </span>
      </h2>
      {busy && <p role="status" className="text-xs text-muted">Rebuilding… this takes a few seconds.</p>}
      {error && <p role="alert" className="text-xs text-bad">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm btn-primary min-h-10 sm:min-h-0" disabled={busy} onClick={onDismiss}>
          Looks good
        </button>
        {!rebuilt && (
          <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" disabled={busy} onClick={() => void rebuild()}>
            {busy ? "Rebuilding…" : "Rebuild in a clean template"}
          </button>
        )}
        <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" disabled={busy} onClick={onUndo}>
          Undo import
        </button>
      </div>
    </section>
  );
}
