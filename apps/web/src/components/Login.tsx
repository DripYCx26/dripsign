'use client';

import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

type Props = { readonly kind: 'staff' | 'recipient'; readonly agreementId?: string };

/** Email proof creates an HttpOnly session; the browser never receives its credential. */
export function Login({ kind, agreementId }: Props): ReactNode {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsPending(true); setError(null);
    try {
      const response = await fetch(`/api/auth/${challengeId ? 'verify' : 'request'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(challengeId ? { challengeId, code } : { email, kind, ...(agreementId ? { agreementId } : {}) }),
      });
      const value: unknown = await response.json();
      if (!response.ok) {
        const isPaused = response.status === 503 && typeof value === 'object' && value !== null
          && 'error' in value && value.error === 'admission_paused';
        setError(isPaused ? 'Email codes are temporarily paused. Try again after the service resumes.' : 'Sign-in could not be completed. Check your code and try again.');
        return;
      }
      if (challengeId) { router.refresh(); return; }
      if (typeof value === 'object' && value !== null && 'challengeId' in value && typeof value.challengeId === 'string') {
        setChallengeId(value.challengeId);
      } else { setError('Sign-in is unavailable. Try again shortly.'); }
    } catch { setError('Sign-in is unavailable. Try again shortly.'); }
    finally { setIsPending(false); }
  }
  return <section className="login">
    <h1>{kind === 'staff' ? 'Staff sign in' : 'Your agreements'}</h1>
    <p className="notice">{challengeId ? 'Code expires in 10 minutes.' : 'Enter the email we invited.'}</p>
    <form className="stack" onSubmit={handleSubmit}>
      <label>Email<input type="email" autoComplete="email" required maxLength={320} value={email} disabled={Boolean(challengeId)} onChange={(event) => setEmail(event.target.value)} /></label>
      {challengeId && <label>Email code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} /></label>}
      {error && <p role="alert" className="error">{error}</p>}
      <button className="primary" disabled={isPending}>{isPending ? 'Please wait…' : challengeId ? 'Continue' : 'Email a code'}</button>
      {challengeId && <button type="button" className="secondary" disabled={isPending} onClick={() => { setChallengeId(null); setCode(''); }}>Use another email</button>}
    </form>
  </section>;
}
