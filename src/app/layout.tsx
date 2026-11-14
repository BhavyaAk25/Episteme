import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ErrorReporter } from "@/components/shared/ErrorReporter";

// Fonts ship with the app (variable woff2 from Fontsource, SIL OFL), so
// builds never depend on downloading them from Google.
const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-jetbrains-mono",
  weight: "100 800",
  display: "swap",
});

const ibmPlexSans = localFont({
  src: "./fonts/ibm-plex-sans-latin-wght-normal.woff2",
  variable: "--font-ibm-plex-sans",
  weight: "100 700",
  display: "swap",
});

const sora = localFont({
  src: "./fonts/sora-latin-wght-normal.woff2",
  variable: "--font-sora",
  weight: "100 800",
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
    // Font variables live on <html> so the theme's --font-sans etc. (defined
    // at :root) can resolve them.
    <html lang="en" suppressHydrationWarning className={`${jetbrainsMono.variable} ${ibmPlexSans.variable} ${sora.variable}`}>
      <head>
        {/* Apply a saved light/dark choice before first paint (no flash). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("episteme-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body className="antialiased">
        {children}
        <ErrorReporter />
        {/* Free, cookie-free Vercel Web Analytics (served by Vercel; enable it in the project's Analytics tab). */}
        {process.env.NODE_ENV === "production" && <script defer src="/_vercel/insights/script.js" />}
      </body>
    </html>
  );
}
