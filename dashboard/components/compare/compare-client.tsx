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
