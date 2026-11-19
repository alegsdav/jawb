import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

/** A one-page resume reads in well under a second; past this the import goes to the server instead. */
const BROWSER_TIMEOUT_MS = 15_000;

let worker: Worker | null = null;
let failure: Promise<never> | null = null;

/**
 * Runs a pdf.js job in the browser with its module worker (set up once, on first use). The job races the worker's
 * error event, so a worker that fails to load rejects instead of hanging, and a timeout, so one that loads but never
 * answers does too (the caller then falls back to the server). On the server (no window) it just runs:
 * pdf.js then uses its own fake worker.
 */
export function withPdfWorker<T>(run: () => Promise<T>): Promise<T> {
  if (typeof window === "undefined") return run();
  if (!worker) {
    // A file path (not a package specifier, which webpack refuses for an ESM package) so the worker is bundled.
    const workerUrl = new URL("../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url);
    const w = new Worker(workerUrl, { type: "module" });
    worker = w;
    failure = new Promise<never>((_, reject) =>
      w.addEventListener("error", () => reject(new Error("The PDF reader failed to load."))),
    );
    failure.catch(() => {}); // only raced below; a later failure must not be an unhandled rejection
    pdfjs.GlobalWorkerOptions.workerPort = w;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The PDF reader didn't answer.")), BROWSER_TIMEOUT_MS);
  });
  return Promise.race([run(), failure as Promise<never>, timeout]).finally(() => clearTimeout(timer));
}
