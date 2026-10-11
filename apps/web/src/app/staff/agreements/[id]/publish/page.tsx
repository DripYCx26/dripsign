import { loadAgreementView } from "@dripsign/core/domain/view";
import { isDomainError } from "@dripsign/core/errors";
import { uuidSchema } from "@dripsign/core/schema";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublishReview } from "@/features/document/PublishReview.tsx";
import { BackButton } from "@/features/workspace/BackButton.tsx";
import { requireStaff } from "@/server/session.ts";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Review and publish" };

type Props = Readonly<{ params: Promise<{ id: string }> }>;

/** Staff only. Reads the draft fresh on every request: the SHA shown is the SHA published. */
export default async function PublishPage({ params }: Props) {
  const { id } = await params;
  const { actor } = await requireStaff();
  if (!uuidSchema.safeParse(id).success) notFound();
  const view = await loadAgreementView(actor, id).catch((error: unknown) => {
    if (isDomainError(error) && error.code === "not_found") notFound();
    throw error;
  });
  const current = view.agreement.currentRevisionNumber;
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <BackButton label="Back to agreement" href={`/staff/agreements/${id}`} />
        <h1>{`Publish revision ${String((current ?? 0) + 1)}`}</h1>
        <p className={styles.title}>{view.agreement.title}</p>
      </header>
      <PublishReview view={view} />
    </div>
  );
}
