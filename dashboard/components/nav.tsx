"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Shield, Command } from "lucide-react";

const links = [
  { href: "/", label: "Overview" },
  { href: "/models", label: "Models" },
  { href: "/vulnerabilities", label: "Vulnerabilities" },
  { href: "/compare", label: "Compare" },
  { href: "/pentest", label: "Pentest" },
  { href: "/results", label: "Results" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/50 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        {/* Left: Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 font-[family-name:var(--font-display)] font-bold text-lg tracking-tight"
        >
          <Shield className="h-5 w-5 text-emerald" />
          CodeStrike
        </Link>

        {/* Center: Nav links */}
        <nav className="flex items-center gap-1">
          {links.map((link) => {
            const isActive =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "relative px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-md bg-zinc-800/80"
                    transition={{
                      type: "spring",
                      stiffness: 380,
                      damping: 30,
                    }}
                  />
                )}
                <span className="relative z-10">{link.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right: Cmd+K */}
        <button
          className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-zinc-700 hover:text-foreground"
          onClick={() => {
            document.dispatchEvent(new CustomEvent("open-command-palette"));
          }}
        >
          <Command className="h-3 w-3" />
          <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] font-medium">
            K
          </kbd>
        </button>
      </div>
    </header>
  );
}
