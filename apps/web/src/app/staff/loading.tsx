import { LoadingFrame } from "@/features/shell/LoadingFrame.tsx";
import { PageContainer } from "@/features/shell/PageContainer.tsx";
import { SkeletonRows } from "@/ui";

export default function StaffLoading() {
  return (
    <LoadingFrame>
      <PageContainer>
        <SkeletonRows />
      </PageContainer>
    </LoadingFrame>
  );
}
