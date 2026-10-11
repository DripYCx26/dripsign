"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { TextField } from "@/ui";
import styles from "./ListControls.module.css";
import { listHref } from "./query.ts";

const SEARCH_DELAY_MS = 250;

/**
 * The search field. The URL (`?q=`) is the state: a change replaces it and the server renders the
 * new list, so a searched view can be shared and survives reload.
 */
export function ListControls({ q }: Readonly<{ q: string }>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  function search(value: string) {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startTransition(() => {
        router.replace(listHref(value), { scroll: false });
      });
    }, SEARCH_DELAY_MS);
  }

  return (
    <div className={styles.search} aria-busy={pending}>
      <TextField
        label="Search"
        hideLabel
        name="q"
        type="search"
        autoComplete="off"
        placeholder="Search title or recipient"
        value={text}
        onChange={search}
      />
    </div>
  );
}
