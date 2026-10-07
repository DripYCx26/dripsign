'use client';

import { useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { SIGNING_CONSENT_HASH, SIGNING_CONSENT_TEXT, SIGNING_CONSENT_VERSION } from '@dripsign/db/types';
import type { AgreementDetail, ArchivedArtifact, DocumentDraft, DocumentSource, Proposal, ProposalAiCandidate, ProposalChange, Revision } from '@dripsign/db/types';
export type AgreementWorkspaceProps = {
  readonly detail: AgreementDetail;
  readonly documentUrl?: string | null;
  readonly isDraftPreview?: boolean;
  readonly isPending?: boolean;
  readonly error?: string | null;
  readonly onPropose?: ((change: ProposalChange) => void) | undefined;
  readonly onAccept?: ((proposalId: string) => void) | undefined;
  readonly onReject?: ((proposalId: string) => void) | undefined;
  readonly onPublish?: (() => void) | undefined;
  readonly onSign?: ((typedName: string) => void) | undefined;
  readonly onDownload?: ((kind: ArchivedArtifact['kind']) => void) | undefined;
  readonly onMessage?: ((body: string) => void) | undefined;
  readonly onAskAi?: ((instruction: string) => void) | undefined;
  readonly onSaveDraft?: ((draft: DocumentDraft) => void) | undefined;
  readonly onAdoptAiCandidate?: ((id: string) => void) | undefined;
};
const statusLabels: Record<AgreementDetail['agreement']['status'], string> = {
  draft: 'Draft', negotiating: 'In review', signing: 'Awaiting signatures', signed: 'Signed', void: 'Voided',
};
const proposalLabels: Record<Proposal['status'], string> = {
  pending: 'Awaiting response', accepted: 'Accepted into draft', rejected: 'Declined', superseded: 'Countered',
};
export function DripSignBrand(): ReactElement {
  return <span className="ds-brand">
    <span className="ds-brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="m5 17 10-10 3 3-10 10H5v-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
        <path d="M4 5h9M4 9h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    </span>DripSign</span>;
}
function SourceText({ source }: {
  readonly source: DocumentSource;
}): ReactElement {
  return <div className="ds-document-text">
    <h3 className="ds-title">
      {source.title}
    </h3>
    {source.sections.map(section => <section key={section.id}>
      <h4>
        {section.heading}
      </h4>
      {section.paragraphs.map((paragraph, index) => <p key={`${section.id}-${index}`}>
        {paragraph}
      </p>)}
    </section>)}
  </div>;
}
function safeDocumentUrl(value: string | null | undefined): string | null {
  if (!value)
    return null;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\'))
    return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  }
  catch {
    return null;
  }
}
function SourceEditor({ source, onChange }: {
  readonly source: DocumentSource;
  readonly onChange: (source: DocumentSource) => void;
}): ReactElement {
  return <div className="ds-form">
    <label className="ds-field">Document title<input className="ds-input" value={source.title} maxLength={300} required onChange={event => onChange({ ...source, title: event.target.value })}/>
    </label>
    {source.sections.map(section => <fieldset className="ds-source-section" key={section.id}>
      <legend>
        {section.heading || 'Section'}
      </legend>
      <label className="ds-field">Heading<input className="ds-input" value={section.heading} maxLength={300} onChange={event => onChange({ ...source, sections: source.sections.map(item => item.id === section.id ? { ...item, heading: event.target.value } : item) })}/>
      </label>
      <label className="ds-field">Wording<textarea className="ds-input" rows={5} value={section.paragraphs.join('\n\n')} maxLength={50000} required onChange={event => onChange({ ...source, sections: source.sections.map(item => item.id === section.id ? { ...item, paragraphs: event.target.value.split('\n\n') } : item) })}/>
      </label>
    </fieldset>)}
  </div>;
}
function ProposalCard({ proposal, detail, isPending, onAccept, onReject, onCounter }: {
  readonly proposal: Proposal;
  readonly detail: AgreementDetail;
  readonly isPending: boolean;
  readonly onAccept: AgreementWorkspaceProps['onAccept'];
  readonly onReject: AgreementWorkspaceProps['onReject'];
  readonly onCounter: (() => void) | undefined;
}): ReactElement {
  const isCurrent = proposal.status === 'pending';
  return <article className="ds-proposal">
    <header className="ds-proposal-head">
      <span>
        <strong>
          {proposal.authorKind === 'staff' ? 'Sender' : 'Recipient'}
        </strong> proposed a change</span>
      <span className="ds-badge">
        {proposalLabels[proposal.status]}
      </span>
    </header>
    <div className="ds-wording">
      <span className="ds-eyebrow">Original wording</span>
      {proposal.originalSource ? <SourceText source={proposal.originalSource}/> : <p>See the published PDF for the original wording.</p>}
    </div>
    <div className="ds-wording">
      <span className="ds-eyebrow">Proposed wording</span>
      {proposal.replacementSource ? <SourceText source={proposal.replacementSource}/> : <p>No replacement document was proposed.</p>}
    </div>
    {proposal.text && <div className="ds-wording">
      <span className="ds-eyebrow">Reason for change</span>
      <p>
        {proposal.text}
      </p>
    </div>}{isCurrent && <div className="ds-proposal-actions ds-actions">
      {detail.allowedActions.includes('accept') && <button className="ds-button" data-primary="true" disabled={isPending || !onAccept} onClick={() => onAccept?.(proposal.id)}>Accept</button>}{detail.allowedActions.includes('counter') && <button className="ds-button" disabled={isPending || !onCounter} onClick={onCounter}>Counter</button>}{detail.allowedActions.includes('reject') && <button className="ds-button" data-danger="true" disabled={isPending || !onReject} onClick={() => onReject?.(proposal.id)}>Decline</button>}
    </div>}
  </article>;
}
function ProposalComposer({ detail, isPending, onPropose }: Pick<AgreementWorkspaceProps, 'detail' | 'onPropose'> & {
  readonly isPending: boolean;
}): ReactElement {
  const latest = detail.revisions.find(revision => revision.id === detail.agreement.currentRevisionId);
  const pending = detail.proposals.find(proposal => proposal.status === 'pending');
  const initialSource = pending?.replacementSource ?? latest?.source ?? null;
  const [source, setSource] = useState(initialSource);
  const [text, setText] = useState('');
  return <form className="ds-form" onSubmit={event => { event.preventDefault(); onPropose?.({ text, replacementSource: source, supersedesId: pending?.id ?? null }); }}>
    <h3 className="ds-title">
      {detail.allowedActions.includes('counter') ? 'Counter this proposal' : 'Propose a change'}
    </h3>
    <label className="ds-field">What would you like to change?<textarea className="ds-input" value={text} onChange={event => setText(event.target.value)} maxLength={10000} required placeholder="Explain the change for the other party."/>
    </label>
    {source ? <details className="ds-editor">
      <summary>Edit proposed wording</summary>
      <SourceEditor source={source} onChange={setSource}/>
    </details> : <p className="ds-muted">This agreement uses an uploaded PDF. Describe the requested change so the sender can prepare a replacement.</p>}
    <div className="ds-actions">
      <button className="ds-button" data-primary="true" disabled={isPending || !onPropose || !text.trim()} type="submit">
        {detail.allowedActions.includes('counter') ? 'Send counterproposal' : 'Send proposal'}
      </button>
      <span className="ds-muted">Shared with both parties</span>
    </div>
  </form>;
}
function TextComposer({ label, buttonLabel, placeholder, isPending, onSubmit }: {
  readonly label: string;
  readonly buttonLabel: string;
  readonly placeholder: string;
  readonly isPending: boolean;
  readonly onSubmit: ((body: string) => void) | undefined;
}): ReactElement {
  const [body, setBody] = useState('');
  return <form className="ds-form" onSubmit={event => { event.preventDefault(); onSubmit?.(body); }}>
    <label className="ds-field">
      {label}
      <textarea className="ds-input" value={body} onChange={event => setBody(event.target.value)} maxLength={10000} placeholder={placeholder} required/>
    </label>
    <div className="ds-actions">
      <button className="ds-button" type="submit" disabled={isPending || !onSubmit || !body.trim()}>
        {buttonLabel}
      </button>
    </div>
  </form>;
}
function DraftEditor({ draft, isPending, onSaveDraft }: {
  readonly draft: DocumentDraft;
  readonly isPending: boolean;
  readonly onSaveDraft: AgreementWorkspaceProps['onSaveDraft'];
}): ReactElement {
  const [source, setSource] = useState(draft.source);
  if (!source)
    return <p className="ds-muted">Replace uploaded PDFs through the host document upload.</p>;
  return <form className="ds-form" onSubmit={event => { event.preventDefault(); onSaveDraft?.({ ...draft, source }); }}>
    <SourceEditor source={source} onChange={setSource}/>
    <button className="ds-button" disabled={isPending || !onSaveDraft}>Save working draft</button>
  </form>;
}
function PublishReview({ canReview, isPending, onPublish }: {
  readonly canReview: boolean;
  readonly isPending: boolean;
  readonly onPublish: AgreementWorkspaceProps['onPublish'];
}): ReactElement {
  const [hasReviewed, setHasReviewed] = useState(false);
  return <div className="ds-publish-review ds-form">
    <label className="ds-checkbox">
      <input type="checkbox" checked={hasReviewed} disabled={isPending || !canReview} onChange={event => setHasReviewed(event.target.checked)}/>
      <span>I reviewed the full PDF and its signature fields.</span>
    </label>
    <div className="ds-actions">
      <button className="ds-button" data-primary="true" disabled={isPending || !canReview || !hasReviewed || !onPublish} onClick={() => { if (!isPending && canReview && hasReviewed) onPublish?.(); }}>Publish revision</button>
    </div>
  </div>;
}
function AiCandidate({ candidate, canAdopt, isPending, onAdoptAiCandidate }: {
  readonly candidate: ProposalAiCandidate;
  readonly canAdopt: boolean;
  readonly isPending: boolean;
  readonly onAdoptAiCandidate: AgreementWorkspaceProps['onAdoptAiCandidate'];
}): ReactElement {
  const statusCopy: Record<ProposalAiCandidate['status'], string> = {
    queued: 'Preparing suggested wording.', ready: 'Suggested wording', failed: 'Suggested wording could not be prepared.',
    uncertain: 'The suggestion outcome is unknown.', adopted: 'Proposal accepted into the private working draft.',
  };
  return <article className="ds-suggestion">
    <h3 className="ds-title">{statusCopy[candidate.status]}</h3>
    {candidate.suggestion && <>
      <p>{candidate.suggestion.summary}</p>
      <details className="ds-editor"><summary>Suggested document</summary><SourceText source={candidate.suggestion.source}/></details>
      {candidate.suggestion.questions.length > 0 && <div>
        <h4 className="ds-title">Questions to review</h4>
        <ul>{candidate.suggestion.questions.map((question, index) => <li key={`${candidate.id}-${index}`}>{question}</li>)}</ul>
      </div>}
    </>}
    {candidate.status === 'ready' && candidate.suggestion && canAdopt && <>
      <p className="ds-muted">Accepting the proposal adds this wording to a private working draft. Review the prepared PDF, then publish separately.</p>
      <button className="ds-button" disabled={isPending || !onAdoptAiCandidate} onClick={() => { if (!isPending) onAdoptAiCandidate?.(candidate.id); }}>Accept proposal and use this draft</button>
    </>}
  </article>;
}
/** Renders the server's agreement projection; callbacks submit commands and refresh it. */
export function AgreementWorkspace({ detail, documentUrl, isDraftPreview = false, isPending = false, error, onPropose, onAccept, onReject, onPublish, onSign, onDownload, onMessage, onAskAi, onSaveDraft, onAdoptAiCandidate }: AgreementWorkspaceProps): ReactElement {
  const headingId = useId();
  const aiHeadingId = useId();
  const aiDialogRef = useRef<HTMLDialogElement>(null);
  const [hasProposalComposer, setHasProposalComposer] = useState(false);
  const revision = detail.revisions.find(item => item.id === detail.agreement.currentRevisionId);
  const hasDraftPreview = isDraftPreview || detail.draft?.preparationStatus === 'preparing' || detail.draft?.preparationStatus === 'failed';
  const source = hasDraftPreview ? detail.draft?.source : revision?.source ?? detail.draft?.source;
  const url = safeDocumentUrl(hasDraftPreview && detail.draft?.preparationStatus !== 'ready' ? null : documentUrl);
  const previewDocument = hasDraftPreview ? detail.draft?.document : revision?.document;
  const canRespond = detail.allowedActions.some(action => ['propose', 'counter', 'accept', 'reject'].includes(action));
  const thread = [...detail.proposals.map(proposal => ({ kind: 'proposal' as const, item: proposal })), ...detail.messages.map(message => ({ kind: 'message' as const, item: message }))].sort((a, b) => a.item.createdAt.localeCompare(b.item.createdAt));
  return <div className="dripsign" aria-busy={isPending}>
    <header className="ds-header">
      <DripSignBrand />
      <span className="ds-muted">Agreement workspace</span>
    </header>
    <div className="ds-workspace-heading">
      <div>
        <span className="ds-eyebrow">
          {hasDraftPreview || !revision ? 'Private working draft' : `Revision ${revision.number}`}
        </span>
        <h1 className="ds-heading" id={headingId}>
          {detail.agreement.title}
        </h1>
        <p className="ds-subtitle">Review the document and agree on changes before signing.</p>
      </div>
      <div className="ds-actions">
        <span className="ds-badge" data-tone={detail.agreement.status === 'signed' ? 'green' : 'blue'}>
          {statusLabels[detail.agreement.status]}
        </span>
      </div>
    </div>
    {error && <div className="ds-alert" role="alert">
      {error}
    </div>}{isPending && <p className="ds-progress" role="status">Saving your request...</p>}
    <main className="ds-columns" aria-labelledby={headingId}>
      <section className="ds-panel" aria-label="Shared review thread">
        <header className="ds-panel-heading">
          <div>
            <h2 className="ds-title">Review chat</h2>
            <p className="ds-subtitle">Messages and proposed changes.</p>
          </div>
          <span className="ds-badge">Both parties</span>
        </header>
        {canRespond && <div className="ds-turn">
          <span className="ds-turn-mark" aria-hidden="true">↗</span>
          <div>
            <strong>Your turn</strong>
            <p className="ds-muted">
              {detail.allowedActions.includes('accept') ? 'Accept the proposal, counter with wording, or decline.' : 'Propose the changes you would like the other party to review.'}
            </p>
          </div>
        </div>}
        <div className="ds-thread">
          {thread.length === 0 ? <div className="ds-empty">No changes have been proposed. Review the document to begin.</div> : thread.map(entry => entry.kind === 'proposal' ? <ProposalCard key={`proposal-${entry.item.id}`} proposal={entry.item} detail={detail} isPending={isPending} onAccept={onAccept} onReject={onReject} onCounter={onPropose ? () => setHasProposalComposer(true) : undefined}/> : <article className="ds-message" key={`message-${entry.item.id}`}>
            <div className="ds-message-meta">
              <strong>
                {entry.item.authorKind === 'staff' ? 'Sender' : 'Recipient'}
              </strong>
              <time dateTime={entry.item.createdAt}>
                {entry.item.createdAt.slice(0, 10)}
              </time>
            </div>
            <p>
              {entry.item.body}
            </p>
          </article>)}
        </div>
        {(detail.allowedActions.includes('propose') || detail.allowedActions.includes('counter')) && <div className="ds-composer">
          {hasProposalComposer ? <ProposalComposer key={`${detail.agreement.id}-${detail.agreement.version}`} detail={detail} isPending={isPending} onPropose={onPropose}/> : <button className="ds-button" disabled={isPending || !onPropose} onClick={() => setHasProposalComposer(true)}>
            {detail.allowedActions.includes('counter') ? 'Write a counterproposal' : 'Propose a change'}
          </button>}
        </div>}{detail.allowedActions.includes('message') && <div className="ds-composer">
          <TextComposer key={`message-${detail.agreement.version}`} label="Message to the other party" buttonLabel="Send message" placeholder="Ask a question or add context." isPending={isPending} onSubmit={onMessage}/>
        </div>}
        <SigningPanel detail={detail} hasSigningDocument={Boolean(url && !hasDraftPreview && previewDocument?.sha256 === detail.signingRound?.documentSha256)} isPending={isPending} onSign={onSign} onDownload={onDownload}/>
        {(detail.allowedActions.includes('ask_ai') || detail.allowedActions.includes('adopt_ai_candidate') || detail.privateAiCandidates.length > 0 || detail.privateAiMessages.length > 0) && <>
          <div className="ds-disclosure"><button className="ds-button" onClick={() => aiDialogRef.current?.showModal()}>Private AI suggestions</button></div>
          <dialog className="ds-ai-drawer" ref={aiDialogRef} aria-labelledby={aiHeadingId}>
            <header className="ds-panel-heading"><h2 className="ds-title" id={aiHeadingId}>Private AI suggestions</h2><form method="dialog"><button className="ds-button">Close</button></form></header>
            <div className="ds-drawer-body">
              <p className="ds-muted">Staff only. Review wording, prepare the PDF, then publish separately.</p>
              {detail.privateAiCandidates.map(candidate => <AiCandidate key={candidate.id} candidate={candidate} canAdopt={detail.allowedActions.includes('adopt_ai_candidate') && candidate.revisionId === detail.agreement.currentRevisionId} isPending={isPending} onAdoptAiCandidate={onAdoptAiCandidate}/>)}
              {detail.privateAiMessages.map(message => <article className="ds-suggestion" key={message.id}>
                <span className="ds-eyebrow">
                  {message.role === 'assistant' ? 'Suggestion' : 'Your request'}
                </span>
                <p>
                  {message.body}
                </p>
              </article>)}
              {detail.allowedActions.includes('ask_ai') && <TextComposer key={`ai-${detail.privateAiMessages.length}`} label="Ask for a suggestion" buttonLabel="Get suggestion" placeholder="Describe the wording you want to review." isPending={isPending} onSubmit={onAskAi}/>}
            </div>
          </dialog>
        </>}
      </section>
      <section className="ds-panel" aria-label="Agreement document">
        <header className="ds-panel-heading">
          <h2 className="ds-title">{hasDraftPreview ? 'Working draft' : 'Document'}</h2>
          {url && <a className="ds-button" href={url} target="_blank" rel="noopener noreferrer">Open full PDF</a>}
        </header>
        {hasDraftPreview && detail.draft?.preparationStatus === 'preparing' && <p className="ds-document-note" role="status">Preparing the PDF.</p>}
        {hasDraftPreview && detail.draft?.preparationStatus === 'failed' && <p className="ds-document-note" role="alert">The PDF could not be prepared. Upload a replacement.</p>}
        {hasDraftPreview && detail.draft?.preparationStatus === 'empty' && <p className="ds-document-note">Upload a document to prepare a preview.</p>}
        {url ? <iframe className="ds-document-frame" src={url} title={`${detail.agreement.title} PDF`} sandbox=""/> : source ? <div className="ds-document">
          <SourceText source={source}/>
        </div> : <div className="ds-empty">{hasDraftPreview ? 'A PDF preview is not available yet.' : 'The document preview is unavailable. Ask the sender for the current PDF.'}</div>}
        <div className="ds-document-note">
          {hasDraftPreview || !revision ? 'Private draft. Review the PDF before publishing.' : 'Published revisions stay unchanged. Accepted changes update the working draft.'}
          {url && previewDocument && <details><summary>PDF fingerprint</summary><code className="ds-document-hash">{previewDocument.sha256}</code></details>}
        </div>
        {detail.allowedActions.includes('publish') && <PublishReview key={`${detail.agreement.id}-${detail.agreement.version}-${detail.draft?.document?.sha256}`} canReview={Boolean(hasDraftPreview && url && detail.draft?.document && detail.draft.preparationStatus === 'ready')} isPending={isPending} onPublish={onPublish}/>}
        {detail.allowedActions.includes('save_draft') && detail.draft && <details className="ds-disclosure">
          <summary>Working draft</summary>
          <p className="ds-muted">Review changes here before publishing a new revision.</p>
          <DraftEditor key={`${detail.agreement.id}-${detail.agreement.version}`} draft={detail.draft} isPending={isPending} onSaveDraft={onSaveDraft}/>
        </details>}
      </section>
    </main>
    <footer className="ds-footer">
      <span>DripSign</span>
      <span>Published versions and signature records stay with this agreement.</span>
    </footer>
  </div>;
}
function SigningPanel({ detail, hasSigningDocument, isPending, onSign, onDownload }: Pick<AgreementWorkspaceProps, 'detail' | 'onSign' | 'onDownload'> & {
  readonly hasSigningDocument: boolean;
  readonly isPending: boolean;
}): ReactElement | null {
  const round = detail.signingRound;
  if (!round && !detail.allowedActions.includes('sign') && !detail.allowedActions.includes('download'))
    return null;
  const revision = detail.revisions.find(item => item.id === round?.revisionId);
  const canSign = hasSigningDocument && detail.allowedActions.includes('sign') && round?.status === 'active' && revision
    && revision.id === detail.agreement.currentRevisionId && revision.document.sha256 === round.documentSha256
    && round.consentVersion === SIGNING_CONSENT_VERSION && round.consentText === SIGNING_CONSENT_TEXT && round.consentHash === SIGNING_CONSENT_HASH;
  const roundCopy: Record<NonNullable<AgreementDetail['signingRound']>['status'], string> = {
    active: 'Each required signer signs this version.', finalizing: 'All signatures recorded. Preparing the completed PDF.',
    completed: 'The signed PDF and audit record are ready.', void: 'This signing request is closed.',
  };
  return <section className="ds-signing" aria-label="Signatures">
    <h3 className="ds-title">
      {round?.status === 'completed' ? 'Agreement signed' : canSign ? 'Review and sign' : 'Signatures'}
    </h3>
    {round && <p>
      {roundCopy[round.status]}
    </p>}
    <ul className="ds-signer-list">
      {round?.signers.map(signer => {
        const signature = detail.signatures.find(item => item.roundId === round.id && item.grantId === signer.grantId);
        return <li key={signer.grantId}>
          <div><span>{signer.name || signer.email}</span>{signature && <div className="ds-signature-meta"><span>{signature.typedName}</span><time dateTime={signature.signedAt}>{signature.signedAt.slice(0, 10)}</time></div>}</div>
          <span className="ds-badge" data-tone={signature ? 'green' : 'blue'}>{signature ? 'Signed' : round.status === 'void' ? 'Not signed' : 'Awaiting signature'}</span>
        </li>;
      })}
    </ul>
    {detail.allowedActions.includes('sign') && !canSign && <p role="status">Signing is unavailable. Refresh the agreement.</p>}
    {canSign && round && revision && <SignatureForm key={`${round.id}-${revision.id}-${round.documentSha256}-${round.consentHash}`} revision={revision} isPending={isPending} onSign={onSign}/>}
    <div className="ds-actions">
      {detail.allowedActions.includes('download') && detail.artifacts.map(artifact => <button className="ds-button" key={artifact.id} disabled={isPending || !onDownload} onClick={() => onDownload?.(artifact.kind)}>
        {artifact.kind === 'signed_document' ? 'Download signed PDF' : 'Download audit record'}
      </button>)}
    </div>
  </section>;
}
function SignatureForm({ revision, isPending, onSign }: {
  readonly revision: Revision;
  readonly isPending: boolean;
  readonly onSign: AgreementWorkspaceProps['onSign'];
}): ReactElement {
  const [typedName, setTypedName] = useState('');
  const [hasConsented, setHasConsented] = useState(false);
  const name = typedName.trim();
  const canSubmit = !isPending && hasConsented && name.length > 0 && name.length <= 200 && Boolean(onSign);
  return <form className="ds-form ds-signature-form" onSubmit={event => { event.preventDefault(); if (canSubmit) onSign?.(name); }}>
    <p>Signing version {revision.number}. Review the full PDF before signing.</p>
    <label className="ds-field">Full name<input className="ds-input" value={typedName} autoComplete="name" minLength={1} maxLength={200} required disabled={isPending} onChange={event => setTypedName(event.target.value)}/></label>
    <label className="ds-checkbox"><input type="checkbox" checked={hasConsented} required disabled={isPending} onChange={event => setHasConsented(event.target.checked)}/><span>{SIGNING_CONSENT_TEXT}</span></label>
    <div className="ds-actions"><button className="ds-button" data-primary="true" type="submit" disabled={!canSubmit}>Sign version {revision.number}</button></div>
  </form>;
}
