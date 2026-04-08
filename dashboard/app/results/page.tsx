import { Fragment } from "react";
import { loadConfigs, loadSafetyComparison, loadFrameworkComparison } from "@/lib/data";
import { StatCard } from "@/components/stat-card";

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function pctColor(v: number): string {
  const p = v * 100;
  if (p >= 60) return "text-emerald-400";
  if (p >= 30) return "text-amber-400";
  return "text-red-400";
}

function secColor(v: number): string {
  const p = v * 100;
  if (p >= 10) return "text-emerald-400";
  if (p >= 5) return "text-amber-400";
  return "text-red-400";
}

export default function ResultsPage() {
  const configs = loadConfigs();
  const safetyData = loadSafetyComparison();
  const frameworkData = loadFrameworkComparison();

  const active = configs.filter((c) => c.total_results > 0);
  const totalResults = active.reduce((s, c) => s + c.total_results, 0);
  const modelCount = active.length;

  const avgPass =
    modelCount > 0
      ? active.reduce((s, c) => s + c.pass_at_1, 0) / modelCount
      : 0;
  const avgSec =
    modelCount > 0
      ? active.reduce((s, c) => s + c.sec_pass_at_1, 0) / modelCount
      : 0;
  const avgTrueSec =
    modelCount > 0
      ? active.reduce((s, c) => s + c.true_sec_pass_at_1, 0) / modelCount
      : 0;
  const totalCwes = active.reduce((s, c) => s + c.total_cwes, 0);

  // Sort by pass@1 descending
  const sorted = [...active].sort((a, b) => b.pass_at_1 - a.pass_at_1);

  // Safety comparison: group by config_name
  const safetyByConfig = new Map<string, typeof safetyData>();
  for (const row of safetyData) {
    if (!safetyByConfig.has(row.config_name)) {
      safetyByConfig.set(row.config_name, []);
    }
    safetyByConfig.get(row.config_name)!.push(row);
  }

  // Framework aggregation
  const frameworks = ["Python-Flask", "JavaScript-express", "Go-Fiber"];
  const fwAgg = frameworks.map((fw) => {
    const rows = frameworkData.filter((r) => r.framework === fw);
    const total = rows.reduce((s, r) => s + r.total, 0);
    const funcPasses = rows.reduce((s, r) => s + r.functional_passes, 0);
    const secPasses = rows.reduce((s, r) => s + r.secure_passes, 0);
    return {
      framework: fw,
      total,
      functional_passes: funcPasses,
      secure_passes: secPasses,
      pass_rate: total > 0 ? funcPasses / total : 0,
      sec_rate: total > 0 ? secPasses / total : 0,
    };
  });

  const fwLabels: Record<string, string> = {
    "Python-Flask": "Py",
    "JavaScript-express": "JS",
    "Go-Fiber": "Go",
  };

  return (
    <div className="space-y-12">
      {/* ─── Header ─── */}
      <section>
        <h1 className="font-[family-name:var(--font-display)] text-4xl md:text-5xl font-bold tracking-tight">
          Benchmark Results
        </h1>
        <p className="text-zinc-400 text-lg mt-3">
          Complete results for all model configurations tested in BaxBench
        </p>
      </section>

      {/* ─── Section 1: Key Metrics Summary ─── */}
      <section>
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight mb-6">
          Key Metrics
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard
            title="Total Results"
            value={totalResults}
            accent="emerald"
          />
          <StatCard
            title="Avg pass@1"
            value={`${(avgPass * 100).toFixed(1)}%`}
            accent="blue"
          />
          <StatCard
            title="Avg sec_pass@1"
            value={`${(avgSec * 100).toFixed(1)}%`}
            accent="amber"
            subtitle="Includes crashes"
          />
          <StatCard
            title="Avg true_sec@1"
            value={`${(avgTrueSec * 100).toFixed(1)}%`}
            accent="green"
            subtitle="Clean tests only"
          />
          <StatCard
            title="Total CWEs"
            value={totalCwes}
            accent="red"
          />
          <StatCard
            title="Models Tested"
            value={modelCount}
            accent="purple"
            subtitle={`${active.filter((c) => c.thinking).length} thinking / ${active.filter((c) => !c.thinking).length} standard`}
          />
        </div>
      </section>

      {/* ─── Section 2: Model Performance Table ─── */}
      <section>
        <div className="mb-6">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
            Model Performance
          </h2>
          <p className="text-zinc-500 text-sm mt-1">
            All configurations sorted by pass@1 descending
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-6 py-4 font-medium">#</th>
                  <th className="text-left px-6 py-4 font-medium">Model</th>
                  <th className="text-left px-6 py-4 font-medium">Mode</th>
                  <th className="text-right px-6 py-4 font-medium">pass@1</th>
                  <th className="text-right px-6 py-4 font-medium">sec_pass@1</th>
                  <th className="text-right px-6 py-4 font-medium">true_sec@1</th>
                  <th className="text-right px-6 py-4 font-medium">Secure by Crash</th>
                  <th className="text-right px-6 py-4 font-medium">Total CWEs</th>
                  <th className="text-right px-6 py-4 font-medium">Results</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c, i) => (
                  <tr
                    key={c.id}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="px-6 py-4 text-zinc-500 tabular-nums">
                      {i + 1}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-zinc-100 font-medium">
                        {c.name}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {c.thinking ? (
                        <span className="inline-flex items-center rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs px-2.5 py-0.5">
                          thinking
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-zinc-700/30 border border-zinc-700 text-zinc-400 text-xs px-2.5 py-0.5">
                          standard
                        </span>
                      )}
                    </td>
                    <td className={`px-6 py-4 text-right tabular-nums font-semibold ${pctColor(c.pass_at_1)}`}>
                      {pct(c.pass_at_1)}
                    </td>
                    <td className={`px-6 py-4 text-right tabular-nums font-semibold ${secColor(c.sec_pass_at_1)}`}>
                      {pct(c.sec_pass_at_1)}
                    </td>
                    <td className={`px-6 py-4 text-right tabular-nums font-semibold ${secColor(c.true_sec_pass_at_1)}`}>
                      {pct(c.true_sec_pass_at_1)}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-zinc-300">
                      <span className={c.secure_by_crash > 0 ? "text-amber-400" : c.secure_by_crash < 0 ? "text-red-400" : "text-zinc-500"}>
                        {c.secure_by_crash > 0 ? `+${c.secure_by_crash}` : c.secure_by_crash}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-zinc-300">
                      {c.total_cwes}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-zinc-300">
                      {c.total_results}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── Section 3: Safety Prompt Impact ─── */}
      <section>
        <div className="mb-6">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
            Safety Prompt Impact
          </h2>
          <p className="text-zinc-500 text-sm mt-1">
            How none vs generic vs specific safety prompts affect functional and security pass rates per model
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from(safetyByConfig.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([configName, rows]) => {
              const none = rows.find((r) => r.safety_prompt === "none");
              const generic = rows.find((r) => r.safety_prompt === "generic");
              const specific = rows.find((r) => r.safety_prompt === "specific");

              const variants = [
                { label: "None", data: none, color: "zinc" as const },
                { label: "Generic", data: generic, color: "blue" as const },
                { label: "Specific", data: specific, color: "emerald" as const },
              ];

              return (
                <div
                  key={configName}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-5"
                >
                  <h3 className="text-zinc-100 font-semibold text-sm mb-4 truncate" title={configName}>
                    {configName}
                  </h3>
                  <div className="space-y-3">
                    {variants.map(({ label, data, color }) => {
                      if (!data) return null;
                      const funcRate = data.total > 0 ? (data.functional_passes / data.total) * 100 : 0;
                      const secRate = data.total > 0 ? (data.secure_passes / data.total) * 100 : 0;

                      return (
                        <div key={label} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className={`text-xs font-medium ${
                              color === "emerald" ? "text-emerald-400" :
                              color === "blue" ? "text-blue-400" :
                              "text-zinc-400"
                            }`}>
                              {label}
                            </span>
                            <span className="text-xs text-zinc-500">
                              {data.total} tests
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="bg-zinc-800/50 rounded-lg px-2.5 py-1.5 text-center">
                              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Functional</p>
                              <p className="text-xs font-semibold tabular-nums text-zinc-200">
                                {funcRate.toFixed(1)}%
                              </p>
                            </div>
                            <div className="bg-zinc-800/50 rounded-lg px-2.5 py-1.5 text-center">
                              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Secure</p>
                              <p className={`text-xs font-semibold tabular-nums ${secRate > 0 ? "text-emerald-400" : "text-zinc-500"}`}>
                                {secRate.toFixed(1)}%
                              </p>
                            </div>
                          </div>
                          {/* Progress bar */}
                          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden flex gap-px">
                            <div
                              className="bg-blue-500/70 rounded-full transition-all"
                              style={{ width: `${funcRate}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      </section>

      {/* ─── Section 4: Framework Breakdown ─── */}
      <section>
        <div className="mb-6">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
            Framework Comparison
          </h2>
          <p className="text-zinc-500 text-sm mt-1">
            Aggregate performance across Python-Flask, JavaScript-express, and Go-Fiber
          </p>
        </div>

        {/* Framework summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {fwAgg.map((fw) => (
            <div
              key={fw.framework}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-lg font-bold text-zinc-300">
                  {fwLabels[fw.framework]}
                </div>
                <div>
                  <h3 className="text-zinc-100 font-semibold text-sm">
                    {fw.framework}
                  </h3>
                  <p className="text-zinc-500 text-xs">
                    {fw.total.toLocaleString()} total tests
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
                    Functional Pass
                  </p>
                  <p className={`text-2xl font-bold tabular-nums ${pctColor(fw.pass_rate)}`}>
                    {(fw.pass_rate * 100).toFixed(1)}%
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {fw.functional_passes.toLocaleString()} / {fw.total.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
                    Secure Pass
                  </p>
                  <p className={`text-2xl font-bold tabular-nums ${secColor(fw.sec_rate)}`}>
                    {(fw.sec_rate * 100).toFixed(1)}%
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {fw.secure_passes.toLocaleString()} / {fw.total.toLocaleString()}
                  </p>
                </div>
              </div>
              {/* Bar visualization */}
              <div className="mt-4 space-y-2">
                <div>
                  <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
                    <span>Functional</span>
                    <span>{(fw.pass_rate * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${fw.pass_rate * 100}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
                    <span>Secure</span>
                    <span>{(fw.sec_rate * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${Math.min(fw.sec_rate * 100 * 5, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Per-model framework breakdown table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-6 py-4 font-medium">Model</th>
                  {frameworks.map((fw) => (
                    <th key={fw} className="text-center px-4 py-4 font-medium" colSpan={2}>
                      {fw.replace("-", " ")}
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-zinc-800 text-zinc-500 text-[10px] uppercase tracking-wider">
                  <th className="text-left px-6 py-2"></th>
                  {frameworks.map((fw) => (
                    <Fragment key={fw}>
                      <th className="text-right px-3 py-2 font-medium">Func%</th>
                      <th className="text-right px-3 py-2 font-medium">Sec%</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...active]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((config) => (
                    <tr
                      key={config.id}
                      className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
                    >
                      <td className="px-6 py-3 text-zinc-100 text-xs font-medium whitespace-nowrap">
                        {config.name}
                      </td>
                      {frameworks.map((fw) => {
                        const row = frameworkData.find(
                          (r) => r.framework === fw && r.config_name === config.name
                        );
                        if (!row) {
                          return (
                            <Fragment key={fw}>
                              <td className="px-3 py-3 text-right text-zinc-600 text-xs">--</td>
                              <td className="px-3 py-3 text-right text-zinc-600 text-xs">--</td>
                            </Fragment>
                          );
                        }
                        const funcRate = row.total > 0 ? row.functional_passes / row.total : 0;
                        const secRate = row.total > 0 ? row.secure_passes / row.total : 0;
                        return (
                          <Fragment key={fw}>
                            <td className={`px-3 py-3 text-right tabular-nums text-xs font-medium ${pctColor(funcRate)}`}>
                              {(funcRate * 100).toFixed(1)}%
                            </td>
                            <td className={`px-3 py-3 text-right tabular-nums text-xs font-medium ${secColor(secRate)}`}>
                              {(secRate * 100).toFixed(1)}%
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
