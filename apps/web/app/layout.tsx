import type { Metadata, Viewport } from 'next';
import './globals.css';

const TITLE = 'IRONVOW — Forge. Muster. Conquer.';
const DESCRIPTION = 'A base builder with async raiding, fought on a server that cannot be talked into a lie.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'IRONVOW',
  manifest: '/manifest.webmanifest',
  icons: {
    // The SVG scales to any tab; the PNG is for the browsers that still will
    // not take a vector favicon.
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: { capable: true, title: 'IRONVOW', statusBarStyle: 'black-translucent' },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'IRONVOW',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'IRONVOW — Forge. Muster. Conquer.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#1b2432',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
