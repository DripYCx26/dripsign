"use client";

import type { SigningField } from "@dripsign/core/schema";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useState } from "react";
import { ExternalLink, Notice, Skeleton } from "@/ui";
import type { FieldMarkerPerson } from "./FieldMarkers.tsx";
import { loadPdfjs } from "./loadPdfjs.ts";
import { PdfPage } from "./PdfPage.tsx";
import styles from "./PdfView.module.css";

type PdfViewProps = Readonly<{
  /** The PDF's URL; same-origin, from `fileUrl`. */
  src: string;
  fields: readonly SigningField[];
  viewerRecipientId: string | null;
  /** Names for the markers of other people's fields. */
  people?: readonly FieldMarkerPerson[] | undefined;
}>;

type Loaded =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{ status: "ready"; doc: PDFDocumentProxy; firstPageRatio: number }>;

function OpenInNewTab({ src }: Readonly<{ src: string }>) {
  return (
    <a href={src} target="_blank" rel="noreferrer" className={styles.open}>
      Open PDF in a new tab
      <ExternalLink aria-hidden="true" />
    </a>
  );
}

function PdfDocument({ src, fields, viewerRecipientId, people = [] }: PdfViewProps) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

  useEffect(() => {
    const abort = new AbortController();
    // A call, not a property read, so the checks after each await are not narrowed away.
    const stopped = () => abort.signal.aborted;
    const handle: { destroy?: () => Promise<void> } = {};
    void (async () => {
      try {
        const pdfjs = await loadPdfjs();
        if (stopped()) return;
        const task = pdfjs.getDocument({ url: src });
        handle.destroy = () => task.destroy();
        const doc = await task.promise;
        const first = await doc.getPage(1);
        const view = first.getViewport({ scale: 1 });
        if (!stopped()) {
          setLoaded({ status: "ready", doc, firstPageRatio: view.width / view.height });
        }
      } catch {
        if (!stopped()) setLoaded({ status: "error" });
      }
    })();
    return () => {
      abort.abort();
      void handle.destroy?.();
    };
  }, [src]);

  if (loaded.status === "error") {
    return (
      <Notice tone="stop" live="alert">
        <p>This PDF couldn’t be shown here.</p>
        <OpenInNewTab src={src} />
      </Notice>
    );
  }
  if (loaded.status === "loading") {
    return (
      <div role="status" aria-busy="true" className={styles.loading}>
        <span className="ds-visually-hidden">Loading the PDF</span>
        <Skeleton width={90} />
        <Skeleton width={70} />
        <Skeleton width={50} />
      </div>
    );
  }
  const { doc, firstPageRatio } = loaded;
  return (
    <div className={styles.pages}>
      <div className={styles.bar}>
        <span>{`${String(doc.numPages)} ${doc.numPages === 1 ? "page" : "pages"}`}</span>
        <OpenInNewTab src={src} />
      </div>
      {Array.from({ length: doc.numPages }, (_, index) => index + 1).map((pageNumber) => (
        <PdfPage
          key={pageNumber}
          doc={doc}
          pageNumber={pageNumber}
          total={doc.numPages}
          firstPageRatio={firstPageRatio}
          fields={fields.filter((field) => field.page === pageNumber)}
          people={people}
          viewerRecipientId={viewerRecipientId}
        />
      ))}
    </div>
  );
}

/**
 * The exact PDF, drawn page by page with pdf.js, with each signer's fields marked on top. A
 * changed `src` loads afresh. If pdf.js cannot open the file, the link opens it in the browser.
 */
export function PdfView(props: PdfViewProps) {
  return <PdfDocument key={props.src} {...props} />;
}
