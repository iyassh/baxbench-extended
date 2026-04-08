import {
  loadConfigs,
  loadResultsByConfig,
  loadCwesWithStats,
  loadHeatmap,
  loadSafetyComparison,
  loadFrameworkComparison,
  loadRadarByConfig,
  loadCweTreemap,
  loadSearchItems,
} from "./data";
import type {
  ConfigWithStats,
  ResultWithCwes,
  CweWithStats,
  HeatmapCell,
  InsightData,
  RadarDataPoint,
  DeltaRow,
  CweTreemapItem,
  FamilyDistribution,
  SearchItem,
} from "./types";

// ── Configs ──────────────────────────────────────────────

export function getAllConfigs(): ConfigWithStats[] {
  return loadConfigs();
}

export function getConfigByName(name: string): ConfigWithStats | null {
  return loadConfigs().find((c) => c.name === name) ?? null;
}

// ── Results ──────────────────────────────────────────────

export function getResultsForConfig(configId: number): ResultWithCwes[] {
  const configs = loadConfigs();
  const config = configs.find((c) => c.id === configId);
  if (!config) return [];
  return loadResultsByConfig()[config.name] ?? [];
}

export function getResultById(id: number): ResultWithCwes | null {
  const allResults = loadResultsByConfig();
  for (const [configName, results] of Object.entries(allResults)) {
    const result = results.find((r) => r.id === id);
    if (result) return { ...result, config_name: configName } as ResultWithCwes & { config_name: string };
  }
  return null;
}

// ── CWEs ─────────────────────────────────────────────────

export function getCwesWithStats(): CweWithStats[] {
  return loadCwesWithStats();
}

export function getCweTreemapData(): CweTreemapItem[] {
  return loadCweTreemap();
}

// ── Heatmap ──────────────────────────────────────────────

export function getHeatmapData(): HeatmapCell[] {
  return loadHeatmap();
}

// ── Safety Prompt Comparison ─────────────────────────────

export function getSafetyPromptComparison() {
  return loadSafetyComparison();
}

// ── Framework Comparison ─────────────────────────────────

export function getFrameworkComparison() {
  return loadFrameworkComparison();
}

// ── Radar ────────────────────────────────────────────────

export function getModelRadarData(configName: string): RadarDataPoint[] {
  return loadRadarByConfig()[configName] ?? [];
}

// ── Search Items ─────────────────────────────────────────

export function getSearchItems(): SearchItem[] {
  return loadSearchItems();
}

// ── Insights ─────────────────────────────────────────────

