import {
  getSafetyPromptComparison,
  getSafetyPromptDelta,
  getThinkingComparison,
  getThinkingDelta,
  getFrameworkComparison,
  getDistributionByFamily,
} from "@/lib/queries";
import { PageTransition } from "@/components/page-transition";
import { CompareClient } from "@/components/compare/compare-client";
import type { SafetyChartRow, SafetyDeltaRow } from "@/components/compare/safety-prompt-tab";
import type { ThinkingChartRow, ThinkingDeltaRow } from "@/components/compare/thinking-tab";
import type { FrameworkChartRow, FrameworkSummary } from "@/components/compare/frameworks-tab";
import type { FamilyVizData } from "@/components/compare/families-tab";

export default function ComparePage() {
  // ── Fetch all comparison data ──────────────────────────
  const safetyRaw = getSafetyPromptComparison();
  const safetyDeltaRaw = getSafetyPromptDelta();
  const thinkingPairs = getThinkingComparison();
  const thinkingDeltaRaw = getThinkingDelta();
  const frameworkRaw = getFrameworkComparison();
  const familyRaw = getDistributionByFamily();

  // ── Transform safety data ─────────────────────────────
  const safetyByConfig: Record<
    string,
    { config: string; none: number; generic: number; specific: number }
  > = {};
  for (const row of safetyRaw) {
    if (!safetyByConfig[row.config_name]) {
      safetyByConfig[row.config_name] = {
        config: row.config_name,
        none: 0,
        generic: 0,
        specific: 0,
      };
    }
    const rate =
      row.total > 0
        ? Math.round((row.secure_passes / row.total) * 1000) / 10
        : 0;
    const key = row.safety_prompt as "none" | "generic" | "specific";
    if (key in safetyByConfig[row.config_name]) {
      safetyByConfig[row.config_name][key] = rate;
    }
  }
  const safetyChartData: SafetyChartRow[] = Object.values(safetyByConfig);

  const safetyDeltaData: SafetyDeltaRow[] = safetyDeltaRaw.map((row) => ({
    config: row.config,
    none: Math.round(row.baseline * 1000) / 10,
    specific: Math.round(row.comparison * 1000) / 10,
    change: Math.round(row.delta * 1000) / 10,
  }));

  // Calculate average improvement
  const safetyAvgImprovement =
    safetyDeltaData.length > 0
      ? safetyDeltaData.reduce((sum, r) => sum + r.change, 0) /
        safetyDeltaData.length
      : 0;

  // ── Transform thinking data ───────────────────────────
  const thinkingChartData: ThinkingChartRow[] = thinkingPairs.map((pair) => ({
    family: pair.standard.name.replace("-standard", ""),
    standard: Math.round(pair.standard.sec_pass_at_1 * 1000) / 10,
    thinking: Math.round(pair.thinking.sec_pass_at_1 * 1000) / 10,
  }));

  const thinkingDeltaData: ThinkingDeltaRow[] = thinkingDeltaRaw.map(
    (row) => ({
      config: row.config,
      standard: Math.round(row.baseline * 1000) / 10,
      thinking: Math.round(row.comparison * 1000) / 10,
      change: Math.round(row.delta * 1000) / 10,
    })
  );

  // ── Transform framework data ──────────────────────────
  const fwByConfig: Record<
    string,
    Record<string, { secure: number; total: number }>
  > = {};
  const fwTotals: Record<
    string,
    { sum: number; count: number; configs: { config: string; value: number }[] }
  > = {};

  for (const row of frameworkRaw) {
    if (!fwByConfig[row.config_name]) {
      fwByConfig[row.config_name] = {};
    }
    const rate =
      row.total > 0
        ? Math.round((row.secure_passes / row.total) * 1000) / 10
        : 0;
    fwByConfig[row.config_name][row.framework] = {
      secure: row.secure_passes,
      total: row.total,
    };

    if (!fwTotals[row.framework]) {
      fwTotals[row.framework] = { sum: 0, count: 0, configs: [] };
    }
    fwTotals[row.framework].sum += rate;
    fwTotals[row.framework].count += 1;
    fwTotals[row.framework].configs.push({ config: row.config_name, value: rate });
  }

  const frameworkChartData: FrameworkChartRow[] = Object.entries(fwByConfig).map(
    ([config, fws]) => ({
      config,
      flask: fws["Python-Flask"]
        ? Math.round(
            (fws["Python-Flask"].secure / fws["Python-Flask"].total) * 1000
          ) / 10
        : 0,
      express: fws["JavaScript-express"]
        ? Math.round(
            (fws["JavaScript-express"].secure /
              fws["JavaScript-express"].total) *
              1000
          ) / 10
        : 0,
      fiber: fws["Go-Fiber"]
        ? Math.round(
            (fws["Go-Fiber"].secure / fws["Go-Fiber"].total) * 1000
          ) / 10
        : 0,
    })
  );

  const frameworkSummaries: FrameworkSummary[] = Object.entries(fwTotals).map(
    ([framework, data]) => {
      const sorted = [...data.configs].sort((a, b) => b.value - a.value);
      return {
        framework,
        average: data.count > 0 ? data.sum / data.count : 0,
        best: sorted[0] || { config: "N/A", value: 0 },
        worst: sorted[sorted.length - 1] || { config: "N/A", value: 0 },
      };
    }
  );

  // ── Transform family data ─────────────────────────────
  const familyData: FamilyVizData[] = familyRaw.map((f) => ({
    family: f.family,
    configs: f.configs,
    values: f.values,
    median: f.median,
    min: f.min,
    max: f.max,
  }));

  return (
    <PageTransition>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-100">
            Compare
          </h1>
          <p className="text-zinc-400 mt-1">
            Side-by-side analysis across dimensions
          </p>
        </div>

        <CompareClient
          safetyChartData={safetyChartData}
          safetyDeltaData={safetyDeltaData}
          safetyAvgImprovement={safetyAvgImprovement}
          thinkingChartData={thinkingChartData}
          thinkingDeltaData={thinkingDeltaData}
          frameworkChartData={frameworkChartData}
          frameworkSummaries={frameworkSummaries}
          familyData={familyData}
        />
      </div>
    </PageTransition>
  );
}
