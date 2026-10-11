import type * as Pdfjs from "pdfjs-dist";

let loading: Promise<typeof Pdfjs> | null = null;

/**
 * Loads pdf.js on first use, in the browser only, and points it at the worker the bundler serves
 * from this origin (the CSP allows workers from 'self' alone).
 */
export function loadPdfjs(): Promise<typeof Pdfjs> {
  loading ??= import("pdfjs-dist")
    .then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    })
    .catch((error: unknown) => {
      // A failed chunk load should not poison every later attempt.
      loading = null;
      throw error;
    });
  return loading;
}
