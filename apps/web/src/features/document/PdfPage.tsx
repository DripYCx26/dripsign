"use client";

import type { SigningField } from "@dripsign/core/schema";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { FieldMarkers, type FieldMarkerPerson } from "./FieldMarkers.tsx";
import styles from "./PdfPage.module.css";

// Pages within this distance of the viewport are drawn; pages farther away give their canvas back.
const NEAR_VIEWPORT = "200% 0px";
// Beyond twice the device pixel ratio a canvas costs memory and adds no visible sharpness.
const MAX_PIXEL_RATIO = 2;

type PdfPageProps = Readonly<{
  doc: PDFDocumentProxy;
  pageNumber: number;
  total: number;
  firstPageRatio: number;
  fields: readonly SigningField[];
  people: readonly FieldMarkerPerson[];
  viewerRecipientId: string | null;
}>;

function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

/** One page: a placeholder at the page's shape until it nears the viewport, then a canvas. */
export function PdfPage({
  doc,
  pageNumber,
  total,
  firstPageRatio,
  fields,
  people,
  viewerRecipientId,
}: PdfPageProps) {
  const slot = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [ratio, setRatio] = useState(firstPageRatio);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = slot.current;
    if (element === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setNear(entries.at(-1)?.isIntersecting ?? false);
      },
      { rootMargin: NEAR_VIEWPORT },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const target = canvas.current;
    const holder = slot.current;
    if (!near || target === null || holder === null) return;
    const abort = new AbortController();
    let task: RenderTask | null = null;
    void (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        const cssWidth = holder.clientWidth;
        // A hidden pane has no width; the observer fires again when it shows.
        if (abort.signal.aborted || cssWidth === 0) return;
        const base = page.getViewport({ scale: 1 });
        const pixels = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
        const viewport = page.getViewport({ scale: (cssWidth / base.width) * pixels });
        target.width = Math.floor(viewport.width);
        target.height = Math.floor(viewport.height);
        setRatio(base.width / base.height);
        task = page.render({ canvas: target, viewport });
        await task.promise;
        setFailed(false);
      } catch (error: unknown) {
        if (!abort.signal.aborted && !isCancelled(error)) setFailed(true);
      }
    })();
    return () => {
      abort.abort();
      task?.cancel();
      target.width = 0;
      target.height = 0;
    };
  }, [near, doc, pageNumber]);

  return (
    <div ref={slot} className={styles.slot} style={{ aspectRatio: ratio }}>
      <canvas
        ref={canvas}
        className={styles.canvas}
        role="img"
        aria-label={`Page ${String(pageNumber)} of ${String(total)}`}
      />
      <FieldMarkers fields={fields} people={people} viewerRecipientId={viewerRecipientId} />
      {failed && (
        <p className={styles.failed} role="alert">
          This page couldn’t be drawn.
        </p>
      )}
    </div>
  );
}
