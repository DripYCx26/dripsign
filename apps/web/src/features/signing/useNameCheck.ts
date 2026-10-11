"use client";

import { useEffect, useState } from "react";
import { checkName } from "./actions.ts";

const DEBOUNCE_MS = 300;

interface Checked {
  readonly name: string;
  readonly message: string | undefined;
}

/**
 * The server's renderable-name verdict for the typed name, 300 ms after typing stops. Undefined
 * while the name is empty, unchecked or fine. A failed check does not block signing: the sign
 * command runs the same check and its refusal is shown.
 */
export function useNameCheck(name: string): string | undefined {
  const trimmed = name.trim();
  const [checked, setChecked] = useState<Checked | null>(null);

  useEffect(() => {
    if (trimmed === "") return undefined;
    let current = true;
    const timer = setTimeout(() => {
      checkName({ name: trimmed }).then(
        (result) => {
          if (current)
            setChecked({ name: trimmed, message: result.ok ? undefined : result.message });
        },
        () => {
          if (current) setChecked({ name: trimmed, message: undefined });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [trimmed]);

  return checked?.name === trimmed ? checked.message : undefined;
}
