import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageContainer } from "@/features/shell/PageContainer.tsx";
import { loadRoster } from "@/features/shell/roster.ts";
import { TeamRoster } from "@/features/shell/TeamRoster.tsx";
import { requireStaff } from "@/server/session.ts";
import { PageHeader } from "@/ui";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const { actor } = await requireStaff();
  // Admins manage the roster; to anyone else the page does not exist.
  if (actor.role !== "admin") notFound();
  return (
    <PageContainer>
      <PageHeader eyebrow="Staff workspace" title="Team" />
      <TeamRoster members={await loadRoster(actor)} selfEmail={actor.email} />
    </PageContainer>
  );
}
