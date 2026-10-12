"use client";

import { useEffect, useState } from "react";
import type { SignatureFace } from "@dripsign/core/pdf/font";
import { checkName } from "./actions.ts";

const DEBOUNCE_MS = 300;

interface Checked {
  readonly name: string;
  readonly message: string | undefined;
  readonly face: SignatureFace;
}

export interface NameCheck {
  /** The refusal for the current name; undefined while it is empty, unchecked or fine. */
  readonly message: string | undefined;
  /** The face the signed PDF draws the name in; the last verdict holds while the next is pending. */
  readonly face: SignatureFace;
}

/**
 * The server's renderable-name verdict for the typed name, 300 ms after typing stops. A failed
 * check does not block signing: the sign command runs the same check and its refusal is shown.
 */
export function useNameCheck(name: string): NameCheck {
  const trimmed = name.trim();
  const [checked, setChecked] = useState<Checked | null>(null);

  useEffect(() => {
    if (trimmed === "") return undefined;
    let current = true;
    const timer = setTimeout(() => {
      checkName({ name: trimmed }).then(
        (result) => {
          if (!current) return;
          setChecked(
            result.ok
              ? { name: trimmed, message: undefined, face: result.value }
              : { name: trimmed, message: result.message, face: "plain" },
          );
        },
        () => {
          if (current)
            setChecked((last) => ({
              name: trimmed,
              message: undefined,
              face: last?.face ?? "script",
            }));
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [trimmed]);

  return {
    message: checked?.name === trimmed ? checked.message : undefined,
    face: checked?.face ?? "script",
  };
}
