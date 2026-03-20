import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { PageTransition } from "@/components/page-transition";
import { CommandPalette, type SearchItem } from "@/components/command-palette";
import { cn } from "@/lib/utils";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "BaxBench Security Dashboard",
  description: "Visualize BaxBench benchmark results with full drill-down detail",
};

const searchItems: SearchItem[] = [
  { type: "model", label: "haiku-4.5-standard", href: "/models?selected=haiku-4.5-standard", subtitle: "Haiku 4.5" },
  { type: "model", label: "opus-4.6-standard", href: "/models?selected=opus-4.6-standard", subtitle: "Opus 4.6" },
  { type: "scenario", label: "Calculator", href: "/models?scenario=Calculator" },
  { type: "scenario", label: "Login", href: "/models?scenario=Login" },
  { type: "cwe", label: "CWE-79: XSS", href: "/vulnerabilities?cwe=79" },
  { type: "cwe", label: "CWE-89: SQL Injection", href: "/vulnerabilities?cwe=89" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={cn(
          inter.variable,
          spaceGrotesk.variable,
          jetbrainsMono.variable,
          "bg-background text-foreground antialiased"
        )}
      >
        <Nav />
        <CommandPalette items={searchItems} />
        <main className="container mx-auto px-4 py-6">
          <PageTransition>{children}</PageTransition>
        </main>
      </body>
    </html>
  );
}
