import type { Metadata } from "next";
import { JetBrains_Mono, IBM_Plex_Sans, Sora } from "next/font/google";
import "./globals.css";
import { ErrorReporter } from "@/components/shared/ErrorReporter";

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
  title: "Episteme — AI database designer",
  description: "Design databases from plain English: an editable ERD with real Postgres verification, AI edits, and exports to SQL, Prisma and Drizzle.",
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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply a saved light/dark choice before first paint (no flash). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("episteme-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body
        className={`${jetbrainsMono.variable} ${ibmPlexSans.variable} ${sora.variable} antialiased`}
      >
        {children}
        <ErrorReporter />
        {/* Free, cookie-free Vercel Web Analytics (served by Vercel; enable it in the project's Analytics tab). */}
        {process.env.NODE_ENV === "production" && <script defer src="/_vercel/insights/script.js" />}
      </body>
    </html>
  );
}
