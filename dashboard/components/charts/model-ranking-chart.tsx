"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ModelRankingData {
  name: string;
  sec_pass_at_1: number;
  true_sec_pass_at_1: number;
  pass_at_1: number;
  total_cwes: number;
  family: string;
  thinking: boolean;
  functional_passes?: number;
  total_results?: number;
  secure_passes?: number;
}

interface SafetyRow {
  config_name: string;
  safety_prompt: string;
  total: number;
  functional_passes: number;
  secure_passes: number;
  truly_secure_passes: number;
}

interface ModelRankingChartProps {
  data: ModelRankingData[];
  safetyData?: SafetyRow[];
}

const familyColors: Record<string, { solid: string; light: string }> = {
  haiku: { solid: "#71717a", light: "#a1a1aa" },
  sonnet: { solid: "#3b82f6", light: "#60a5fa" },
  opus: { solid: "#8b5cf6", light: "#a78bfa" },
  deepseek: { solid: "#10b981", light: "#34d399" },
  llama: { solid: "#f59e0b", light: "#fbbf24" },
  mistral: { solid: "#ec4899", light: "#f472b6" },
  gemma: { solid: "#06b6d4", light: "#22d3ee" },
};

type SortKey = "sec_pass" | "true_sec" | "pass_at_1" | "sec_working" | "cwes" | "name";

function getBarColor(family: string, thinking: boolean): string {
  const colors = familyColors[family] || familyColors.haiku;
  return thinking ? colors.light : colors.solid;
}

type PromptFilter = "all" | "none" | "generic" | "specific";

