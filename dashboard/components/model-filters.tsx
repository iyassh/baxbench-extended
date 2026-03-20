"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";

export interface ModelFilterState {
  family: string;
  mode: string;
  sort: string;
}

interface ModelFiltersProps {
  onFilterChange: (filters: ModelFilterState) => void;
}

const families = ["All", "Haiku", "Sonnet", "Opus"];
const modes = ["All", "Standard", "Thinking"];
const sortOptions = [
  { value: "sec_pass_at_1", label: "sec_pass@1" },
  { value: "pass_at_1", label: "pass@1" },
  { value: "total_cwes", label: "CWE count" },
  { value: "name", label: "Name" },
];

function Pill({
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
        "rounded-full px-4 py-1.5 text-sm border transition-colors",
        active
          ? "bg-zinc-700 border-zinc-600 text-white"
          : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
      )}
    >
      {label}
    </button>
  );
}

export function ModelFilters({ onFilterChange }: ModelFiltersProps) {
  const [family, setFamily] = useState("All");
  const [mode, setMode] = useState("All");
  const [sort, setSort] = useState("sec_pass_at_1");

  const handleFamilyChange = useCallback(
    (f: string) => {
      setFamily(f);
      onFilterChange({ family: f, mode, sort });
    },
    [mode, sort, onFilterChange]
  );

  const handleModeChange = useCallback(
    (m: string) => {
      setMode(m);
      onFilterChange({ family, mode: m, sort });
    },
    [family, sort, onFilterChange]
  );

  const handleSortChange = useCallback(
    (s: string) => {
      setSort(s);
      onFilterChange({ family, mode, sort: s });
    },
    [family, mode, onFilterChange]
  );

  return (
    <div className="flex flex-wrap items-end gap-6">
      {/* Family filter */}
      <div>
        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
          Family
        </p>
        <div className="flex flex-wrap gap-2">
          {families.map((f) => (
            <Pill
              key={f}
              label={f}
              active={family === f}
              onClick={() => handleFamilyChange(f)}
            />
          ))}
        </div>
      </div>

      {/* Mode filter */}
      <div>
        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
          Mode
        </p>
        <div className="flex flex-wrap gap-2">
          {modes.map((m) => (
            <Pill
              key={m}
              label={m}
              active={mode === m}
              onClick={() => handleModeChange(m)}
            />
          ))}
        </div>
      </div>

      {/* Sort */}
      <div>
        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
          Sort by
        </p>
        <div className="flex flex-wrap gap-2">
          {sortOptions.map((opt) => (
            <Pill
              key={opt.value}
              label={opt.label}
              active={sort === opt.value}
              onClick={() => handleSortChange(opt.value)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
