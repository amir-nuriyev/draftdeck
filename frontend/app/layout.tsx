import type { Metadata } from "next";
import { IBM_Plex_Mono, Source_Serif_4, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});

const editorial = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-editorial",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "DraftDeck",
  description: "Collaborative writing cockpit with staged drafts, realtime presence, and AI suggestions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${display.variable} ${editorial.variable} ${mono.variable}`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
