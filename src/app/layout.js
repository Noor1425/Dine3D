import '@/styles/globals.css';
import { Toaster } from 'sonner';
import ServiceWorkerManager from '@/components/offline/ServiceWorkerManager';
import RouteProgress from '@/components/ui/RouteProgress';

export const metadata = {
  /* Where a relative image in the metadata below resolves from.
   *
   * Without it Next falls back to localhost and says so on every render, and
   * any card shared to WhatsApp — which is how this product is actually sent
   * between people here — would point its preview image at a machine nobody
   * else can reach. */
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://dine3d.ai'),
  title: 'Dine3D — Restaurant Operating System',
  description: 'POS, kitchen, QR ordering, 3D menu, inventory and analytics in one system. Keeps selling when the internet does not. Pay for the orders you ring up.',
  keywords: ['restaurant POS', 'restaurant software', 'QR ordering', '3D menu', 'kitchen display system', 'restaurant inventory', 'restaurant analytics', 'offline POS'],
  // The service worker's own manifest stays where it is; this one is the
  // installable-app identity with the real brand icons.
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-96x96.png', type: 'image/png', sizes: '96x96' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    title: 'Dine3D — Restaurant Operating System',
    description: 'POS, kitchen, QR ordering, 3D menu, inventory and analytics in one system.',
    siteName: 'Dine3D',
    type: 'website',
    images: [{ url: '/images/brand/logo-512.png', width: 512, height: 512, alt: 'Dine3D' }],
  },
  twitter: {
    card: 'summary',
    title: 'Dine3D — Restaurant Operating System',
    description: 'POS, kitchen, QR ordering, 3D menu, inventory and analytics in one system.',
    images: ['/images/brand/logo-512.png'],
  },
};

export const viewport = {
  themeColor: '#FF6B35',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        {/* Answers "did my click register?" before the next page can. */}
        <RouteProgress />
        <Toaster richColors position="top-center" />
        <ServiceWorkerManager />
        {children}
      </body>
    </html>
  );
}
