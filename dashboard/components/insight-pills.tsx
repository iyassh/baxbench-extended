"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface InsightPill {
  text: string;
  type: "security" | "comparison" | "vulnerability";
  link?: string;
}

const typeStyles: Record<string, string> = {
  security: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  comparison: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  vulnerability: "bg-red-500/10 text-red-300 border-red-500/20",
};

function highlightNumbers(text: string): React.ReactNode {
  // Bold any number-like patterns (e.g., "67.3%", "12", "+5.2")
  const parts = text.split(/(\d+\.?\d*%?)/g);
  return parts.map((part, i) =>
    /\d/.test(part) ? (
      <span key={i} className="font-bold text-white">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export function InsightPills({ insights }: { insights: InsightPill[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {insights.map((insight, i) => {
        const content = (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              duration: 0.4,
              delay: 0.3 + i * 0.12,
              ease: "easeOut",
            }}
            className={cn(
              "rounded-full px-4 py-2 text-sm border",
              typeStyles[insight.type],
              insight.link && "hover:brightness-125 transition-all cursor-pointer"
            )}
          >
            {highlightNumbers(insight.text)}
          </motion.div>
        );

        if (insight.link) {
          return (
            <Link key={i} href={insight.link}>
              {content}
            </Link>
          );
        }

        return content;
      })}
    </div>
  );
}
