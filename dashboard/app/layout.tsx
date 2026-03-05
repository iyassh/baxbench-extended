import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BaxBench Security Dashboard",
  description: "Visualize BaxBench benchmark results with full drill-down detail",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Nav />
        <main className="container mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
