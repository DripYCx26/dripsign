import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@dripsign/ui/styles.css';
import './styles.css';

export const metadata: Metadata = {
  title: 'DripSign',
  description: 'Review, agree, and sign your documents.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }): ReactNode {
  return <html lang="en"><body>{children}</body></html>;
}
