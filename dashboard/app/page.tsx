import Link from "next/link";
import {
  getAllConfigs,
  getCwesWithStats,
  getInsights,
  getHeatmapData,
  getSafetyPromptComparison,
} from "@/lib/queries";
import { loadResultsByConfig, loadHeatmapBySafety } from "@/lib/data";
import { StatCard } from "@/components/stat-card";
import { PageTransition } from "@/components/page-transition";
import { InsightPills } from "@/components/insight-pills";
import { ModelRankingChart } from "@/components/charts/model-ranking-chart";
import { VulnerabilityHeatmap } from "@/components/charts/vulnerability-heatmap";
import { SecurityFunnel } from "@/components/security-funnel";

export default function OverviewPage() {
  const configs = getAllConfigs();
  const cwes = getCwesWithStats();
  const insights = getInsights();
  const heatmapRaw = getHeatmapData();
  const safetyData = getSafetyPromptComparison();
  const heatmapBySafety = loadHeatmapBySafety();

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

  // Funnel data: compute from results
  const allResults = loadResultsByConfig();
  let totalFunctionalPasses = 0;
  let totalWithCwes = 0;
  let totalSecurePasses = 0;
  let totalTrulySecure = 0;
  for (const [, results] of Object.entries(allResults)) {
    for (const r of results) {
      if (r.functional_pass) {
        totalFunctionalPasses++;
        if (r.cwes.length > 0) {
          totalWithCwes++;
        } else {
          totalSecurePasses++;
          if (r.num_st_exceptions === 0) {
            totalTrulySecure++;
          }
        }
      }
    }
  }

  // Security rate among working apps
  const secAmongWorking = totalFunctionalPasses > 0
    ? (totalSecurePasses / totalFunctionalPasses * 100).toFixed(1)
    : "0.0";

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
      functional_passes: c.functional_passes,
      total_results: c.total_results,
      secure_passes: c.secure_passes,
      family,
      thinking: c.thinking,
    };
  });

  // --- Heatmap data ---
  const heatmapModels = [...new Set(heatmapRaw.map((h) => h.model))].sort();
  const heatmapScenarios = [
    ...new Set(heatmapRaw.map((h) => h.scenario)),
  ].sort();


  return (
    <PageTransition>
      <div className="space-y-12">
        {/* ─── Section 1: Header + Insights ─── */}
        <section id="header">
          <h1 className="font-[family-name:var(--font-display)] text-4xl md:text-5xl font-bold tracking-tight">
            CodeStrike Security Dashboard
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

        {/* ─── Section 2: Security Funnel ─── */}
        <section id="funnel">
          <SecurityFunnel
            totalResults={totalResults}
            functionalPasses={totalFunctionalPasses}
            withCwes={totalWithCwes}
            securePasses={totalSecurePasses}
            trulySecure={totalTrulySecure}
          />
        </section>

        {/* ─── Section 3: Stat Cards ─── */}
        <section id="stats">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
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
              title="Secure (Working Only)"
              value={`${secAmongWorking}%`}
              accent="purple"
              subtitle={`${totalSecurePasses} of ${totalFunctionalPasses} functional apps`}
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
                All 15 models compared across security, functionality, and vulnerability counts
              </p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 overflow-hidden" style={{ maxHeight: "800px" }}>
              <ModelRankingChart data={rankingData} safetyData={safetyData} />
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
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 overflow-auto" style={{ maxHeight: "700px" }}>
              <VulnerabilityHeatmap
                data={heatmapRaw}
                models={heatmapModels}
                scenarios={heatmapScenarios}
                safetyData={heatmapBySafety}
              />
            </div>
          </section>
        )}

        {/* ─── Section 5: Pentest Highlights ─── */}
        <section id="pentest-highlights">
          <div className="mb-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
              Pentest Highlights
            </h2>
            <p className="text-zinc-500 text-sm mt-1">
              Manual penetration testing validates automated results
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-3">
              <div className="w-2 h-10 rounded-full bg-emerald-500 shrink-0" />
              <div>
                <p className="text-lg font-semibold text-emerald-400 tabular-nums">41 manual findings</p>
                <p className="text-xs text-zinc-500">Across 10 apps</p>
              </div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-3">
              <div className="w-2 h-10 rounded-full bg-red-500 shrink-0" />
              <div>
                <p className="text-lg font-semibold text-red-400 tabular-nums">14.3% ZAP agreement</p>
                <p className="text-xs text-zinc-500">Proves CodeStrike value</p>
              </div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-3">
              <div className="w-2 h-10 rounded-full bg-amber-500 shrink-0" />
              <div>
                <p className="text-lg font-semibold text-amber-400 tabular-nums">100% precision, 27% recall</p>
                <p className="text-xs text-zinc-500">ZAP scanner accuracy</p>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Section 6: Quick Links ─── */}
        <section id="quick-links">
          <div className="mb-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
              Explore
            </h2>
            <p className="text-zinc-500 text-sm mt-1">
              Dive deeper into the data
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <Link
              href="/models"
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 hover:bg-zinc-800/50 transition-all group"
            >
              <p className="font-semibold text-zinc-100 group-hover:text-emerald-400 transition-colors">Explore Models</p>
              <p className="text-xs text-zinc-500 mt-1">Per-model security breakdown</p>
            </Link>
            <Link
              href="/compare"
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 hover:bg-zinc-800/50 transition-all group"
            >
              <p className="font-semibold text-zinc-100 group-hover:text-emerald-400 transition-colors">Compare Safety Prompts</p>
              <p className="text-xs text-zinc-500 mt-1">None vs generic vs specific</p>
            </Link>
            <Link
              href="/vulnerabilities"
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 hover:bg-zinc-800/50 transition-all group"
            >
              <p className="font-semibold text-zinc-100 group-hover:text-emerald-400 transition-colors">View All CWEs</p>
              <p className="text-xs text-zinc-500 mt-1">Full vulnerability catalog</p>
            </Link>
            <Link
              href="/pentest"
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 hover:bg-zinc-800/50 transition-all group"
            >
              <p className="font-semibold text-zinc-100 group-hover:text-emerald-400 transition-colors">Manual Pentest Results</p>
              <p className="text-xs text-zinc-500 mt-1">Human vs ZAP vs CodeStrike</p>
            </Link>
            <Link
              href="/results"
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-600 hover:bg-zinc-800/50 transition-all group"
            >
              <p className="font-semibold text-zinc-100 group-hover:text-emerald-400 transition-colors">Browse Test Results</p>
              <p className="text-xs text-zinc-500 mt-1">Individual test details</p>
            </Link>
          </div>
        </section>
      </div>
    </PageTransition>
  );
}
