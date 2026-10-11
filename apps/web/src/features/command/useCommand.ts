"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { canonicalJson, type Command } from "@dripsign/core/schema";
import type { AgreementView, Capacity } from "@dripsign/core/types";
import type { ActionFailure, ActionResult } from "@/server/action";
import { refreshView, runCommand } from "@/server/actions/agreements";

const FOCUS_REFRESH_MS = 15_000;

/** The request may have committed: the retry reuses the same receipt key and payload. */
const UNCERTAIN: ActionFailure = {
  ok: false,
  code: "unavailable",
  message: "We couldn’t confirm whether that went through. Reload to check before trying again.",
};

const READ_FAILED: ActionFailure = {
  ok: false,
  code: "unavailable",
  message: "We couldn’t load the latest. Check your connection and try again.",
};

export interface CommandState {
  readonly view: AgreementView;
  /** Resolves true when the command applied; false when refused, failed, or another is running. */
  readonly run: (command: Command, intentId?: string) => Promise<boolean>;
  readonly pending: boolean;
  readonly error: ActionFailure | null;
  readonly clearError: () => void;
  readonly refresh: () => Promise<void>;
}

interface Scope {
  readonly agreementId: string;
  /** The server view this scope last adopted; a new one (navigation, refresh) replaces local state. */
  readonly source: AgreementView;
  readonly view: AgreementView;
  readonly error: ActionFailure | null;
}

interface Intent {
  readonly key: string;
  readonly payload: string;
}

/**
 * One workspace's command channel: one command in flight, one receipt key per user intent (reused
 * while the payload is unchanged, dropped after success), state keyed on the agreement id only.
 * A `conflict` refreshes the view; the caller's own input (composer text) is never touched.
 */
export function useCommand(
  agreementId: string,
  capacity: Capacity,
  initialView: AgreementView,
): CommandState {
  const [scope, setScope] = useState<Scope>(() => fresh(agreementId, initialView));
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const intents = useRef(new Map<string, Intent>());
  const latest = useRef(0);
  const lastRefresh = useRef(0);

  if (scope.agreementId !== agreementId || scope.source !== initialView) {
    setScope(
      fresh(agreementId, initialView, scope.agreementId === agreementId ? scope.error : null),
    );
  }

  // Applies a response only if no newer request has started and the workspace is still the same.
  // The ticket is checked now, not in the updater, which React may run after the next request.
  const settle = useCallback(
    (ticket: number, result: ActionResult<AgreementView>, keepError = false) => {
      if (ticket !== latest.current) return;
      setScope((current) => {
        if (current.agreementId !== agreementId) return current;
        if (result.ok)
          return { ...current, view: result.value, error: keepError ? current.error : null };
        return keepError ? current : { ...current, error: result };
      });
    },
    [agreementId],
  );

  const load = useCallback(
    async (keepError: boolean) => {
      const ticket = ++latest.current;
      lastRefresh.current = Date.now();
      settle(ticket, await settled(refreshView({ agreementId, capacity }), READ_FAILED), keepError);
    },
    [agreementId, capacity, settle],
  );

  const refresh = useCallback(async () => {
    if (!inFlight.current) await load(false);
  }, [load]);

  const run = useCallback(
    async (command: Command, intentId: string = command.kind) => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setPending(true);
      const slot = `${agreementId}:${intentId}`;
      const receiptKey = keyFor(intents.current, slot, canonicalJson(command));
      const ticket = ++latest.current;
      try {
        const input = { agreementId, capacity, receiptKey, command };
        const result = await settled(runCommand(input), UNCERTAIN);
        if (result.ok) intents.current.delete(slot);
        settle(ticket, result);
        if (!result.ok && result.code === "conflict") await load(true);
        return result.ok;
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [agreementId, capacity, load, settle],
  );

  const clearError = useCallback(() => {
    setScope((current) => (current.error === null ? current : { ...current, error: null }));
  }, []);

  useFocusRefresh(refresh, lastRefresh);

  return { view: scope.view, run, pending, error: scope.error, clearError, refresh };
}

/** Refreshes when the window regains focus, at most once per `FOCUS_REFRESH_MS`. */
function useFocusRefresh(refresh: () => Promise<void>, lastRefreshRef: RefObject<number>): void {
  useEffect(() => {
    lastRefreshRef.current = Date.now();
    const onFocus = () => {
      if (Date.now() - lastRefreshRef.current >= FOCUS_REFRESH_MS) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, lastRefreshRef]);
}

function fresh(
  agreementId: string,
  view: AgreementView,
  error: ActionFailure | null = null,
): Scope {
  return { agreementId, source: view, view, error };
}

/** The intent's key while its payload is unchanged; a changed payload is a new attempt. */
function keyFor(intents: Map<string, Intent>, slot: string, payload: string): string {
  const existing = intents.get(slot);
  if (existing?.payload === payload) return existing.key;
  const key = crypto.randomUUID();
  intents.set(slot, { key, payload });
  return key;
}

/** A server action that throws (network, deploy skew) is reported, never rethrown into React. */
async function settled<T>(
  call: Promise<ActionResult<T>>,
  onThrow: ActionFailure,
): Promise<ActionResult<T>> {
  try {
    return await call;
  } catch {
    return onThrow;
  }
}