export function getInsights(): InsightData[] {
  const configs = getAllConfigs().filter((c) => c.total_results > 0);
  const insights: InsightData[] = [];

  const sorted = [...configs].sort(
    (a, b) => b.sec_pass_at_1 - a.sec_pass_at_1
  );
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  if (best) {
    insights.push({
      text: `${best.name} achieves the highest security pass rate at ${(best.sec_pass_at_1 * 100).toFixed(1)}%.`,
      type: "security",
      link: `/models?selected=${encodeURIComponent(best.name)}`,
    });
  }

  if (worst && worst.name !== best?.name) {
    insights.push({
      text: `${worst.name} has the lowest security pass rate at ${(worst.sec_pass_at_1 * 100).toFixed(1)}%.`,
      type: "security",
      link: `/models?selected=${encodeURIComponent(worst.name)}`,
    });
  }

  const thinkingDeltas = getThinkingDelta();

  if (thinkingDeltas.length > 0) {
    const deltas = thinkingDeltas.map((d) => ({
      family: d.config,
      delta_pp: d.delta * 100,
    }));
    const avgDelta =
      deltas.reduce((sum, d) => sum + d.delta_pp, 0) / deltas.length;
    const improved = deltas.filter((d) => d.delta_pp > 0.5);
    const worsened = deltas.filter((d) => d.delta_pp < -0.5);

    let text: string;
    if (improved.length > 0 && worsened.length === 0) {
      text = `Thinking mode improves security by ${avgDelta.toFixed(1)} pp on average across all ${deltas.length} model families.`;
    } else if (worsened.length > 0 && improved.length === 0) {
      text = `Thinking mode reduces security by ${Math.abs(avgDelta).toFixed(1)} pp on average across all ${deltas.length} model families.`;
    } else {
      const bestImproved = [...improved].sort(
        (a, b) => b.delta_pp - a.delta_pp
      )[0];
      const worstWorsened = [...worsened].sort(
        (a, b) => a.delta_pp - b.delta_pp
      )[0];
      const parts: string[] = [];
      if (bestImproved) {
        parts.push(
          `improves ${bestImproved.family} by +${bestImproved.delta_pp.toFixed(1)} pp`
        );
      }
      if (worstWorsened) {
        parts.push(
          `hurts ${worstWorsened.family} by ${worstWorsened.delta_pp.toFixed(1)} pp`
        );
      }
      text = `Thinking mode has mixed results (avg ${avgDelta >= 0 ? "+" : ""}${avgDelta.toFixed(1)} pp): ${parts.join(" but ")}.`;
    }

    insights.push({
      text,
      type: "comparison",
    });
  }

  const safetyData = getSafetyPromptComparison();
  const noneRows = safetyData.filter((r) => r.safety_prompt === "none");
  const specificRows = safetyData.filter(
    (r) => r.safety_prompt === "specific"
  );

  const noneTotal = noneRows.reduce((s, r) => s + r.secure_passes, 0);
  const noneCount = noneRows.reduce((s, r) => s + r.total, 0);
  const specificTotal = specificRows.reduce((s, r) => s + r.secure_passes, 0);
  const specificCount = specificRows.reduce((s, r) => s + r.total, 0);

  if (noneCount > 0 && specificCount > 0) {
    const noneRate = (noneTotal / noneCount) * 100;
    const specificRate = (specificTotal / specificCount) * 100;
    const impact = specificRate - noneRate;

    insights.push({
      text: `Specific safety prompts ${impact >= 0 ? "improve" : "decrease"} the security pass rate by ${Math.abs(impact).toFixed(1)} percentage points on average.`,
      type: "vulnerability",
    });
  }

  return insights;
}

// ── Comparisons ──────────────────────────────────────────

export function getThinkingComparison() {
  const configs = getAllConfigs();
  const pairs: { standard: ConfigWithStats; thinking: ConfigWithStats }[] = [];

  const standardConfigs = configs.filter(
    (c) => !c.thinking && c.total_results > 0
  );
  for (const std of standardConfigs) {
    const baseName = std.name.replace("-standard", "");
    const thk = configs.find(
      (c) => c.name === `${baseName}-thinking` && c.total_results > 0
    );
    if (thk) {
      pairs.push({ standard: std, thinking: thk });
    }
  }

  return pairs;
}

// ── Safety Prompt Delta ──────────────────────────────────

export function getSafetyPromptDelta(): DeltaRow[] {
  const safetyData = getSafetyPromptComparison();

  const byConfig = new Map<
    string,
    {
      none: { secure: number; truly_secure: number; total: number };
      specific: { secure: number; truly_secure: number; total: number }
    }
  >();

  for (const row of safetyData) {
    if (row.safety_prompt !== "none" && row.safety_prompt !== "specific")
      continue;
    if (!byConfig.has(row.config_name)) {
      byConfig.set(row.config_name, {
        none: { secure: 0, truly_secure: 0, total: 0 },
        specific: { secure: 0, truly_secure: 0, total: 0 },
      });
    }
    const entry = byConfig.get(row.config_name)!;
    if (row.safety_prompt === "none") {
      entry.none.secure += row.secure_passes;
      entry.none.truly_secure += row.truly_secure_passes;
      entry.none.total += row.total;
    } else {
      entry.specific.secure += row.secure_passes;
      entry.specific.truly_secure += row.truly_secure_passes;
      entry.specific.total += row.total;
    }
  }

  const results: DeltaRow[] = [];
  for (const [config, data] of byConfig) {
    const baseline =
      data.none.total > 0 ? data.none.secure / data.none.total : 0;
    const comparison =
      data.specific.total > 0
        ? data.specific.secure / data.specific.total
        : 0;
    const delta = comparison - baseline;
    const delta_pct = baseline > 0 ? (delta / baseline) * 100 : 0;

    const baseline_true =
      data.none.total > 0 ? data.none.truly_secure / data.none.total : 0;
    const comparison_true =
      data.specific.total > 0
        ? data.specific.truly_secure / data.specific.total
        : 0;
    const delta_true = comparison_true - baseline_true;
    const delta_pct_true = baseline_true > 0 ? (delta_true / baseline_true) * 100 : 0;

    results.push({ config, baseline, comparison, delta, delta_pct, baseline_true, comparison_true, delta_true, delta_pct_true });
  }

  return results.sort((a, b) => a.config.localeCompare(b.config));
}

