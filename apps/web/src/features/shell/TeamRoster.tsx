"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { revokeStaff } from "@/server/actions/staff.ts";
import { Button, Dialog, Moment, Notice } from "@/ui";
import { AddStaffForm } from "./AddStaffForm.tsx";
import type { RosterMember } from "./roster.ts";
import { settle } from "./settle.ts";
import styles from "./TeamRoster.module.css";

type Props = Readonly<{ members: readonly RosterMember[]; selfEmail: string }>;

/** The people with access to this workspace: revoke one (never yourself), or add one. */
export function TeamRoster({ members, selfEmail }: Props) {
  const router = useRouter();
  const [revoking, setRevoking] = useState<RosterMember | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function revoke(member: RosterMember) {
    setPending(true);
    setProblem(null);
    const result = await settle(revokeStaff({ email: member.email }));
    setPending(false);
    setRevoking(null);
    if (result.ok) router.refresh();
    else setProblem(result.message);
  }

  return (
    <div className={styles.team}>
      {problem !== null && (
        <Notice tone="stop" live="alert">
          {problem}
        </Notice>
      )}
      <ul className={styles.members}>
        {members.map((member) => (
          <li key={member.email} className={styles.member}>
            <div className={styles.who}>
              <p className={styles.name}>{member.name ?? member.email}</p>
              <p className={styles.detail}>
                {member.name !== null && <span>{member.email} · </span>}
                {member.role === "admin" ? "Admin" : "Member"} · added{" "}
                <Moment value={member.addedAt} format="relative" />
              </p>
            </div>
            {member.email !== selfEmail && (
              <Button
                variant="secondary"
                onClick={() => {
                  setRevoking(member);
                }}
              >
                Revoke access
              </Button>
            )}
          </li>
        ))}
      </ul>
      <AddStaffForm />
      <Dialog
        open={revoking !== null}
        title={`Revoke access for ${revoking?.name ?? revoking?.email ?? "this person"}?`}
        confirmLabel="Revoke access"
        tone="danger"
        loading={pending}
        onConfirm={() => {
          if (revoking !== null) void revoke(revoking);
        }}
        onClose={() => {
          setRevoking(null);
        }}
      >
        They lose access to this workspace now. Agreements and messages they wrote stay as they are.
      </Dialog>
    </div>
  );
}
