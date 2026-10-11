"use client";

import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { Segmented, TextField } from "@/ui";
import styles from "./ListControls.module.css";
import { listHref, STATUS_FILTERS, type ListState } from "./query.ts";

const SEARCH_DELAY_MS = 250;

/**
 * The search field and status filters. The URL (`?q=&status=`) is the state: a change replaces
 * it and the server renders the new list, so a filtered view can be shared and survives reload.
 */
export function ListControls({ q, status }: ListState) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shownStatus, setShownStatus] = useOptimistic(status);
  const [text, setText] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  function go(next: ListState) {
    startTransition(() => {
      setShownStatus(next.status);
      router.replace(listHref(next), { scroll: false });
    });
  }

  function search(value: string) {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      go({ q: value, status });
    }, SEARCH_DELAY_MS);
  }

  return (
    <div className={styles.controls} aria-busy={pending}>
      <div className={styles.search}>
        <TextField
          label="Search"
          name="q"
          type="search"
          autoComplete="off"
          placeholder="Search title or recipient"
          value={text}
          onChange={search}
        />
      </div>
      <Segmented
        label="Status"
        hideLabel
        name="status"
        options={STATUS_FILTERS}
        value={shownStatus}
        onChange={(value) => {
          go({ q: text, status: value });
        }}
      />
    </div>
  );
}
