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
              <span className="text-emerald-400 font-bold">Key Finding:</span> Specific safety prompts increase security of working code from <span className="text-red-400 font-bold">0.5%</span> to <span className="text-emerald-400 font-bold">70.5%</span> — a 141x improvement.
            </p>
            <p className="text-xs text-zinc-500">
              Generic "write secure code" is actually worse than no prompt (0.3% vs 0.5%) — vague instructions confuse the model. Only 1 of 15 models produces any secure code without specific safety instructions.
            </p>
          </div>
        )}
        {activeTab === "thinking" && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-200">
              <span className="text-amber-400 font-bold">Key Finding:</span> Thinking mode has negligible impact — average improvement is just <span className="text-amber-400 font-bold">+0.3 pp</span> across all model families.
            </p>
            <p className="text-xs text-zinc-500">
              Some models improve slightly (sonnet-4.5: +1.9 pp) while others get worse (sonnet-4: -1.0 pp). Extra reasoning time does not automatically produce more secure code. The security knowledge is the bottleneck, not the reasoning process.
            </p>
          </div>
        )}
        {activeTab === "frameworks" && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-200">
              <span className="text-blue-400 font-bold">Key Finding:</span> <span className="text-blue-400 font-bold">144 of 146</span> secure apps are JavaScript-Express. Flask has 2. Go-Fiber has zero.
            </p>
            <p className="text-xs text-zinc-500">
              Express: 48.4% pass@1, 19.8% Sec(Working). Flask: 29.5% pass@1, 0.5% Sec(Working). Go-Fiber: 7.9% pass@1, 0.0% Sec(Working). AI models have significantly more secure coding training data for Node.js/Express than Python or Go.
            </p>
          </div>
        )}
        {activeTab === "families" && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-200">
              <span className="text-purple-400 font-bold">Key Finding:</span> All Claude models cluster between <span className="text-purple-400 font-bold">2.5-4.4%</span> sec_pass@1. Open-source models (DeepSeek, Llama) are at <span className="text-red-400 font-bold">0.0%</span>.
            </p>
            <p className="text-xs text-zinc-500">
              meta-llama has decent code quality (35.4% pass@1) but 0% security — it writes working code that is always hackable. sonnet-4.5-standard has the fewest CWEs (92) despite average sec_pass, suggesting its code is cleaner overall.
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
