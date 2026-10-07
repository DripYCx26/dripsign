/** Emits an allowlisted worker record without customer text, secrets, or provider bodies. */
export function logMetadata(record: {
  readonly event: 'started' | 'stopped' | 'claimed' | 'finished' | 'fenced' | 'failure';
  readonly jobId?: string;
  readonly kind?: string;
  readonly code?: string;
  readonly count?: number;
  readonly elapsedMs?: number;
}): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...record })}\n`);
}
