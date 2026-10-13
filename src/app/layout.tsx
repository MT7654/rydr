import type { Metadata } from 'next';
import './globals.css';
import './product-design.css';
import { AppHeader } from '@/components/AppHeader';
import { getDemoSession } from '@/lib/demoSession';
import { DraftSessionProvider } from '@/components/workspace/DraftForm';
import { CapabilityNote } from '@/components/CapabilityNote';

const DESCRIPTION =
  'Rydr reconstructs disputed rides from timestamped evidence, gives rider and driver separate advocates, applies explicit policy and produces a traceable resolution.';

export const metadata: Metadata = {
  title: 'Rydr — Ride disputes, resolved.',
  description: DESCRIPTION,
  icons: {
    icon: '/brand/app-icon.jpg',
    apple: '/brand/app-icon.jpg',
  },
  openGraph: {
    title: 'Rydr — Ride disputes, resolved.',
    description: DESCRIPTION,
    type: 'website',
    images: [
      {
        url: '/brand/og-cover.jpg',
        width: 1216,
        height: 640,
        alt: 'An illustrated city skyline with a teal route line rising across it.',
      },
    ],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session=await getDemoSession();
  return (
    <html lang="en">
      <body>
        <AppHeader />
        <DraftSessionProvider scope={session??''}>{children}</DraftSessionProvider>
        <div className="container">
          <div className="footer-note"><CapabilityNote /></div>
        </div>
      </body>
    </html>
  );
}

