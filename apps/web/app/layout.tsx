import type { Metadata } from 'next';
import '@fitcrew/ui/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'FitCrew',
  description: 'The operating system for coaching businesses.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
