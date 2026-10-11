"use client";

import { useSyncExternalStore } from "react";

// The seam between the document (which starts a proposal from a section) and the composer
// (which owns the proposal draft). One intent at a time per page; null means plain messaging.
export interface ProposalIntent {
  readonly sectionId?: string | undefined;
  readonly counterOf?: string | undefined;
}

let current: ProposalIntent | null = null;
const listeners = new Set<() => void>();

function emit(next: ProposalIntent | null): void {
  current = next;
  for (const listener of listeners) listener();
}

export function startProposal(intent: ProposalIntent): void {
  emit(intent);
}

export function cancelProposal(): void {
  emit(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useProposalIntent(): ProposalIntent | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
