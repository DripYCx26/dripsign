import type { ReactNode } from "react";
import { CircleCheck, Info, OctagonAlert, TriangleAlert } from "../icons.tsx";

/** The four tones. A tone is always shown with a word and its icon, never as colour alone. */
export type ToneName = "info" | "confirm" | "attention" | "stop";

const TONE_ICON: Readonly<Record<ToneName, ReactNode>> = {
  info: <Info />,
  confirm: <CircleCheck />,
  attention: <TriangleAlert />,
  stop: <OctagonAlert />,
};

/** The glyph that goes with a tone; callers wrap it aria-hidden beside their words. */
export function toneIcon(tone: ToneName): ReactNode {
  return TONE_ICON[tone];
}
