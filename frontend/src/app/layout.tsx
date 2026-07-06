import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "../lib/auth-context";
import { ThemeProvider, THEME_INIT_SCRIPT } from "../lib/theme-context";

// Inter — the UI/interface typeface (labels, tables, controls).
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Newsreader — an editorial serif used sparingly for display headings only,
// giving the calm, premium, non-generic feel of the Anthropic/amplifyn refs.
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CommercePilot — AI Order Automation",
  description: "AI-powered WhatsApp order automation for e-commerce businesses",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
