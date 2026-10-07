'use client';

import { useState, useTransition } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AgreementWorkspace } from '@dripsign/ui';
import type { AgreementDetail, ProposalChange } from '@dripsign/db';
import { SIGNING_CONSENT_VERSION, SIGNING_CONSENT_HASH } from '../signingConsent';

type Props = { readonly detail: AgreementDetail; readonly isStaff: boolean };

/** The shared workspace receives fresh server projections after every authorized command. */
export function Workspace({ detail, isStaff }: Props): ReactNode {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();
  const id = detail.agreement.id;
  const revision = detail.revisions.find((item) => item.id === detail.agreement.currentRevisionId);
  const isDraftPreview = isStaff && Boolean(detail.draft) && (detail.agreement.publicationNeeded
    || detail.agreement.status === 'draft' || detail.draft?.preparationStatus === 'preparing' || detail.draft?.preparationStatus === 'failed');
  const preview = isDraftPreview ? detail.draft?.document : revision?.document;
  const previewKind = isDraftPreview ? 'draft' : 'document';
  const pdfUrl = preview ? `/api/agreements/${id}/pdf?kind=${previewKind}` : null;
  async function command(fields: Readonly<Record<string, unknown>>): Promise<void> {
    setIsPending(true); setError(null);
    try {
      const response = await fetch(`/api/agreements/${id}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, expectedVersion: detail.agreement.version, idempotencyKey: crypto.randomUUID() }),
      });
      if (!response.ok) { setError(response.status === 409 ? 'The agreement changed. Reload it before trying again.' : 'The action could not be completed.'); return; }
      router.refresh();
    } catch { setError('The action outcome is unknown. Reload the agreement before trying again.'); }
    finally { setIsPending(false); }
  }
  async function handleSign(typedName: string): Promise<void> {
    const round = detail.signingRound;
    if (!revision || !round) { setError('The signing request changed. Refresh the agreement.'); return; }
    setIsPending(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/agreements/${id}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: detail.agreement.version, idempotencyKey: crypto.randomUUID(),
          roundId: round.id, revisionId: revision.id, documentSha256: revision.document.sha256, typedName,
          consentVersion: SIGNING_CONSENT_VERSION, consentHash: SIGNING_CONSENT_HASH, consentAccepted: true }),
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        const code = typeof value === 'object' && value !== null && 'error' in value ? value.error : null;
        switch (code) {
          case 'verification_required': case 'authentication_required':
            setNeedsVerification(true); setError('Verify your email again before signing.'); break;
          case 'conflict': setError('The agreement changed. Refresh and review the current document before signing.'); break;
          case 'invalid': case 'invalid_request': setError('The signature could not be accepted. Check your typed name and consent.'); break;
          case 'admission_paused': setError('Signing is paused. Try again later.'); break;
          default: setError('The signature outcome is unknown. Refresh the agreement before trying again.');
        }
        return;
      }
      if (typeof value !== 'object' || value === null || !('roundId' in value) || value.roundId !== round.id
        || !('revisionId' in value) || value.revisionId !== revision.id
        || !('documentSha256' in value) || value.documentSha256 !== revision.document.sha256
        || !('signedAt' in value) || typeof value.signedAt !== 'string' || !Number.isFinite(Date.parse(value.signedAt))) {
        setError('The signature outcome is unknown. Refresh the agreement before trying again.'); return;
      }
      setNotice('Your signature was recorded. The signed PDF and audit record become available after every required signature is recorded and both files are archived.');
      startRefresh(() => router.refresh());
    } catch { setError('The signature outcome is unknown. Refresh the agreement before trying again.'); }
    finally { setIsPending(false); }
  }
  async function handleReverify(): Promise<void> {
    setIsPending(true); setError(null);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) { setError('Email verification could not be restarted. Try again.'); return; }
      startRefresh(() => router.refresh());
    } catch { setError('Email verification could not be restarted. Try again.'); }
    finally { setIsPending(false); }
  }
  async function handleUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsPending(true); setError(null);
    try {
      const response = await fetch(`/api/agreements/${id}/upload`, { method: 'POST', headers: {
        'Content-Type': 'application/pdf', 'X-Expected-Version': String(detail.agreement.version), 'Idempotency-Key': crypto.randomUUID(),
      }, body: file });
      if (!response.ok) { setError(response.status === 409 ? 'The agreement changed. Reload before uploading.' : 'The PDF could not be prepared.'); return; }
      router.refresh();
    } catch { setError('The upload outcome is unknown. Reload the agreement.'); }
    finally { setIsPending(false); event.target.value = ''; }
  }
  function handleProposal(change: ProposalChange): void {
    void command({ action: change.supersedesId ? 'counter' : 'propose', ...change });
  }
  return <>
    <section className="workspace-refresh"><button className="secondary" disabled={isPending || isRefreshing} onClick={() => startRefresh(() => router.refresh())}>{isRefreshing ? 'Refreshing…' : 'Refresh status'}</button><span className="notice">Read the latest document, suggestions, and signatures.</span></section>
    {isStaff && <section className="workspace-tools stack">
      {detail.allowedActions.includes('save_draft') && <label>Replace with a PDF<input type="file" accept="application/pdf" disabled={isPending} onChange={(event) => { void handleUpload(event); }} /></label>}
      {preview && <p className="notice">Preview SHA-256: <code>{preview.sha256}</code> <a href={pdfUrl ?? '#'} target="_blank" rel="noopener noreferrer">Open full PDF</a></p>}
      {detail.allowedActions.some((action) => action === 'request_signatures') && <button className="primary" disabled={isPending} onClick={() => { void command({ action: 'request_signatures' }); }}>Request signatures on the published version</button>}
      {detail.allowedActions.some((action) => action === 'cancel_signatures') && <button className="secondary" disabled={isPending} onClick={() => { void command({ action: 'cancel_signatures' }); }}>Cancel the current signature request</button>}
    </section>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {needsVerification && <button className="secondary" disabled={isPending || isRefreshing} onClick={() => { void handleReverify(); }}>Verify email again</button>}
    <AgreementWorkspace detail={detail} documentUrl={pdfUrl} isDraftPreview={isDraftPreview} isPending={isPending || isRefreshing} error={error}
      onPropose={handleProposal} onAccept={(proposalId) => { void command({ action: 'accept', proposalId }); }}
      onReject={(proposalId) => { void command({ action: 'reject', proposalId }); }}
      onMessage={(body) => { void command({ action: 'message', body }); }}
      onAskAi={(instruction) => { void command({ action: 'ask_ai', instruction }); }}
      onAdoptAiCandidate={(candidateId) => { void command({ action: 'adopt_ai_candidate', candidateId }); }}
      onSaveDraft={(draft) => { if (draft.source) void command({ action: 'save_draft', source: draft.source }); }}
      onPublish={() => { if (!detail.draft?.document) { setError('Prepare a PDF before publishing.'); return; } void command({ action: 'publish', reviewedSha256: detail.draft.document.sha256 }); }}
      onSign={(typedName) => { void handleSign(typedName); }}
      onDownload={(kind) => { window.location.assign(`/api/agreements/${id}/pdf?kind=${kind}`); }}
    />
  </>;
}
