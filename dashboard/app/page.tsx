import Link from "next/link";
import {
  getAllConfigs,
  getCwesWithStats,
  getInsights,
  getHeatmapData,
  getSafetyPromptComparison,
} from "@/lib/queries";
import { StatCard } from "@/components/stat-card";
import { PageTransition } from "@/components/page-transition";
import { InsightPills } from "@/components/insight-pills";
import { ModelRankingChart } from "@/components/charts/model-ranking-chart";
import { VulnerabilityHeatmap } from "@/components/charts/vulnerability-heatmap";
import { SafetyComparisonChart } from "@/components/charts/safety-comparison-chart";

export default function OverviewPage() {
  const configs = getAllConfigs();
  const cwes = getCwesWithStats();
  const insights = getInsights();
  const heatmapRaw = getHeatmapData();
  const safetyRaw = getSafetyPromptComparison();

  const configsWithResults = configs.filter((c) => c.total_results > 0);
  const totalResults = configsWithResults.reduce(
    (s, c) => s + c.total_results,
    0
  );
  const configCount = configsWithResults.length;
  const thinkingCount = configsWithResults.filter((c) => c.thinking).length;
  const standardCount = configCount - thinkingCount;

  // Average security rate
  const avgSecRate =
    configCount > 0
      ? configsWithResults.reduce((s, c) => s + c.sec_pass_at_1, 0) /
        configCount
      : 0;

  // Unique CWEs
  const uniqueCweCount = cwes.filter((c) => c.occurrence_count > 0).length;

  // --- Model Ranking data ---
  const rankingData = configsWithResults.map((c) => {
    let family = "haiku";
    if (c.name.includes("sonnet")) family = "sonnet";
    else if (c.name.includes("opus")) family = "opus";
    else if (c.name.includes("deepseek")) family = "deepseek";
    else if (c.name.includes("llama")) family = "llama";
    else if (c.name.includes("mistral")) family = "mistral";
    else if (c.name.includes("gemma")) family = "gemma";

    return {
      name: c.name,
      sec_pass_at_1: Math.round(c.sec_pass_at_1 * 1000) / 10,
      true_sec_pass_at_1: Math.round((c.true_sec_pass_at_1 || 0) * 1000) / 10,
      pass_at_1: Math.round(c.pass_at_1 * 1000) / 10,
      total_cwes: c.total_cwes,
      family,
      thinking: c.thinking,
    };
  });

  // --- Heatmap data ---
  const heatmapModels = [...new Set(heatmapRaw.map((h) => h.model))].sort();
  const heatmapScenarios = [
    ...new Set(heatmapRaw.map((h) => h.scenario)),
  ].sort();

  // --- Safety comparison data ---
  const safetyByConfig = new Map<
    string,
    { none: number; generic: number; specific: number }
  >();

  for (const row of safetyRaw) {
    if (!safetyByConfig.has(row.config_name)) {
      safetyByConfig.set(row.config_name, {
        none: 0,
        generic: 0,
        specific: 0,
      });
    }
    const entry = safetyByConfig.get(row.config_name)!;
    const rate = row.total > 0 ? (row.secure_passes / row.total) * 100 : 0;
    if (row.safety_prompt === "none") entry.none = Math.round(rate * 10) / 10;
    else if (row.safety_prompt === "generic")
      entry.generic = Math.round(rate * 10) / 10;
    else if (row.safety_prompt === "specific")
      entry.specific = Math.round(rate * 10) / 10;
  }

  const safetyData = Array.from(safetyByConfig.entries()).map(
    ([config, vals]) => ({
      config,
      ...vals,
    })
  );

  // --- Top CWE badges ---
  const topCwes = [...cwes]
    .filter((c) => c.occurrence_count > 0)
    .sort((a, b) => b.occurrence_count - a.occurrence_count)
    .slice(0, 8);

  return (
    <PageTransition>
      <div className="space-y-12">
        {/* ─── Section 1: Header + Insights ─── */}
        <section id="header">
          <h1 className="font-[family-name:var(--font-display)] text-4xl md:text-5xl font-bold tracking-tight">
            BaxBench Security Dashboard
          </h1>
          <p className="text-zinc-400 text-lg mt-3">
            Analyzing{" "}
            <span className="text-emerald-400 font-semibold tabular-nums">
              {totalResults.toLocaleString()}
            </span>{" "}
            security tests across{" "}
            <span className="text-emerald-400 font-semibold tabular-nums">
              {configCount}
            </span>{" "}
            model configurations
          </p>

          <div className="mt-6">
            <InsightPills insights={insights} />
          </div>
        </section>

        {/* ─── Section 2: Stat Cards ─── */}
        <section id="stats">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard
              title="Total Results"
              value={totalResults}
              accent="emerald"
            />
            <StatCard
              title="Models Tested"
              value={configCount}
              accent="blue"
              subtitle={`${thinkingCount} thinking / ${standardCount} standard`}
            />
            <StatCard
              title="Avg sec_pass@1"
              value={`${(avgSecRate * 100).toFixed(1)}%`}
              accent="amber"
              subtitle="Includes crashes"
            />
            <StatCard
              title="Avg true_sec@1"
              value={`${(configsWithResults.reduce((s, c) => s + (c.true_sec_pass_at_1 || 0), 0) / configCount * 100).toFixed(1)}%`}
              accent="green"
              subtitle="Clean tests only"
            />
            <StatCard
              title="CWEs Detected"
              value={uniqueCweCount}
              accent="red"
            />
          </div>
        </section>

        {/* ─── Section 3: Model Ranking Chart ─── */}
        {rankingData.length > 0 && (
          <section id="ranking">
            <div className="mb-6">
              <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
                Model Security Ranking
              </h2>
              <p className="text-zinc-500 text-sm mt-1">
                Sorted by true_sec@1 (clean tests only) • Amber shows sec_pass@1 (includes crashes)
              </p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <ModelRankingChart data={rankingData} />
            </div>
          </section>
        )}

        {/* ─── Section 4: Vulnerability Heatmap ─── */}
        {heatmapRaw.length > 0 && (
          <section id="heatmap">
            <div className="mb-6">
              <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
                Vulnerability Matrix
              </h2>
              <p className="text-zinc-500 text-sm mt-1">
                CWE occurrences by model and scenario
              </p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <VulnerabilityHeatmap
                data={heatmapRaw}
                models={heatmapModels}
                scenarios={heatmapScenarios}
              />
            </div>
          </section>
        )}

        {/* ─── Section 5: Safety Prompt Impact ─── */}
        {safetyData.length > 0 && (
          <section id="safety">
            <div className="mb-6">
              <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
                Safety Prompt Impact
              </h2>
              <p className="text-zinc-500 text-sm mt-1">
                sec_pass@1 by safety prompt level
              </p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <SafetyComparisonChart data={safetyData} />
            </div>

            {/* CWE badges */}
            {topCwes.length > 0 && (
              <div className="mt-6">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
                  Top Vulnerabilities
                </p>
                <div className="flex flex-wrap gap-2">
                  {topCwes.map((cwe) => (
                    <Link
                      key={cwe.num}
                      href={`/vulnerabilities?cwe=${cwe.num}`}
                      className="rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-3 py-1 hover:bg-red-500/20 transition-colors"
                    >
                      CWE-{cwe.num}{" "}
                      <span className="text-red-400/70">{cwe.name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </PageTransition>
  );
}
