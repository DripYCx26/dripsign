"use client";

import type { SigningField } from "@dripsign/core/schema";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ExternalLink, Notice, Skeleton } from "@/ui";
import type { FieldMarkerPerson } from "./FieldMarkers.tsx";
import { loadPdfjs } from "./loadPdfjs.ts";
import { PdfPage } from "./PdfPage.tsx";
import styles from "./PdfView.module.css";

type PdfViewProps = Readonly<{
  /** The PDF's URL; same-origin, from `fileUrl`. */
  src: string;
  /** The document's SHA-256. A different one is a different document, so the viewer starts over. */
  sha256: string;
  fields: readonly SigningField[];
  viewerRecipientId: string | null;
  /** Names for the markers of other people's fields. */
  people?: readonly FieldMarkerPerson[] | undefined;
  /** Facts that lead the toolbar row ("SHA-256 abf2da6bcf01"). */
  lead?: ReactNode;
  /** A control at the end of the toolbar row. */
  actions?: ReactNode;
}>;

type Loaded =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error" }>
  | Readonly<{ status: "ready"; doc: PDFDocumentProxy; firstPageRatio: number }>;

type ToolbarProps = Readonly<{
  src: string;
  /** Known once the file is open. */
  pages: number | null;
  lead: ReactNode;
  actions: ReactNode;
}>;

/** One 40 px row: what is known of the file, a link to open it, and the caller's control. */
function Toolbar({ src, pages, lead, actions }: ToolbarProps) {
  const facts: ReactNode[] = [
    lead,
    pages !== null && `${String(pages)} ${pages === 1 ? "page" : "pages"}`,
    <a key="open" href={src} target="_blank" rel="noreferrer" className={styles.open}>
      Open PDF
      <ExternalLink aria-hidden="true" />
      <span className="ds-visually-hidden"> (opens in a new tab)</span>
    </a>,
  ].filter((fact) => fact !== null && fact !== false && fact !== undefined);
  return (
    <div className={styles.bar}>
      <div className={styles.facts}>
        {facts.map((fact, index) => (
          <Fragment key={index}>
            {index > 0 && <span aria-hidden="true">·</span>}
            {fact}
          </Fragment>
        ))}
      </div>
      {actions}
    </div>
  );
}

function PdfDocument({ src, fields, viewerRecipientId, people = [], lead, actions }: PdfViewProps) {
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

  const pages = loaded.status === "ready" ? loaded.doc.numPages : null;
  return (
    <div className={styles.pages}>
      <Toolbar src={src} pages={pages} lead={lead} actions={actions} />
      {loaded.status === "error" && (
        <Notice tone="stop" live="alert">
          This PDF couldn’t be shown here.
        </Notice>
      )}
      {loaded.status === "loading" && (
        <div role="status" aria-busy="true" className={styles.loading}>
          <span className="ds-visually-hidden">Loading the PDF</span>
          <Skeleton width={90} />
          <Skeleton width={70} />
          <Skeleton width={50} />
        </div>
      )}
      {loaded.status === "ready" &&
        Array.from({ length: loaded.doc.numPages }, (_, index) => index + 1).map((pageNumber) => (
          <PdfPage
            key={pageNumber}
            doc={loaded.doc}
            pageNumber={pageNumber}
            total={loaded.doc.numPages}
            firstPageRatio={loaded.firstPageRatio}
            fields={fields.filter((field) => field.page === pageNumber)}
            people={people}
            viewerRecipientId={viewerRecipientId}
          />
        ))}
    </div>
  );
}

/**
 * The exact PDF, drawn page by page with pdf.js and its text layer, with each signer's fields
 * marked on top. A changed `src` or `sha256` loads afresh, so what is shown is the document the
 * caller names. If pdf.js cannot open the file, the toolbar's link opens it in the browser.
 */
export function PdfView(props: PdfViewProps) {
  return <PdfDocument key={`${props.src}#${props.sha256}`} {...props} />;
}
