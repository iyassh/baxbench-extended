"use client";

import { useState } from "react";
import type { ResultWithCwes } from "@/lib/types";
import { PromptTab } from "@/components/deep-dive/prompt-tab";
import { CodeTab } from "@/components/deep-dive/code-tab";
import { LogsTab } from "@/components/deep-dive/logs-tab";
import { VulnerabilitiesTab } from "@/components/deep-dive/vulnerabilities-tab";
import { cn } from "@/lib/utils";

interface ResultDeepDiveProps {
  result: ResultWithCwes;
  configName: string;
  onClose: () => void;
}

const tabs = [
  { id: "prompt", label: "Prompt" },
  { id: "code", label: "Code" },
  { id: "logs", label: "Logs" },
  { id: "vulnerabilities", label: "Vulnerabilities" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function ResultDeepDive({ result, configName, onClose }: ResultDeepDiveProps) {
  const [activeTab, setActiveTab] = useState<TabId>("code");

  const funcStatus = result.functional_pass ? "pass" : "fail";
  const secStatus = result.cwes.length === 0 && result.functional_pass ? "pass" : "fail";

  return (
    <div className="space-y-4">
      {/* Back button + header */}
      <button
        onClick={onClose}
        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back to results
      </button>

      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-lg font-semibold text-zinc-100">
          {result.scenario}
        </h3>
        <span className="text-xs text-zinc-500 font-mono">
          {result.framework}
        </span>
        <span className="text-xs text-zinc-600">/</span>
        <span className="text-xs text-zinc-500">{result.safety_prompt}</span>
        <span
          className={cn(
            "text-[10px] px-2 py-0.5 rounded-full border font-medium",
            funcStatus === "pass"
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-red-500/10 text-red-400 border-red-500/20"
          )}
        >
          func: {funcStatus}
        </span>
        <span
          className={cn(
            "text-[10px] px-2 py-0.5 rounded-full border font-medium",
            secStatus === "pass"
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-red-500/10 text-red-400 border-red-500/20"
          )}
        >
          sec: {secStatus}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800 pb-px">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-3 py-2 text-xs font-medium rounded-t-md transition-colors relative",
              activeTab === tab.id
                ? "text-zinc-100 bg-zinc-800"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
            )}
          >
            {tab.label}
            {tab.id === "vulnerabilities" && result.cwes.length > 0 && (
              <span className="ml-1.5 text-[10px] text-red-400 bg-red-500/10 rounded-full px-1.5">
                {result.cwes.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-[200px]">
        {activeTab === "prompt" && <PromptTab configName={configName} resultId={result.id} />}
        {activeTab === "code" && <CodeTab configName={configName} resultId={result.id} />}
        {activeTab === "logs" && <LogsTab configName={configName} resultId={result.id} />}
{activeTab === "vulnerabilities" && (
          <VulnerabilitiesTab cwes={result.cwes} />
        )}
      </div>
    </div>
  );
}
