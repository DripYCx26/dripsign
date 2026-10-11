"use client";

import type { Page, StaffListItem } from "@dripsign/core/types";
import { useState } from "react";
import { settle } from "@/features/shell/settle.ts";
import { listStaff } from "@/server/actions/agreements.ts";
import { Button, ButtonLink, EmptyState, Notice } from "@/ui";
import { AgreementList } from "./AgreementList.tsx";
import styles from "./StaffAgreementList.module.css";
import { isFiltered, type ListState } from "./query.ts";
import { flatStaffRows, groupStaffRows } from "./rows.ts";

type Props = Readonly<{ initial: Page<StaffListItem> }> & ListState;

type More = Readonly<{
  /** The first page these rows were fetched after; a new first page makes them stale. */
  base: Page<StaffListItem>;
  items: readonly StaffListItem[];
  nextCursor: string | null;
}>;

/**
 * The dashboard's list: the server's first page for the URL's filters, then "Load more" pages
 * fetched with the same filters and cursor. Grouped when unfiltered, flat when searched.
 */
export function StaffAgreementList({ initial, q, status }: Props) {
  const [more, setMore] = useState<More | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // New filters bring a new first page object; rows loaded after the old one no longer belong.
  const loaded = more?.base === initial ? more : null;
  const items = loaded === null ? initial.items : [...initial.items, ...loaded.items];
  const nextCursor = loaded === null ? initial.nextCursor : loaded.nextCursor;
  const filtered = isFiltered({ q, status });

  async function loadMore() {
    if (nextCursor === null || loading) return;
    setLoading(true);
    setProblem(null);
    const result = await settle(
      listStaff({
        ...(q === "" ? {} : { q }),
        ...(status === "all" ? {} : { status }),
        cursor: nextCursor,
      }),
    );
    setLoading(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setMore({
      base: initial,
      items: [...(loaded?.items ?? []), ...result.value.items],
      nextCursor: result.value.nextCursor,
    });
    setAnnouncement(`Loaded ${String(result.value.items.length)} more agreements.`);
  }

  if (items.length === 0) {
    return filtered ? (
      <EmptyState message="Nothing matches these filters." />
    ) : (
      <EmptyState
        message="No agreements yet. Create one to start a thread with your recipients."
        action={
          <ButtonLink variant="ink" href="/staff/new">
            New agreement
          </ButtonLink>
        }
      />
    );
  }
  return (
    <div className={styles.list}>
      <AgreementList groups={filtered ? flatStaffRows(items) : groupStaffRows(items)} />
      {problem !== null && (
        <Notice tone="stop" live="alert">
          {problem}
        </Notice>
      )}
      {nextCursor !== null && (
        <div className={styles.more}>
          <Button variant="secondary" loading={loading} onClick={() => void loadMore()}>
            Load more
          </Button>
        </div>
      )}
      <p className="ds-visually-hidden" role="status">
        {announcement}
      </p>
    </div>
  );
}
