import type { Metadata, Viewport } from "next";
import { Hind_Siliguri, Noto_Serif_Bengali } from "next/font/google";
import ChatWidget from "@/components/ChatWidget";
import HelpNudge from "@/components/HelpNudge";
import { StoreHeader, StoreBottom } from "@/components/shell/StoreChrome";
import { ToastProvider } from "@/components/ui/Toast";
import {
  SITE_URL, SITE_NAME, SITE_DESC, KEYWORDS, OG_IMAGE,
  organizationJsonLd, websiteJsonLd,
} from "@/lib/seo";
import "./globals.css";

const TITLE = `${SITE_NAME} — প্রিমিয়াম কাস্টমাইজড নিকাহনামা`;

// Bengali-first UI. Hind Siliguri renders Bengali well and is light.
const bengali = Hind_Siliguri({
  variable: "--font-bengali",
  subsets: ["bengali", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Elegant Bengali serif for headings (editorial feel). Kept light for 2G.
const display = Noto_Serif_Bengali({
  variable: "--font-display",
  subsets: ["bengali", "latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESC,
  keywords: KEYWORDS,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "bn_BD",
    siteName: SITE_NAME,
    url: SITE_URL,
    title: TITLE,
    description: SITE_DESC,
    images: [{ url: OG_IMAGE, width: 720, height: 720, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: SITE_DESC,
    images: [OG_IMAGE],
  },
  robots: { index: true, follow: true },
};

// Mobile-first: lock to device width, allow zoom for accessibility.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="bn" className={`${bengali.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd()) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd()) }}
        />
        <ToastProvider>
          <StoreHeader />
          <main className="flex-1 pb-20 sm:pb-0">{children}</main>
          <StoreBottom />
          <ChatWidget />
          <HelpNudge />
        </ToastProvider>
      </body>
    </html>
  );
}
