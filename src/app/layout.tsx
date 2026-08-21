// The product shell's chrome (prompt 2 5B.4): the Verin wordmark (the trailing period is brand -
// main:src/app/presentation/brand.tsx:5-7) and the navigation frame, over the ported tokens. Geist is
// self-hosted through next/font/local; next/font/google is forbidden because it fetches at build time.
import "./globals.css";
import localFont from "next/font/local";
import type { ReactNode } from "react";

export const runtime = "nodejs";
const geist = localFont({ src: "./fonts/GeistVF.woff2", variable: "--font-geist-sans" });
export const metadata = { title: "Verin", description: "The governed decision and execution layer for advisory firms." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={geist.variable}>
      <body>
        <header className="chrome">
          <span className="wordmark">Verin.</span>
          <nav aria-label="Primary" style={{ display: "flex", gap: "1rem" }}>
            <a href="/">Households</a>
            <a href="/policy">Firm policy</a>
            <a href="/conformance">Conformance</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
