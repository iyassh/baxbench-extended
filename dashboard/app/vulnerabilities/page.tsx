import { getCwesWithStats, getCweTreemapData } from "@/lib/queries";
import { StatCard } from "@/components/stat-card";
import { PageTransition } from "@/components/page-transition";
import { CweTreemap } from "@/components/charts/cwe-treemap";
import { CweList } from "@/components/cwe-list";
import { OwaspTop10 } from "@/components/owasp-top10";

export default function VulnerabilitiesPage() {
  const cwes = getCwesWithStats();
  const treemapData = getCweTreemapData();

  // Filter to only CWEs that actually appeared in results
  const cwesWithOccurrences = cwes.filter((c) => c.occurrence_count > 0);

  // Sort by occurrence for stats computation
  const sortedCwes = [...cwesWithOccurrences].sort(
    (a, b) => b.occurrence_count - a.occurrence_count
  );

  const totalCwes = cwesWithOccurrences.length;
  const originalCount = cwesWithOccurrences.filter((c) => !c.is_extended).length;
  const extendedCount = cwesWithOccurrences.filter((c) => c.is_extended).length;
  const mostCommon = sortedCwes[0];
  const totalOccurrences = cwesWithOccurrences.reduce(
    (sum, c) => sum + c.occurrence_count,
    0
  );

  return (
    <PageTransition>
      <div className="space-y-12">
        {/* Header */}
        <section>
          <h1 className="font-[family-name:var(--font-display)] text-4xl md:text-5xl font-bold tracking-tight">
            Vulnerabilities
          </h1>
          <p className="text-zinc-400 text-lg mt-3">
            CWE analysis across all model configurations
          </p>
        </section>

        {/* Stat Cards */}
        <section>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              title="CWEs Detected"
              value={totalCwes}
              subtitle={`${originalCount} original / ${extendedCount} extended (of ${cwes.length} monitored)`}
              accent="red"
            />
            <StatCard
              title="Most Common"
              value={mostCommon ? mostCommon.name : "N/A"}
              subtitle={
                mostCommon
                  ? `${mostCommon.name} — ${mostCommon.occurrence_count} occurrences`
                  : undefined
              }
              accent="amber"
            />
            <StatCard
              title="Total Occurrences"
              value={totalOccurrences}
              accent="red"
            />
          </div>
        </section>

        {/* OWASP Top 10 2025 */}
        <section>
          <div className="mb-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
              OWASP Top 10 2025 Coverage
            </h2>
            <p className="text-zinc-500 text-sm mt-1">
              How AI-generated code performs against the latest OWASP security categories
            </p>
          </div>
          <OwaspTop10 cwes={cwes} />
        </section>

        {/* CWE Treemap */}
        {treemapData.length > 0 && (
          <section>
            <div className="mb-6">
              <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
                CWE Treemap
              </h2>
              <p className="text-zinc-500 text-sm mt-1">
                Rectangle size indicates occurrence count, color intensity
                indicates number of affected models
              </p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
              <CweTreemap data={treemapData} />
            </div>
          </section>
        )}

        {/* CWE List */}
        <section>
          <div className="mb-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
              All Vulnerabilities
            </h2>
            <p className="text-zinc-500 text-sm mt-1">
              Expandable list of all CWEs with filtering and search
            </p>
          </div>
          <CweList cwes={sortedCwes} />
        </section>
      </div>
    </PageTransition>
  );
}
