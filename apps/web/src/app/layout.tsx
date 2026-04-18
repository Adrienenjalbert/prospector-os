import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL)
    : undefined,
  title: {
    default: "Prospector OS",
    template: "%s — Prospector OS",
  },
  description: "Sales intelligence — cut the noise, surface the signal.",
  applicationName: "Prospector OS",
  openGraph: {
    title: "Prospector OS",
    description:
      "A multi-tenant Sales Operating System. Turn your CRM, calls, and context into one self-improving research engine.",
    type: "website",
    siteName: "Prospector OS",
  },
  twitter: {
    card: "summary",
    title: "Prospector OS",
    description: "Sales intelligence — cut the noise, surface the signal.",
  },
  // Robots default — keep the dashboard out of search indexes; per-route
  // metadata can override for marketing pages if/when they ship.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-950 font-sans text-zinc-100">
        {children}
      </body>
    </html>
  );
}
