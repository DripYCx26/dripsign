import { PageContainer } from "@/features/shell/PageContainer.tsx";
import { SkeletonRows } from "@/ui";

export default function StaffLoading() {
  return (
    <PageContainer>
      <SkeletonRows />
    </PageContainer>
  );
}
