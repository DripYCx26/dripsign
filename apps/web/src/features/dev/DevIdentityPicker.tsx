"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { settle } from "@/features/shell/settle.ts";
import { devSignIn } from "@/server/actions/auth.ts";
import { Button, Notice } from "@/ui";
import styles from "./DevIdentityPicker.module.css";
import type { DevIdentity } from "./types.ts";

/** Staff identities land on the staff home, recipients on their inbox. */
function homeOf(identity: DevIdentity): string {
  return identity.homes.includes("staff") ? "/staff" : "/";
}

/**
 * The seeded people as cards. Choosing one runs the real code issue and consume with the fixed
 * development code on the server, then lands on that person's home.
 */
export function DevIdentityPicker({
  identities,
}: Readonly<{ identities: readonly DevIdentity[] }>) {
  const router = useRouter();
  const [choosing, setChoosing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function choose(identity: DevIdentity) {
    if (choosing !== null) return;
    setChoosing(identity.email);
    setProblem(null);
    const result = await settle(devSignIn({ email: identity.email }));
    if (result.ok) {
      router.replace(homeOf(identity));
      router.refresh();
      return;
    }
    setChoosing(null);
    setProblem(result.message);
  }

  if (identities.length === 0) {
    return <Notice tone="attention">No development identities are seeded. Run pnpm seed.</Notice>;
  }
  return (
    <div className={styles.picker}>
      {problem !== null && (
        <Notice tone="stop" live="alert">
          {problem}
        </Notice>
      )}
      <ul className={styles.cards}>
        {identities.map((identity) => (
          <li key={identity.email} className={styles.card}>
            <div className={styles.who}>
              <p className={styles.name}>{identity.name}</p>
              <p className={styles.email}>{identity.email}</p>
              <p className={styles.role}>{identity.roleLine}</p>
            </div>
            <Button
              variant="secondary"
              loading={choosing === identity.email}
              disabled={choosing !== null && choosing !== identity.email}
              onClick={() => void choose(identity)}
            >
              Sign in as {identity.name}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
