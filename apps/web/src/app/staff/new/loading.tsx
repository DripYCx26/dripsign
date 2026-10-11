import { PageContainer } from "@/features/shell/PageContainer.tsx";
import { SkeletonRows } from "@/ui";

export default function Loading() {
  return (
    <PageContainer>
      <SkeletonRows count={5} />
    </PageContainer>
  );
}
