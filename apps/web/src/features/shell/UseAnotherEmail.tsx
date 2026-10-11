"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/server/actions/auth.ts";
import { Button, Notice } from "@/ui";
import { settle } from "./settle.ts";

/** Ends the current session and goes to sign-in, for someone signed in as the wrong address. */
export function UseAnotherEmail() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function leave() {
    setPending(true);
    const result = await settle(signOut());
    if (!result.ok) {
      setPending(false);
      setProblem(result.message);
      return;
    }
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <>
      {problem !== null && (
        <Notice tone="stop" live="alert">
          {problem}
        </Notice>
      )}
      <Button variant="secondary" loading={pending} onClick={() => void leave()}>
        Use another email
      </Button>
    </>
  );
}
