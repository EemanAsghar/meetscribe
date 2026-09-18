import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: { default: "Meetscribe", template: "%s · Meetscribe" },
  description: "AI meeting notes you can correct, question and trust. Notes that change the summary, answers cited to the moment they were said, and no silent recording.",
  metadataBase: new URL("https://meetscribe-three.vercel.app"),
  openGraph: { title: "Meetscribe", description: "Meeting notes you can correct, question and trust.", type: "website", siteName: "Meetscribe" },
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
