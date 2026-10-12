"use client";

import { EntryFrame } from "@/features/shell/EntryFrame.tsx";
import { ErrorActions } from "@/features/shell/ErrorActions.tsx";

type ErrorPageProps = Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>;

export default function ErrorPage({ error, retry }: ErrorPageProps) {
  return (
    <EntryFrame
      title="We couldn’t load this page."
      lead="Something went wrong on our side. Try again, or go back to your agreements."
    >
      <ErrorActions digest={error.digest} retry={retry} />
    </EntryFrame>
  );
}