export function ModelRankingChart({ data, safetyData }: ModelRankingChartProps) {
  const [sortBy, setSortBy] = useState<SortKey>("sec_pass");
  const [promptFilter, setPromptFilter] = useState<PromptFilter>("all");

  // When a prompt filter is active, recalculate metrics from safetyData
  const displayData = data.map((model) => {
    if (promptFilter === "all" || !safetyData) return model;

    const row = safetyData.find(
      (s) => s.config_name === model.name && s.safety_prompt === promptFilter
    );
    if (!row) return { ...model, sec_pass_at_1: 0, true_sec_pass_at_1: 0, pass_at_1: 0, total_cwes: 0, functional_passes: 0, secure_passes: 0 };

    return {
      ...model,
      sec_pass_at_1: row.total > 0 ? Math.round((row.secure_passes / row.total) * 1000) / 10 : 0,
      true_sec_pass_at_1: row.total > 0 ? Math.round((row.truly_secure_passes / row.total) * 1000) / 10 : 0,
      pass_at_1: row.total > 0 ? Math.round((row.functional_passes / row.total) * 1000) / 10 : 0,
      functional_passes: row.functional_passes,
      secure_passes: row.secure_passes,
      total_results: row.total,
    };
  });

  const sorted = [...displayData].sort((a, b) => {
    const aSecWorking = (a.functional_passes || 1) > 0 ? ((a.secure_passes || 0) / (a.functional_passes || 1)) : 0;
    const bSecWorking = (b.functional_passes || 1) > 0 ? ((b.secure_passes || 0) / (b.functional_passes || 1)) : 0;
    switch (sortBy) {
      case "sec_pass":
        return b.sec_pass_at_1 - a.sec_pass_at_1;
      case "true_sec":
        return b.true_sec_pass_at_1 - a.true_sec_pass_at_1;
      case "pass_at_1":
        return b.pass_at_1 - a.pass_at_1;
      case "sec_working":
        return bSecWorking - aSecWorking;
      case "cwes":
        return a.total_cwes - b.total_cwes; // fewer is better
      case "name":
        return a.name.localeCompare(b.name);
      default:
        return 0;
    }
  });

  const maxPassAt1 = Math.max(...data.map((d) => d.pass_at_1), 1);
  const maxSecPass = Math.max(...data.map((d) => d.sec_pass_at_1), 1);
  const maxCwes = Math.max(...data.map((d) => d.total_cwes), 1);

  const sortButtons: { key: SortKey; label: string }[] = [
    { key: "sec_pass", label: "sec_pass@1" },
    { key: "true_sec", label: "true_sec@1" },
    { key: "sec_working", label: "Secure (Working)" },
    { key: "pass_at_1", label: "pass@1" },
    { key: "cwes", label: "Fewest CWEs" },
    { key: "name", label: "Name" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
    >
      {/* Controls */}
      <div className="flex flex-col gap-3 mb-4">
        {/* Safety prompt filter */}
        {safetyData && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Safety Prompt:</span>
            {(["all", "none", "generic", "specific"] as PromptFilter[]).map((p) => (
              <button
                key={p}
                onClick={() => setPromptFilter(p)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                  promptFilter === p
                    ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
                )}
              >
                {p === "all" ? "All Combined" : p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        )}
        {/* Sort controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-zinc-500 uppercase tracking-wider">Sort by:</span>
          {sortButtons.map((btn) => (
            <button
              key={btn.key}
              onClick={() => setSortBy(btn.key)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                sortBy === btn.key
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
              )}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left py-2.5 px-2 text-xs text-zinc-500 font-medium uppercase tracking-wider w-[1%]">#</th>
              <th className="text-left py-2.5 px-2 text-xs text-zinc-500 font-medium uppercase tracking-wider">Model</th>
              <th className="text-center py-2.5 px-2 text-xs text-zinc-500 font-medium uppercase tracking-wider">Mode</th>
              <th className="text-right py-2.5 px-2 text-xs text-amber-400 font-medium uppercase tracking-wider">
                <span title="Functional pass AND no CWEs, divided by total tests">sec_pass@1</span>
              </th>
              <th className="text-right py-2.5 px-2 text-xs text-emerald-400 font-medium uppercase tracking-wider">
                <span title="sec_pass@1 but also requires zero security test exceptions">true_sec@1</span>
              </th>
              <th className="text-right py-2.5 px-2 text-xs text-purple-400 font-medium uppercase tracking-wider">
                <span title="Secure passes divided by functional passes only — excludes crashes">Sec (Working)</span>
              </th>
              <th className="text-right py-2.5 px-2 text-xs text-blue-400 font-medium uppercase tracking-wider">
                <span title="Functional pass rate — does the code work?">pass@1</span>
              </th>
              <th className="py-2.5 px-2 text-xs text-blue-400 font-medium uppercase tracking-wider text-center" style={{ minWidth: "120px" }}>
                pass@1 bar
              </th>
              <th className="text-right py-2.5 px-2 text-xs text-red-400 font-medium uppercase tracking-wider">
                <span title="Total CWE occurrences found">CWEs</span>
              </th>
              <th className="py-2.5 px-2 text-xs text-red-400 font-medium uppercase tracking-wider text-center" style={{ minWidth: "100px" }}>
                CWE bar
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((model, i) => {
              const barColor = getBarColor(model.family, model.thinking);
              const passBarWidth = (model.pass_at_1 / maxPassAt1) * 100;
              const cweBarWidth = (model.total_cwes / maxCwes) * 100;
              const secBarWidth = maxSecPass > 0 ? (model.sec_pass_at_1 / maxSecPass) * 100 : 0;

              return (
                <tr
                  key={model.name}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="py-2 px-2 text-zinc-600 text-xs tabular-nums">{i + 1}</td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: barColor }}
                      />
                      <span className="text-zinc-200 text-xs font-medium truncate max-w-[200px]">
                        {model.name}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full",
                        model.thinking
                          ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                          : "bg-zinc-800 text-zinc-500 border border-zinc-700"
                      )}
                    >
                      {model.thinking ? "think" : "std"}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-12 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-400 rounded-full"
                          style={{ width: `${secBarWidth}%` }}
                        />
                      </div>
                      <span className="text-amber-400 font-medium tabular-nums text-xs w-10 text-right">
                        {model.sec_pass_at_1.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right">
                    <span className={cn(
                      "font-medium tabular-nums text-xs",
                      model.true_sec_pass_at_1 > 0 ? "text-emerald-400" : "text-zinc-600"
                    )}>
                      {model.true_sec_pass_at_1.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right">
                    {(() => {
                      const fp = model.functional_passes || 0;
                      const sp = model.secure_passes || 0;
                      const secWorkingPct = fp > 0 ? (sp / fp * 100) : 0;
                      return (
                        <span className={cn(
                          "font-medium tabular-nums text-xs",
                          secWorkingPct > 0 ? "text-purple-400" : "text-zinc-600"
                        )}>
                          {secWorkingPct.toFixed(1)}%
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <span className="text-blue-400 font-medium tabular-nums text-xs">
                      {model.pass_at_1.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 px-2">
                    <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${passBarWidth}%`,
                          backgroundColor: barColor,
                        }}
                      />
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right">
                    <span className="text-red-400 font-medium tabular-nums text-xs">
                      {model.total_cwes}
                    </span>
                  </td>
                  <td className="py-2 px-2">
                    <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-400/70 rounded-full transition-all duration-500"
                        style={{ width: `${cweBarWidth}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-4 px-2 text-xs text-zinc-400">
        {Object.entries(familyColors).filter(([f]) => data.some(d => d.family === f)).map(([family, colors]) => (
          <div key={family} className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: colors.solid }}
              />
              <span className="capitalize">{family}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: colors.light }}
              />
              <span className="capitalize">{family} (thinking)</span>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
