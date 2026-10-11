import type { AgreementView } from "@dripsign/core/types";
import type { ReactNode } from "react";
import type { RunCommand } from "@/features/workspace/commands.ts";

/** What every drawer and dialog of the workspace receives; `notice` is the command failure, if any. */
export type PanelProps = Readonly<{
  open: boolean;
  view: AgreementView;
  run: RunCommand;
  /** True while any command of this workspace is in flight. */
  busy: boolean;
  notice: ReactNode;
  onClose: () => void;
}>;
