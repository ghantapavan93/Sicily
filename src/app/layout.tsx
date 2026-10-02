import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });

export const metadata: Metadata = {
  title: "Savy Live Ops · A living simulation of one restaurant night",
  description:
    "An independent product exploration for OPSAVOR. Synthetic restaurant data. No real restaurant or OPSAVOR systems are connected.",
  // A demo with a restaurant's name in it should be shared by link, not found by search.
  robots: { index: false, follow: false },
  openGraph: {
    title: "Savy Live Ops",
    description: "Watch Savy read a restaurant night, plan it, survive broken data, wait for a person, and learn from what happened.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0b09",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
