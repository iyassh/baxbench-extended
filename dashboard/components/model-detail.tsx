"use client";

import { useState } from "react";
import type { ConfigWithStats, RadarDataPoint, ResultWithCwes } from "@/lib/types";
import { RadarChart } from "@/components/charts/radar-chart";
import { ResultDeepDive } from "@/components/result-deep-dive";
import { cn } from "@/lib/utils";

interface ModelDetailProps {
  config: ConfigWithStats;
  radarData: RadarDataPoint[];
  results: ResultWithCwes[];
  onClose: () => void;
}

function getFamily(name: string): string {
  if (name.includes("opus")) return "Opus";
  if (name.includes("sonnet")) return "Sonnet";
  if (name.includes("haiku")) return "Haiku";
  if (name.includes("deepseek")) return "DeepSeek";
  if (name.includes("llama")) return "Llama";
  return "Unknown";
}

const familyDotColor: Record<string, string> = {
  Haiku: "bg-zinc-400",
  Sonnet: "bg-blue-400",
  Opus: "bg-purple-400",
  DeepSeek: "bg-green-400",
  Llama: "bg-orange-400",
  Unknown: "bg-zinc-500",
};

interface MiniStatProps {
  label: string;
  value: string;
  accent: string;
}

function MiniStat({ label, value, accent }: MiniStatProps) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
        {label}
      </p>
      <p className={cn("text-lg font-bold tabular-nums mt-1", accent)}>
        {value}
      </p>
    </div>
  );
}

export function ModelDetail({
  config,
  radarData,
  results,
  onClose: _onClose,
}: ModelDetailProps) {
  const [selectedResult, setSelectedResult] = useState<ResultWithCwes | null>(null);
  const family = getFamily(config.name);
  const secPass = Math.round(config.sec_pass_at_1 * 1000) / 10;
  const trueSecPass = Math.round((config.true_sec_pass_at_1 || 0) * 1000) / 10;
  const passAt1 = Math.round(config.pass_at_1 * 1000) / 10;
  const secureByCrash = config.secure_by_crash || 0;

  // Top CWEs
  const cweCount: Record<number, { num: number; desc: string; count: number }> =
    {};
  for (const r of results) {
    for (const cwe of r.cwes) {
      if (!cweCount[cwe.cwe_num]) {
        cweCount[cwe.cwe_num] = {
          num: cwe.cwe_num,
          desc: cwe.cwe_desc,
          count: 0,
        };
      }
      cweCount[cwe.cwe_num].count++;
    }
  }
  const topCwes = Object.values(cweCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const maxCweCount = topCwes.length > 0 ? topCwes[0].count : 1;

  // If a result is selected, show the deep-dive
  if (selectedResult) {
    return (
      <ResultDeepDive
        result={selectedResult}
        configName={config.name}
        onClose={() => setSelectedResult(null)}
      />
    );
  }

  // Sort results for the table
  const sortedResults = [...results].sort((a, b) => {
    const scenarioCmp = a.scenario.localeCompare(b.scenario);
    if (scenarioCmp !== 0) return scenarioCmp;
    const fwCmp = a.framework.localeCompare(b.framework);
    if (fwCmp !== 0) return fwCmp;
    return a.safety_prompt.localeCompare(b.safety_prompt);
  });

  // Group by scenario for visual separation
  let lastScenario = "";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-zinc-100">{config.name}</h2>
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block w-2 h-2 rounded-full ${familyDotColor[family]}`}
            />
            <span className="text-xs text-zinc-400">{family}</span>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
              config.thinking
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700"
            }`}
          >
            {config.thinking ? "thinking" : "standard"}
          </span>
        </div>
        <p className="text-sm text-zinc-500 mt-1">
          Model ID: {config.model_id}
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <MiniStat
          label="pass@1"
          value={`${passAt1.toFixed(1)}%`}
          accent="text-blue-400"
        />
        <MiniStat
          label="sec_pass@1"
          value={`${secPass.toFixed(1)}%`}
          accent={
            secPass >= 80
              ? "text-emerald-400"
              : secPass >= 50
                ? "text-amber-400"
                : "text-red-400"
          }
        />
        <MiniStat
          label="true_sec@1"
          value={`${trueSecPass.toFixed(1)}%`}
          accent={
            trueSecPass >= 80
              ? "text-emerald-400"
              : trueSecPass >= 50
                ? "text-amber-400"
                : "text-red-400"
          }
        />
        <MiniStat
          label="Total CWEs"
          value={String(config.total_cwes)}
          accent="text-red-400"
        />
        <MiniStat
          label="Secure by Crash"
          value={String(secureByCrash)}
          accent="text-amber-400"
        />
      </div>

      {/* Radar chart */}
      {radarData.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
            Performance Radar
          </p>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <RadarChart data={radarData} />
          </div>
        </div>
      )}

      {/* Top Vulnerabilities */}
      {topCwes.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
            Top Vulnerabilities
          </p>
          <div className="space-y-2">
            {topCwes.map((cwe) => (
              <div
                key={cwe.num}
                className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2"
              >
                <span className="text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5 shrink-0">
                  CWE-{cwe.num}
                </span>
                <span className="text-xs text-zinc-400 truncate flex-1">
                  {cwe.desc}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-400 rounded-full"
                      style={{
                        width: `${(cwe.count / maxCweCount) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-zinc-300 tabular-nums w-6 text-right">
                    {cwe.count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results — individual rows */}
      {sortedResults.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
            All Results
            <span className="text-zinc-600 ml-2">
              Click a row to inspect
            </span>
          </p>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left text-xs text-zinc-500 font-medium px-3 py-2">
                    Scenario
                  </th>
                  <th className="text-left text-xs text-zinc-500 font-medium px-3 py-2">
                    Framework
                  </th>
                  <th className="text-left text-xs text-zinc-500 font-medium px-3 py-2">
                    Safety
                  </th>
                  <th className="text-right text-xs text-zinc-500 font-medium px-3 py-2">
                    Func
                  </th>
                  <th className="text-right text-xs text-zinc-500 font-medium px-3 py-2">
                    Sec
                  </th>
                  <th className="text-right text-xs text-zinc-500 font-medium px-3 py-2">
                    CWEs
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((r) => {
                  const showScenario = r.scenario !== lastScenario;
                  lastScenario = r.scenario;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedResult(r)}
                      className={cn(
                        "border-b border-zinc-800/50 last:border-0 cursor-pointer hover:bg-zinc-800/40 transition-colors",
                        showScenario && "border-t border-zinc-700/50"
                      )}
                    >
                      <td className="px-3 py-1.5 text-zinc-300 text-xs truncate max-w-[140px]">
                        {showScenario ? r.scenario : ""}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-zinc-500 font-mono">
                        {r.framework.replace("JavaScript-", "").replace("Python-", "").replace("Go-", "")}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-zinc-600">
                        {r.safety_prompt}
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs tabular-nums">
                        <span
                          className={
                            r.functional_pass
                              ? "text-emerald-400"
                              : "text-red-400"
                          }
                        >
                          {r.num_passed_ft}/{r.num_total_ft}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs">
                        {r.functional_pass && r.cwes.length === 0 ? (
                          <span className="text-emerald-400">pass</span>
                        ) : (
                          <span className="text-red-400">fail</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs tabular-nums">
                        {r.cwes.length > 0 ? (
                          <span className="text-red-400">{r.cwes.length}</span>
                        ) : (
                          <span className="text-zinc-600">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
