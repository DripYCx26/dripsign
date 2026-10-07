'use client';
import type { ReactNode } from 'react';

export default function ErrorPage({ reset }: { readonly reset: () => void }): ReactNode {
  return <main className="login"><h1>This page is unavailable</h1><p>The agreement could not be read. Try again shortly.</p><button className="primary" onClick={reset}>Try again</button></main>;
}
