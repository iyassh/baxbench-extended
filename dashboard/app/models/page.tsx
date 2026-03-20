import {
  getAllConfigs,
  getModelRadarData,
  getResultsForConfig,
  getSafetyPromptComparison,
} from "@/lib/queries";
import type { RadarDataPoint, ResultWithCwes } from "@/lib/types";
import { ModelsClient } from "./models-client";

export default function ModelsPage() {
  const configs = getAllConfigs();

  // Pre-compute radar data for all configs
  const radarDataMap: Record<string, RadarDataPoint[]> = {};
  for (const c of configs) {
    if (c.total_results > 0) {
      radarDataMap[c.name] = getModelRadarData(c.name);
    }
  }

  // Pre-compute results for all configs (for the detail panel)
  const resultsMap: Record<string, ResultWithCwes[]> = {};
  for (const c of configs) {
    if (c.total_results > 0) {
      resultsMap[c.name] = getResultsForConfig(c.id);
    }
  }

  // Pre-compute sparkline data (sec_pass@1 across none/generic/specific)
  const safetyRaw = getSafetyPromptComparison();
  const sparklineMap: Record<string, { name: string; value: number }[]> = {};

  for (const c of configs) {
    const rows = safetyRaw.filter((r) => r.config_name === c.name);
    const points: { name: string; value: number }[] = [];
    for (const sp of ["none", "generic", "specific"]) {
      const row = rows.find((r) => r.safety_prompt === sp);
      if (row && row.total > 0) {
        points.push({
          name: sp,
          value: Math.round((row.secure_passes / row.total) * 1000) / 10,
        });
      }
    }
    if (points.length > 1) {
      sparklineMap[c.name] = points;
    }
  }

  return (
    <ModelsClient
      configs={configs}
      radarDataMap={radarDataMap}
      resultsMap={resultsMap}
      sparklineMap={sparklineMap}
    />
  );
}
