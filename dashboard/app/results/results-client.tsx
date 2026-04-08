"use client";

import { useState, useMemo } from "react";
import type { ConfigWithStats, ResultWithCwes } from "@/lib/types";
import { PromptTab } from "@/components/deep-dive/prompt-tab";
import { CodeTab } from "@/components/deep-dive/code-tab";
import { LogsTab } from "@/components/deep-dive/logs-tab";

type TabId = "prompt" | "code" | "logs";

interface ResultsClientProps {
  configs: ConfigWithStats[];
  resultsByConfig: Record<string, ResultWithCwes[]>;
}

export function ResultsClient({ configs, resultsByConfig }: ResultsClientProps) {
  const configNames = useMemo(
    () => Object.keys(resultsByConfig).sort(),
    [resultsByConfig]
  );

  const allScenarios = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(resultsByConfig)
            .flat()
            .map((r) => r.scenario)
        )
      ).sort(),
    [resultsByConfig]
  );

  const allFrameworks = ["Go-Fiber", "JavaScript-express", "Python-Flask"];
  const allSafetyPrompts = ["none", "generic", "specific"];

  const [selectedConfig, setSelectedConfig] = useState<string>(configNames[0] ?? "");
  const [selectedScenario, setSelectedScenario] = useState<string>("all");
  const [selectedFramework, setSelectedFramework] = useState<string>("all");
  const [selectedSafety, setSelectedSafety] = useState<string>("all");

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("prompt");

  const filtered = useMemo(() => {
    const results = resultsByConfig[selectedConfig] ?? [];
    return results.filter((r) => {
      if (selectedScenario !== "all" && r.scenario !== selectedScenario) return false;
      if (selectedFramework !== "all" && r.framework !== selectedFramework) return false;
      if (selectedSafety !== "all" && r.safety_prompt !== selectedSafety) return false;
      return true;
    });
  }, [resultsByConfig, selectedConfig, selectedScenario, selectedFramework, selectedSafety]);

  const configMeta = configs.find((c) => c.name === selectedConfig);

  function handleRowClick(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      setActiveTab("prompt");
    }
  }

  return (
    <div className="space-y-10">
      {/* ─── Header ─── */}
      <section>
        <h1 className="font-[family-name:var(--font-display)] text-4xl md:text-5xl font-bold tracking-tight text-zinc-100">
          Result Browser
        </h1>
        <p className="text-zinc-400 text-lg mt-3">
          Browse individual test results -- prompts, generated code, and test logs
        </p>
      </section>

      {/* ─── Section 1: Filter Bar ─── */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Config */}
          <div>
            <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5 font-medium">
              Configuration
            </label>
            <select
              value={selectedConfig}
              onChange={(e) => {
                setSelectedConfig(e.target.value);
                setExpandedId(null);
              }}
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
            >
              {configNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {/* Scenario */}
          <div>
            <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5 font-medium">
              Scenario
            </label>
            <select
              value={selectedScenario}
              onChange={(e) => {
                setSelectedScenario(e.target.value);
                setExpandedId(null);
              }}
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
            >
              <option value="all">All Scenarios</option>
              {allScenarios.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Framework */}
          <div>
            <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5 font-medium">
              Framework
            </label>
            <select
              value={selectedFramework}
              onChange={(e) => {
                setSelectedFramework(e.target.value);
                setExpandedId(null);
              }}
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
            >
              <option value="all">All Frameworks</option>
              {allFrameworks.map((fw) => (
                <option key={fw} value={fw}>
                  {fw}
                </option>
              ))}
            </select>
          </div>

          {/* Safety Prompt */}
          <div>
            <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5 font-medium">
              Safety Prompt
            </label>
            <select
              value={selectedSafety}
              onChange={(e) => {
                setSelectedSafety(e.target.value);
                setExpandedId(null);
              }}
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-500 transition-colors"
            >
              <option value="all">All</option>
              {allSafetyPrompts.map((sp) => (
                <option key={sp} value={sp}>
                  {sp}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Summary line */}
        <div className="mt-4 flex items-center gap-4 text-xs text-zinc-500 flex-wrap">
          <span>
            Showing{" "}
            <span className="text-zinc-300 font-semibold">{filtered.length}</span>{" "}
            results
          </span>
          {configMeta && configMeta.total_results > 0 && (
            <>
              <span className="text-zinc-700">|</span>
              <span>
                pass@1{" "}
                <span className="text-zinc-300 font-semibold">
                  {(configMeta.pass_at_1 * 100).toFixed(1)}%
                </span>
              </span>
              <span className="text-zinc-700">|</span>
              <span>
                sec_pass@1{" "}
                <span className="text-zinc-300 font-semibold">
                  {(configMeta.sec_pass_at_1 * 100).toFixed(1)}%
                </span>
              </span>
              <span className="text-zinc-700">|</span>
              <span>
                {configMeta.thinking ? (
                  <span className="text-purple-400">thinking</span>
                ) : (
                  <span className="text-zinc-400">standard</span>
                )}
              </span>
            </>
          )}
        </div>
      </section>

      {/* ─── Section 2: Results Table ─── */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400 text-xs uppercase tracking-wider">
                <th className="text-left px-5 py-3.5 font-medium w-8" />
                <th className="text-left px-5 py-3.5 font-medium">Scenario</th>
                <th className="text-left px-5 py-3.5 font-medium">Framework</th>
                <th className="text-left px-5 py-3.5 font-medium">Safety Prompt</th>
                <th className="text-center px-5 py-3.5 font-medium">Functional</th>
                <th className="text-center px-5 py-3.5 font-medium">CWEs Found</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-zinc-500">
                    No results match the current filters.
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const isExpanded = expandedId === r.id;
                const cweCount = r.cwes?.length ?? 0;

                return (
                  <ResultRow
                    key={r.id}
                    result={r}
                    cweCount={cweCount}
                    isExpanded={isExpanded}
                    activeTab={activeTab}
                    configName={selectedConfig}
                    onToggle={() => handleRowClick(r.id)}
                    onTabChange={setActiveTab}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ─── Result Row (extracted for readability) ─── */

interface ResultRowProps {
  result: ResultWithCwes;
  cweCount: number;
  isExpanded: boolean;
  activeTab: TabId;
  configName: string;
  onToggle: () => void;
  onTabChange: (tab: TabId) => void;
}

function ResultRow({
  result: r,
  cweCount,
  isExpanded,
  activeTab,
  configName,
  onToggle,
  onTabChange,
}: ResultRowProps) {
  return (
    <>
      {/* Clickable summary row */}
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b transition-colors ${
          isExpanded
            ? "bg-zinc-800/60 border-zinc-700"
            : "border-zinc-800/50 hover:bg-zinc-800/30"
        }`}
      >
        {/* Chevron */}
        <td className="px-5 py-3 text-zinc-500">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </td>

        {/* Scenario */}
        <td className="px-5 py-3 text-zinc-100 font-medium">{r.scenario}</td>

        {/* Framework */}
        <td className="px-5 py-3">
          <span className="text-xs font-mono text-zinc-400">{r.framework}</span>
        </td>

        {/* Safety Prompt */}
        <td className="px-5 py-3">
          <span
            className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
              r.safety_prompt === "specific"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : r.safety_prompt === "generic"
                ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                : "bg-zinc-700/30 text-zinc-400 border-zinc-700"
            }`}
          >
            {r.safety_prompt}
          </span>
        </td>

        {/* Functional Pass */}
        <td className="px-5 py-3 text-center">
          {r.functional_pass ? (
            <span className="text-emerald-400 font-bold text-base" title="Pass">
              &#10003;
            </span>
          ) : (
            <span className="text-red-400 font-bold text-base" title="Fail">
              &#10007;
            </span>
          )}
        </td>

        {/* CWEs Found */}
        <td className="px-5 py-3 text-center">
          <span
            className={`tabular-nums font-semibold ${
              cweCount > 0 ? "text-red-400" : "text-zinc-500"
            }`}
          >
            {cweCount}
          </span>
        </td>
      </tr>

      {/* ─── Section 3: Expanded Deep Dive ─── */}
      {isExpanded && (
        <tr>
          <td colSpan={6} className="p-0">
            <div className="border-b border-zinc-700 bg-zinc-950/50 px-6 py-5">
              {/* Result summary badges */}
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <span className="text-sm font-semibold text-zinc-100">
                  {r.scenario}
                </span>
                <span className="text-xs font-mono text-zinc-500">
                  {r.framework}
                </span>
                <span className="text-xs text-zinc-600">/</span>
                <span className="text-xs text-zinc-500">{r.safety_prompt}</span>
                <span className="text-xs text-zinc-600">/</span>
                <span className="text-xs text-zinc-500">sample {r.sample}</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                    r.functional_pass
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : "bg-red-500/10 text-red-400 border-red-500/20"
                  }`}
                >
                  func: {r.functional_pass ? "pass" : "fail"}
                </span>
                <span className="text-[10px] text-zinc-500">
                  FT: {r.num_passed_ft}/{r.num_total_ft}
                </span>
                {cweCount > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium bg-red-500/10 text-red-400 border-red-500/20">
                    {cweCount} CWE{cweCount !== 1 ? "s" : ""}:{" "}
                    {r.cwes.map((c) => `CWE-${c.cwe_num}`).join(", ")}
                  </span>
                )}
              </div>

              {/* Tabs */}
              <div className="flex gap-1 border-b border-zinc-800 pb-px mb-4">
                {(
                  [
                    { id: "prompt" as TabId, label: "Prompt" },
                    { id: "code" as TabId, label: "Code" },
                    { id: "logs" as TabId, label: "Logs" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTabChange(tab.id);
                    }}
                    className={`px-3 py-2 text-xs font-medium rounded-t-md transition-colors ${
                      activeTab === tab.id
                        ? "text-zinc-100 bg-zinc-800"
                        : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="min-h-[200px]">
                {activeTab === "prompt" && (
                  <PromptTab configName={configName} resultId={r.id} />
                )}
                {activeTab === "code" && (
                  <CodeTab configName={configName} resultId={r.id} />
                )}
                {activeTab === "logs" && (
                  <LogsTab configName={configName} resultId={r.id} />
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
