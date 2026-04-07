"use client";

import { useState, useMemo, useCallback } from "react";
import { LayoutGroup } from "framer-motion";
import type { ConfigWithStats, RadarDataPoint, ResultWithCwes } from "@/lib/types";
import { ModelFilters, type ModelFilterState } from "@/components/model-filters";
import { ModelCard } from "@/components/model-card";
import { ModelDetail } from "@/components/model-detail";
import { SlidePanel } from "@/components/slide-panel";

interface ModelsClientProps {
  configs: ConfigWithStats[];
  radarDataMap: Record<string, RadarDataPoint[]>;
  resultsMap: Record<string, ResultWithCwes[]>;
  sparklineMap: Record<string, { name: string; value: number }[]>;
}

function getFamily(name: string): string {
  if (name.includes("opus")) return "Opus";
  if (name.includes("sonnet")) return "Sonnet";
  if (name.includes("haiku")) return "Haiku";
  if (name.includes("deepseek")) return "DeepSeek";
  if (name.includes("llama")) return "Llama";
  return "Unknown";
}

export function ModelsClient({
  configs,
  radarDataMap,
  resultsMap,
  sparklineMap,
}: ModelsClientProps) {
  const [filters, setFilters] = useState<ModelFilterState>({
    family: "All",
    mode: "All",
    sort: "sec_pass_at_1",
  });
  const [selectedConfig, setSelectedConfig] = useState<ConfigWithStats | null>(
    null
  );

  const handleFilterChange = useCallback((newFilters: ModelFilterState) => {
    setFilters(newFilters);
  }, []);

  const handleCardClick = useCallback(
    (config: ConfigWithStats) => {
      setSelectedConfig(config);
    },
    []
  );

  const handleClosePanel = useCallback(() => {
    setSelectedConfig(null);
  }, []);

  const filtered = useMemo(() => {
    let list = configs.filter((c) => c.total_results > 0);

    // Family filter
    if (filters.family !== "All") {
      const familyLower = filters.family.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(familyLower));
    }

    // Mode filter
    if (filters.mode !== "All") {
      const isThinking = filters.mode === "Thinking";
      list = list.filter((c) => c.thinking === isThinking);
    }

    // Sort
    switch (filters.sort) {
      case "sec_pass_at_1":
        list = [...list].sort((a, b) => b.sec_pass_at_1 - a.sec_pass_at_1);
        break;
      case "pass_at_1":
        list = [...list].sort((a, b) => b.pass_at_1 - a.pass_at_1);
        break;
      case "total_cwes":
        list = [...list].sort((a, b) => a.total_cwes - b.total_cwes);
        break;
      case "name":
        list = [...list].sort((a, b) => a.name.localeCompare(b.name));
        break;
    }

    return list;
  }, [configs, filters]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">
          Models
        </h1>
        <p className="text-zinc-400 mt-1">
          {configs.filter((c) => c.total_results > 0).length} model
          configurations tested
        </p>
      </div>

      {/* Filter bar */}
      <ModelFilters onFilterChange={handleFilterChange} />

      {/* Card grid */}
      <LayoutGroup>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((config) => (
            <ModelCard
              key={config.name}
              config={config}
              onClick={() => handleCardClick(config)}
              sparklineData={sparklineMap[config.name]}
            />
          ))}
        </div>
      </LayoutGroup>

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <p className="text-zinc-500">
            No models match the current filters.
          </p>
        </div>
      )}

      {/* Detail slide-out panel */}
      <SlidePanel
        open={selectedConfig !== null}
        onClose={handleClosePanel}
        title={selectedConfig?.name ?? ""}
      >
        {selectedConfig && (
          <ModelDetail
            config={selectedConfig}
            radarData={radarDataMap[selectedConfig.name] ?? []}
            results={resultsMap[selectedConfig.name] ?? []}
            onClose={handleClosePanel}
          />
        )}
      </SlidePanel>
    </div>
  );
}
