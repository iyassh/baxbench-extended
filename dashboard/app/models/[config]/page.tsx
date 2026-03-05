import Link from "next/link";
import { notFound } from "next/navigation";
import { getConfigByName, getResultsForConfig, getAllConfigs } from "@/lib/queries";
import { StatCard } from "@/components/stat-card";
import { CweBadge } from "@/components/cwe-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function ModelPage({
  params,
}: {
  params: Promise<{ config: string }>;
}) {
  const { config: configName } = await params;
  const config = getConfigByName(decodeURIComponent(configName));
  if (!config) notFound();

  const results = getResultsForConfig(config.id);

  // Group results by scenario × framework
  const grid: Record<string, Record<string, typeof results>> = {};
  const frameworks = new Set<string>();
  const safetyPrompts = new Set<string>();

  for (const r of results) {
    if (!grid[r.scenario]) grid[r.scenario] = {};
    if (!grid[r.scenario][`${r.framework}|${r.safety_prompt}`])
      grid[r.scenario][`${r.framework}|${r.safety_prompt}`] = [];
    grid[r.scenario][`${r.framework}|${r.safety_prompt}`].push(r);
    frameworks.add(r.framework);
    safetyPrompts.add(r.safety_prompt);
  }

  const sortedFrameworks = [...frameworks].sort();
  const sortedSafetyPrompts = [...safetyPrompts].sort();
  const scenarios = Object.keys(grid).sort();

  // CWE frequency
  const cweCount: Record<number, { num: number; desc: string; count: number }> = {};
  for (const r of results) {
    for (const cwe of r.cwes) {
      if (!cweCount[cwe.cwe_num]) cweCount[cwe.cwe_num] = { num: cwe.cwe_num, desc: cwe.cwe_desc, count: 0 };
      cweCount[cwe.cwe_num].count++;
    }
  }
  const topCwes = Object.values(cweCount).sort((a, b) => b.count - a.count);

  // Safety prompt comparison
  const safetyStats = sortedSafetyPrompts.map((sp) => {
    const spResults = results.filter((r) => r.safety_prompt === sp);
    const functional = spResults.filter((r) => r.functional_pass).length;
    const secure = spResults.filter((r) => r.functional_pass && r.cwes.length === 0).length;
    return {
      safety_prompt: sp,
      total: spResults.length,
      pass_at_1: spResults.length > 0 ? functional / spResults.length : 0,
      sec_pass_at_1: spResults.length > 0 ? secure / spResults.length : 0,
    };
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">{config.name}</h1>
          <Badge variant={config.thinking ? "default" : "secondary"}>
            {config.thinking ? "thinking" : "standard"}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1">
          Model: {config.model_id}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Total Results" value={config.total_results} />
        <StatCard title="pass@1" value={`${(config.pass_at_1 * 100).toFixed(1)}%`} />
        <StatCard title="sec_pass@1" value={`${(config.sec_pass_at_1 * 100).toFixed(1)}%`} />
        <StatCard title="Total CWEs" value={config.total_cwes} />
      </div>

      {/* Safety Prompt Comparison */}
      {safetyStats.length > 1 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Safety Prompt Effect</h2>
          <div className="grid grid-cols-3 gap-4">
            {safetyStats.map((s) => (
              <div key={s.safety_prompt} className="border rounded-lg p-4">
                <div className="text-sm font-medium text-muted-foreground capitalize">
                  {s.safety_prompt}
                </div>
                <div className="text-lg font-bold mt-1">
                  sec_pass@1: {(s.sec_pass_at_1 * 100).toFixed(1)}%
                </div>
                <div className="text-sm text-muted-foreground">
                  pass@1: {(s.pass_at_1 * 100).toFixed(1)}% ({s.total} results)
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top CWEs */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Most Common Vulnerabilities</h2>
        <div className="flex flex-wrap gap-3">
          {topCwes.slice(0, 10).map((cwe) => (
            <Link key={cwe.num} href={`/cwes/${cwe.num}`}>
              <div className="border rounded-lg p-3 hover:bg-muted/50 cursor-pointer">
                <CweBadge num={cwe.num} />
                <div className="text-sm mt-1">{cwe.count} occurrences</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Per-Scenario Results */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Results by Scenario</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scenario</TableHead>
              <TableHead>Framework</TableHead>
              <TableHead>Safety</TableHead>
              <TableHead>Functional</TableHead>
              <TableHead>Security Tests</TableHead>
              <TableHead>CWEs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    href={`/scenarios/${r.scenario}`}
                    className="text-blue-600 hover:underline"
                  >
                    {r.scenario}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">{r.framework}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs capitalize">
                    {r.safety_prompt}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className={r.functional_pass ? "text-green-600" : "text-red-600"}>
                    {r.functional_pass ? "PASS" : "FAIL"}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({r.num_passed_ft}/{r.num_total_ft})
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  {r.num_total_st - (r.num_st_exceptions ?? 0) - (r.cwes?.length ?? 0)}/{r.num_total_st} pass
                  {r.num_st_exceptions > 0 && (
                    <span className="text-amber-600 ml-1">({r.num_st_exceptions} err)</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {r.cwes.map((cwe, i) => (
                      <CweBadge key={i} num={cwe.cwe_num} desc={cwe.cwe_desc} />
                    ))}
                    {r.cwes.length === 0 && r.functional_pass && (
                      <Badge variant="outline" className="text-green-600 border-green-600">
                        Secure
                      </Badge>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
