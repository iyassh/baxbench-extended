"use client";

import { cn } from "@/lib/utils";

interface ViewToggleProps {
  view: "table" | "chart";
  onToggle: (view: "table" | "chart") => void;
}

export function ViewToggle({ view, onToggle }: ViewToggleProps) {
  return (
    <div className="inline-flex items-center bg-zinc-800 rounded-lg p-0.5 border border-zinc-700">
      <button
        onClick={() => onToggle("table")}
        className={cn(
          "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
          view === "table"
            ? "bg-zinc-700 text-zinc-100 shadow-sm"
            : "text-zinc-500 hover:text-zinc-300"
        )}
      >
        Table
      </button>
      <button
        onClick={() => onToggle("chart")}
        className={cn(
          "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
          view === "chart"
            ? "bg-zinc-700 text-zinc-100 shadow-sm"
            : "text-zinc-500 hover:text-zinc-300"
        )}
      >
        Chart
      </button>
    </div>
  );
}
