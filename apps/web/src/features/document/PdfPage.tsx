"use client";

import type { SigningField } from "@dripsign/core/schema";
import type { PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { FieldMarkers, type FieldMarkerPerson } from "./FieldMarkers.tsx";
import { loadPdfjs } from "./loadPdfjs.ts";
import styles from "./PdfPage.module.css";

// Pages within this distance of the viewport are drawn; pages farther away give their canvas back.
const NEAR_VIEWPORT = "200% 0px";
// Beyond twice the device pixel ratio a canvas costs memory and adds no visible sharpness.
const MAX_PIXEL_RATIO = 2;

/** The first page's size at scale 1 (CSS pixels): its shape and the narrowest it is drawn. */
export type PageShape = Readonly<{ width: number; ratio: number }>;

type PdfPageProps = Readonly<{
  doc: PDFDocumentProxy;
  pageNumber: number;
  total: number;
  /** Stands in for the page until it is drawn. */
  firstPage: PageShape;
  fields: readonly SigningField[];
  people: readonly FieldMarkerPerson[];
  viewerRecipientId: string | null;
}>;

function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

/**
 * Whether the slot is near the viewport and how wide it is. A hidden pane or a resize changes the
 * width, so the page is drawn again at the size it now shows.
 */
function useSlot() {
  const slot = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = slot.current;
    if (element === null) return;
    const intersection = new IntersectionObserver(
      (entries) => {
        setNear(entries.at(-1)?.isIntersecting ?? false);
      },
      { rootMargin: NEAR_VIEWPORT },
    );
    const resize = new ResizeObserver((entries) => {
      setWidth(Math.round(entries.at(-1)?.contentRect.width ?? 0));
    });
    intersection.observe(element);
    resize.observe(element);
    return () => {
      intersection.disconnect();
      resize.disconnect();
    };
  }, []);

  return { slot, near, width };
}

/**
 * One page: a placeholder at the page's shape until it nears the viewport, then a canvas with
 * pdf.js's transparent text layer over it, so the text can be selected, searched and read aloud.
 */
export function PdfPage({
  doc,
  pageNumber,
  total,
  firstPage,
  fields,
  people,
  viewerRecipientId,
}: PdfPageProps) {
  const { slot, near, width } = useSlot();
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState(firstPage);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const target = canvas.current;
    const layer = text.current;
    // A hidden pane has no width; the resize observer fires again when it shows.
    if (!near || width === 0 || target === null || layer === null) return;
    const abort = new AbortController();
    let task: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    void (async () => {
      try {
        const [page, pdfjs] = await Promise.all([doc.getPage(pageNumber), loadPdfjs()]);
        if (abort.signal.aborted) return;
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const pixels = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
        const viewport = page.getViewport({ scale: scale * pixels });
        target.width = Math.floor(viewport.width);
        target.height = Math.floor(viewport.height);
        setShape({ width: base.width, ratio: base.width / base.height });
        task = page.render({ canvas: target, viewport });
        // The layer is laid out in CSS pixels from this factor, before it is constructed.
        layer.style.setProperty("--total-scale-factor", String(scale));
        textLayer = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent(),
          container: layer,
          viewport: page.getViewport({ scale }),
        });
        await Promise.all([task.promise, textLayer.render()]);
        setFailed(false);
      } catch (error: unknown) {
        if (!abort.signal.aborted && !isCancelled(error)) setFailed(true);
      }
    })();
    return () => {
      abort.abort();
      task?.cancel();
      textLayer?.cancel();
      layer.replaceChildren();
      target.width = 0;
      target.height = 0;
    };
  }, [near, width, doc, pageNumber]);

  return (
    <div
      ref={slot}
      className={styles.slot}
      style={{ aspectRatio: shape.ratio, minWidth: shape.width }}
    >
      <canvas
        ref={canvas}
        className={styles.canvas}
        role="img"
        aria-label={`Page ${String(pageNumber)} of ${String(total)}`}
      />
      <div ref={text} className={styles.text} />
      <FieldMarkers fields={fields} people={people} viewerRecipientId={viewerRecipientId} />
      {failed && (
        <p className={styles.failed} role="alert">
          This page couldn’t be drawn.
        </p>
      )}
    </div>
  );
}
