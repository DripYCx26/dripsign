"use client";

import "@/ui/tokens/tokens.css";
import "@/ui/tokens/base.css";
import { EntryFrame } from "@/features/shell/EntryFrame.tsx";
import { ErrorActions } from "@/features/shell/ErrorActions.tsx";

type GlobalErrorProps = Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>;

/** The last resort, when the root layout itself failed: its own document, system fonts. */
export default function GlobalError({ error, retry }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body>
        <title>Something went wrong · DripSign</title>
        <EntryFrame title="We couldn’t load this page.">
          <ErrorActions digest={error.digest} retry={retry} />
        </EntryFrame>
      </body>
    </html>
  );
}
