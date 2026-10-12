import { LoadingFrame } from "@/features/shell/LoadingFrame.tsx";
import { PageContainer } from "@/features/shell/PageContainer.tsx";
import { SkeletonRows } from "@/ui";

export default function Loading() {
  return (
    <LoadingFrame>
      <PageContainer>
        <SkeletonRows count={5} />
      </PageContainer>
    </LoadingFrame>
  );
}
