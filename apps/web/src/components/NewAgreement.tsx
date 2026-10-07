'use client';
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

/** Creation saves a private draft; preparing, publishing, and sending remain explicit actions. */
export function NewAgreement(): ReactNode {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState([{ key: crypto.randomUUID(), name: '', email: '', requiredSigner: true }]);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setIsPending(true); setError(null);
    try {
      const response = await fetch('/api/agreements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        idempotencyKey, title, source: body.trim() ? { title, sections: [{ id: 'terms', heading: 'Terms', paragraphs: body.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean) }] } : null,
        recipients: recipients.map(({ name, email, requiredSigner }) => ({ name, email, requiredSigner })),
      }) });
      const value: unknown = await response.json();
      if (!response.ok || typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') { setError('The agreement could not be created. Check the parties and try again.'); return; }
      router.push(`/staff/agreements/${value.id}`);
    } catch { setError('The creation outcome is unknown. Retry the same form to recover the result.'); }
    finally { setIsPending(false); }
  }
  return <section className="create-panel"><h1>New agreement</h1><form className="stack" onSubmit={handleSubmit}>
    <label>Title<input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>Editable terms<textarea rows={8} maxLength={40000} placeholder="Write the terms, or leave this blank and upload a PDF after creating the draft." value={body} onChange={(event) => setBody(event.target.value)} /></label>
    {recipients.map((recipient) => <fieldset className="stack" key={recipient.key}><legend>Party</legend>
      <label>Name<input required maxLength={200} value={recipient.name} onChange={(event) => setRecipients((current) => current.map((item) => item.key === recipient.key ? { ...item, name: event.target.value } : item))} /></label>
      <label>Email<input required type="email" maxLength={320} value={recipient.email} onChange={(event) => setRecipients((current) => current.map((item) => item.key === recipient.key ? { ...item, email: event.target.value } : item))} /></label>
      <label><input type="checkbox" checked={recipient.requiredSigner} onChange={(event) => setRecipients((current) => current.map((item) => item.key === recipient.key ? { ...item, requiredSigner: event.target.checked } : item))} />Required signer</label>
      {recipients.length > 1 && <button type="button" className="secondary" onClick={() => setRecipients((current) => current.filter((item) => item.key !== recipient.key))}>Remove party</button>}
    </fieldset>)}
    {recipients.length < 10 && <button type="button" className="secondary" onClick={() => setRecipients((current) => [...current, { key: crypto.randomUUID(), name: '', email: '', requiredSigner: true }])}>Add party</button>}
    {error && <p className="error" role="alert">{error}</p>}
    <button className="primary" disabled={isPending}>{isPending ? 'Saving…' : 'Create private draft'}</button>
  </form></section>;
}
