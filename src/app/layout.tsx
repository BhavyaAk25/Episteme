import type { Metadata } from "next";
import { JetBrains_Mono, IBM_Plex_Sans, Sora } from "next/font/google";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Episteme — AI-Powered Database System Builder",
  description: "Turn plain-English requirements into verified database systems with Gemini 3",
  keywords: ["database", "schema", "ontology", "ERD", "Gemini", "AI"],
  icons: {
    icon: [
      { url: "/brand/episteme-mark.svg", type: "image/svg+xml" },
      { url: "/brand/episteme-mark-32.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: ["/brand/episteme-mark.svg"],
    apple: [{ url: "/brand/episteme-mark.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${jetbrainsMono.variable} ${ibmPlexSans.variable} ${sora.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
