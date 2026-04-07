"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  accent?: "emerald" | "red" | "amber" | "blue" | "purple" | "green";
  miniChart?: React.ReactNode;
}

const accentConfig: Record<
  string,
  { text: string; glow: string; border: string }
> = {
  emerald: {
    text: "text-emerald-400",
    glow: "glow-emerald",
    border: "border-emerald-800/50",
  },
  green: {
    text: "text-green-400",
    glow: "glow-green",
    border: "border-green-800/50",
  },
  red: {
    text: "text-red-400",
    glow: "glow-red",
    border: "border-red-800/50",
  },
  amber: {
    text: "text-amber-400",
    glow: "glow-amber",
    border: "border-amber-800/50",
  },
  blue: {
    text: "text-blue-400",
    glow: "glow-blue",
    border: "border-blue-800/50",
  },
  purple: {
    text: "text-purple-400",
    glow: "glow-purple",
    border: "border-purple-800/50",
  },
};

function AnimatedNumber({ value }: { value: number }) {
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (v) =>
    Number.isInteger(value) ? Math.round(v) : v.toFixed(1)
  );
  const displayRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: 1.2,
      ease: "easeOut",
    });
    return () => controls.stop();
  }, [motionValue, value]);

  useEffect(() => {
    const unsubscribe = rounded.on("change", (v) => {
      if (displayRef.current) {
        displayRef.current.textContent = String(v);
      }
    });
    return unsubscribe;
  }, [rounded]);

  return <span ref={displayRef}>0</span>;
}

export function StatCard({
  title,
  value,
  subtitle,
  accent = "emerald",
  miniChart,
}: StatCardProps) {
  const isAnimatable = typeof value === "number" && !String(value).includes("%");
  const isLongString = typeof value === "string" && value.length > 16;
  const config = accentConfig[accent] || accentConfig.emerald;
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className={cn(
        "bg-card border border-border rounded-xl p-6 transition-all duration-200",
        hovered && config.glow,
        hovered && config.border
      )}
    >
      <p className="text-sm text-zinc-400 uppercase tracking-wider">{title}</p>
      <div
        className={cn(
          "font-bold tabular-nums mt-2",
          isLongString ? "text-lg truncate" : "text-3xl",
          config.text
        )}
        title={typeof value === "string" ? value : undefined}
      >
        {isAnimatable ? <AnimatedNumber value={value as number} /> : value}
      </div>
      {subtitle && <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>}
      {miniChart && <div className="mt-3">{miniChart}</div>}
    </motion.div>
  );
}
