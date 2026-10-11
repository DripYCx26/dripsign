"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, IconButton } from "@/ui";

type BackButtonProps = Readonly<{
  /** Where it goes and what it says ("Back to agreements"); the glyph alone names nothing. */
  label: string;
  href: string;
}>;

/** The chevron that leaves a workspace, the publish review or the signing flow for its parent. */
export function BackButton({ label, href }: BackButtonProps) {
  const router = useRouter();
  return (
    <IconButton
      label={label}
      icon={<ChevronLeft />}
      shape="round"
      onClick={() => {
        router.push(href);
      }}
    />
  );
}
