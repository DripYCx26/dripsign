"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { revokeStaff } from "@/server/actions/staff.ts";
import { Button, Dialog, Moment, Notice, Pill } from "@/ui";
import { AddStaffForm } from "./AddStaffForm.tsx";
import type { RosterMember } from "./roster.ts";
import { settle } from "./settle.ts";
import styles from "./TeamRoster.module.css";

type Props = Readonly<{ members: readonly RosterMember[]; selfEmail: string }>;

/** The people with access to this workspace: remove one (never yourself), or add one. */
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
      <div className={styles.table}>
        <div className={styles.head} aria-hidden="true">
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Added</span>
        </div>
        <ul className={styles.members}>
          {members.map((member) => (
            <li key={member.email} className={styles.member}>
              <p className={styles.name}>{member.name ?? "—"}</p>
              <p className={styles.detail}>{member.email}</p>
              <p className={styles.meta}>
                <span>
                  <Pill tone="info">{member.role === "admin" ? "Admin" : "Member"}</Pill>
                </span>
                <span>
                  <Moment value={member.addedAt} format="relative" />
                </span>
              </p>
              {member.email !== selfEmail && (
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    setRevoking(member);
                  }}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
      <AddStaffForm />
      <Dialog
        open={revoking !== null}
        title={`Remove ${revoking?.name ?? revoking?.email ?? "this person"}?`}
        confirmLabel="Remove"
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
