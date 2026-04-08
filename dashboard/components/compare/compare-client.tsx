"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  SafetyPromptTab,
  type SafetyChartRow,
  type SafetyDeltaRow,
} from "./safety-prompt-tab";
import {
  ThinkingTab,
  type ThinkingChartRow,
  type ThinkingDeltaRow,
} from "./thinking-tab";
import {
  FrameworksTab,
  type FrameworkChartRow,
  type FrameworkSummary,
} from "./frameworks-tab";
import { FamiliesTab, type FamilyVizData } from "./families-tab";

type TabId = "safety" | "thinking" | "frameworks" | "families";

interface Tab {
  id: TabId;
  label: string;
}

const tabs: Tab[] = [
  { id: "safety", label: "Safety Prompts" },
  { id: "thinking", label: "Thinking vs Standard" },
  { id: "frameworks", label: "Frameworks" },
  { id: "families", label: "Model Families" },
];

interface CompareClientProps {
  safetyChartData: SafetyChartRow[];
  safetyDeltaData: SafetyDeltaRow[];
  safetyAvgImprovement: number;
  safetyAvgImprovementTrue: number;
  thinkingChartData: ThinkingChartRow[];
  thinkingDeltaData: ThinkingDeltaRow[];
  frameworkChartData: FrameworkChartRow[];
  frameworkSummaries: FrameworkSummary[];
  familyData: FamilyVizData[];
}

export function CompareClient({
  safetyChartData,
  safetyDeltaData,
  safetyAvgImprovement,
  safetyAvgImprovementTrue,
  thinkingChartData,
  thinkingDeltaData,
  frameworkChartData,
  frameworkSummaries,
  familyData,
}: CompareClientProps) {
  const [activeTab, setActiveTab] = useState<TabId>("safety");

  return (
    <div className="space-y-8">
      {/* Tab selector */}
      <div className="flex flex-wrap gap-2 p-1 bg-zinc-900/50 border border-zinc-800 rounded-xl">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="relative px-5 py-2.5 text-sm font-medium rounded-lg transition-colors"
          >
            {activeTab === tab.id && (
              <motion.div
                layoutId="activeCompareTab"
                className="absolute inset-0 bg-zinc-800 rounded-lg border border-zinc-700"
                transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
              />
            )}
            <span
              className={`relative z-10 ${
                activeTab === tab.id ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-300"
              }`}
            >
              {tab.label}
            </span>
          </button>
        ))}
      </div>

      {/* Key Insight Card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        {activeTab === "safety" && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-200">
              <span className="text-emerald-400 font-bold">Key Finding:</span> Specific safety prompts increase sec_pass@1 from <span className="text-red-400 font-bold">0.26%</span> (None) to <span className="text-emerald-400 font-bold">9.73%</span> (Specific) — a 37x improvement. Among working code only, security jumps from 0.5% to <span className="text-emerald-400 font-bold">70.5%</span>.
            </p>
            <p className="text-xs text-zinc-500">
              The chart shows sec_pass@1 (secure / all tests). Generic "write secure code" is worse than no prompt (0.07% vs 0.26%) — vague instructions confuse the model, reducing pass@1 from 48% to 23% without improving security. 141 of 146 total secure apps come from the "specific" prompt.
            </p>
          </div>
        )}
        {activeTab === "thinking" && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-200">
              <span className="text-amber-400 font-bold">Key Finding:</span> Thinking mode has negligible impact on sec_pass@1 — average improvement is just <span className="text-amber-400 font-bold">+0.3 pp</span> across all model families.
            </p>
            <p className="text-xs text-zinc-500">
              The chart shows sec_pass@1 for standard vs thinking mode. sonnet-4.5 improves +1.9 pp, opus-4.1 improves +1.6 pp, but sonnet-4 drops -1.0 pp and opus-4 drops -0.3 pp. Extra reasoning does not consistently produce more secure code.
            </p>
          </div>
        )}
        {activeTab === "frameworks" && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-200">
              <span className="text-blue-400 font-bold">Key Finding:</span> <span className="text-blue-400 font-bold">144 of 146</span> secure apps are JavaScript-Express (sec_pass@1 = 9.6%). Flask has 2 (0.1%). Go-Fiber has zero (0.0%).
            </p>
            <p className="text-xs text-zinc-500">
              The chart shows sec_pass@1 per framework per model. Express also has the highest pass@1 (48.4%) while Go-Fiber only passes 7.9%. AI models generate significantly better code for Node.js/Express — likely due to more training data for that ecosystem.
            </p>
          </div>
        )}
        {activeTab === "families" && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-200">
              <span className="text-purple-400 font-bold">Key Finding:</span> All Claude models cluster between <span className="text-purple-400 font-bold">2.5-4.4%</span> sec_pass@1. Open-source models (DeepSeek, Llama) are at <span className="text-red-400 font-bold">0.0%</span>.
            </p>
            <p className="text-xs text-zinc-500">
              The chart shows sec_pass@1 distribution per family. meta-llama has decent code quality (35.4% pass@1) but 0% security — it writes working code that is always hackable. Within Claude, the Sonnet family has the widest spread (2.5-4.4%).
            </p>
          </div>
        )}
      </div>

      {/* Tab content with animated transitions */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
        >
          {activeTab === "safety" && (
            <SafetyPromptTab
              chartData={safetyChartData}
              deltaData={safetyDeltaData}
              avgImprovement={safetyAvgImprovement}
              avgImprovementTrue={safetyAvgImprovementTrue}
            />
          )}
          {activeTab === "thinking" && (
            <ThinkingTab
              chartData={thinkingChartData}
              deltaData={thinkingDeltaData}
            />
          )}
          {activeTab === "frameworks" && (
            <FrameworksTab
              chartData={frameworkChartData}
              summaries={frameworkSummaries}
            />
          )}
          {activeTab === "families" && <FamiliesTab data={familyData} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