// ── Thinking Delta ───────────────────────────────────────

export function getThinkingDelta(): DeltaRow[] {
  const configs = getAllConfigs().filter((c) => c.total_results > 0);
  const families = new Map<
    string,
    { standard?: ConfigWithStats; thinking?: ConfigWithStats }
  >();

  for (const c of configs) {
    const family = c.name.replace(/-standard$/, "").replace(/-thinking$/, "");
    if (!families.has(family)) {
      families.set(family, {});
    }
    const entry = families.get(family)!;
    if (c.thinking) {
      entry.thinking = c;
    } else {
      entry.standard = c;
    }
  }

  const results: DeltaRow[] = [];
  for (const [family, pair] of families) {
    if (!pair.standard || !pair.thinking) continue;

    const baseline = pair.standard.sec_pass_at_1;
    const comparison = pair.thinking.sec_pass_at_1;
    const delta = comparison - baseline;
    const delta_pct = baseline > 0 ? (delta / baseline) * 100 : 0;

    const baseline_true = pair.standard.true_sec_pass_at_1 || 0;
    const comparison_true = pair.thinking.true_sec_pass_at_1 || 0;
    const delta_true = comparison_true - baseline_true;
    const delta_pct_true = baseline_true > 0 ? (delta_true / baseline_true) * 100 : 0;

    results.push({ config: family, baseline, comparison, delta, delta_pct, baseline_true, comparison_true, delta_true, delta_pct_true });
  }

  return results.sort((a, b) => a.config.localeCompare(b.config));
}

// ── Distribution by Family ───────────────────────────────

export function getDistributionByFamily(): FamilyDistribution[] {
  const configs = getAllConfigs().filter((c) => c.total_results > 0);

  const familyMap = new Map<
    string,
    { configs: string[]; values: number[] }
  >();

  for (const c of configs) {
    let family: string | null = null;
    if (c.name.includes("haiku")) family = "haiku";
    else if (c.name.includes("sonnet")) family = "sonnet";
    else if (c.name.includes("opus")) family = "opus";
    else if (c.name.includes("deepseek")) family = "deepseek";
    else if (c.name.includes("llama")) family = "llama";

    if (!family) continue;

    if (!familyMap.has(family)) {
      familyMap.set(family, { configs: [], values: [] });
    }
    const entry = familyMap.get(family)!;
    entry.configs.push(c.name);
    entry.values.push(c.sec_pass_at_1);
  }

  const results: FamilyDistribution[] = [];

  for (const [family, data] of familyMap) {
    const sorted = [...data.values].sort((a, b) => a - b);
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length === 0
        ? 0
        : sorted.length % 2 === 1
          ? sorted[mid]
          : (sorted[mid - 1] + sorted[mid]) / 2;

    results.push({
      family,
      configs: data.configs,
      values: data.values,
      median,
      min,
      max,
    });
  }

  return results.sort((a, b) => a.family.localeCompare(b.family));
}
