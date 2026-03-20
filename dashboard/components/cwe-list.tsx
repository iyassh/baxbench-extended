"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CweWithStats } from "@/lib/types";

interface CweListProps {
  cwes: CweWithStats[];
}

type FilterType = "all" | "original" | "extended";
type SortType = "occurrences" | "affected" | "number";

function PillToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-full text-xs font-medium transition-colors",
        active
          ? "bg-zinc-700 text-zinc-100"
          : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
      )}
    >
      {label}
    </button>
  );
}

function CweCard({
  cwe,
  maxOccurrences,
}: {
  cwe: CweWithStats;
  maxOccurrences: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const barWidth = maxOccurrences > 0 ? (cwe.occurrence_count / maxOccurrences) * 100 : 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900 border border-zinc-800 rounded-lg hover:border-zinc-700 transition-colors"
    >
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full text-left px-4 py-3 flex items-center gap-3"
      >
        {/* CWE number badge */}
        <span className="bg-red-500/10 text-red-400 rounded-md px-2 py-0.5 text-xs font-mono shrink-0">
          CWE-{cwe.num}
        </span>

        {/* CWE name */}
        <span className="font-medium text-sm text-zinc-200 truncate min-w-0 flex-1">
          {cwe.name}
        </span>

        {/* Original/Extended badge */}
        <span
          className={cn(
            "text-xs shrink-0 px-2 py-0.5 rounded-full",
            cwe.is_extended
              ? "bg-blue-500/10 text-blue-400"
              : "bg-amber-500/10 text-amber-400"
          )}
        >
          {cwe.is_extended ? "Extended" : "Original"}
        </span>

        {/* Occurrence count */}
        <span className="text-sm tabular-nums text-zinc-300 shrink-0 w-12 text-right">
          {cwe.occurrence_count}
        </span>

        {/* Occurrence bar */}
        <div className="w-24 shrink-0 hidden sm:block">
          <div className="h-2 bg-red-500/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-red-500 rounded-full transition-all duration-500"
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>

        {/* Worst/Best labels */}
        <div className="hidden lg:flex flex-col items-end shrink-0 w-40">
          <span className="text-xs text-zinc-500 truncate max-w-full">
            Worst: {cwe.worst_config}
          </span>
          <span className="text-xs text-zinc-500 truncate max-w-full">
            Best: {cwe.best_config}
          </span>
        </div>

        {/* Chevron */}
        <ChevronDown
          className={cn(
            "h-4 w-4 text-zinc-500 transition-transform shrink-0",
            expanded && "rotate-180"
          )}
        />
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-zinc-800">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                <div>
                  <p className="text-xs text-zinc-500 mb-1">Worst Model</p>
                  <p className="text-sm text-red-400 font-medium">
                    {cwe.worst_config}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-1">Best Model</p>
                  <p className="text-sm text-emerald-400 font-medium">
                    {cwe.best_config}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-4">
                <p className="text-xs text-zinc-500">
                  Occurrence rate:{" "}
                  <span className="text-zinc-300 tabular-nums">
                    {(cwe.occurrence_rate * 100).toFixed(1)}%
                  </span>
                </p>
                <a
                  href={`https://cwe.mitre.org/data/definitions/${cwe.num}.html`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  View on MITRE
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function CweList({ cwes }: CweListProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortType>("occurrences");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let result = [...cwes];

    // Filter by type
    if (filter === "original") {
      result = result.filter((c) => !c.is_extended);
    } else if (filter === "extended") {
      result = result.filter((c) => c.is_extended);
    }

    // Filter by search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          String(c.num).includes(q) ||
          `cwe-${c.num}`.includes(q)
      );
    }

    // Sort
    if (sort === "occurrences") {
      result.sort((a, b) => b.occurrence_count - a.occurrence_count);
    } else if (sort === "affected") {
      // Sort by worst_config occurrence rate descending as proxy for affected models
      result.sort((a, b) => b.occurrence_rate - a.occurrence_rate);
    } else if (sort === "number") {
      result.sort((a, b) => a.num - b.num);
    }

    return result;
  }, [cwes, filter, sort, search]);

  const maxOccurrences = Math.max(...cwes.map((c) => c.occurrence_count), 1);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        {/* Type pills */}
        <div className="flex items-center gap-1.5">
          <PillToggle
            label="All"
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <PillToggle
            label="Original"
            active={filter === "original"}
            onClick={() => setFilter("original")}
          />
          <PillToggle
            label="Extended"
            active={filter === "extended"}
            onClick={() => setFilter("extended")}
          />
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-500">Sort:</span>
          <PillToggle
            label="Occurrences"
            active={sort === "occurrences"}
            onClick={() => setSort("occurrences")}
          />
          <PillToggle
            label="Rate"
            active={sort === "affected"}
            onClick={() => setSort("affected")}
          />
          <PillToggle
            label="CWE #"
            active={sort === "number"}
            onClick={() => setSort("number")}
          />
        </div>

        {/* Search */}
        <div className="sm:ml-auto w-full sm:w-auto">
          <input
            type="text"
            placeholder="Search CWEs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-56 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors"
          />
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-zinc-500">
        {filtered.length} {filtered.length === 1 ? "vulnerability" : "vulnerabilities"} found
      </p>

      {/* CWE list */}
      <div className="space-y-2">
        {filtered.map((cwe) => (
          <CweCard key={cwe.num} cwe={cwe} maxOccurrences={maxOccurrences} />
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-zinc-500 text-sm">
            No vulnerabilities match your filters.
          </div>
        )}
      </div>
    </div>
  );
}
