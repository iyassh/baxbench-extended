import Link from "next/link";
import { getAllConfigs, getAllScenarios } from "@/lib/queries";
import { StatCard } from "@/components/stat-card";
import { PassRateChart } from "@/components/charts/pass-rate-chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function OverviewPage() {
  const configs = getAllConfigs();
  const scenarios = getAllScenarios();

  const configsWithResults = configs.filter((c) => c.total_results > 0);
  const totalResults = configsWithResults.reduce((s, c) => s + c.total_results, 0);
  const totalCwes = configsWithResults.reduce((s, c) => s + c.total_cwes, 0);

  const bestModel = configsWithResults.length > 0
    ? [...configsWithResults].sort((a, b) => b.sec_pass_at_1 - a.sec_pass_at_1)[0]
    : null;
  const worstModel = configsWithResults.length > 0
    ? [...configsWithResults].sort((a, b) => a.sec_pass_at_1 - b.sec_pass_at_1)[0]
    : null;

  const chartData = configsWithResults
    .sort((a, b) => b.sec_pass_at_1 - a.sec_pass_at_1)
    .map((c) => ({
      name: c.name,
      pass_at_1: c.pass_at_1,
      sec_pass_at_1: c.sec_pass_at_1,
    }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">BaxBench Security Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Security benchmark results across {configsWithResults.length} model configurations
          and {scenarios.length} scenarios
        </p>
      </div>

      {/* Scorecard Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Total Generations" value={totalResults} />
        <StatCard title="CWEs Found" value={totalCwes} />
        <StatCard
          title="Most Secure"
          value={bestModel?.name ?? "N/A"}
          subtitle={bestModel ? `sec_pass@1: ${(bestModel.sec_pass_at_1 * 100).toFixed(1)}%` : undefined}
        />
        <StatCard
          title="Least Secure"
          value={worstModel?.name ?? "N/A"}
          subtitle={worstModel ? `sec_pass@1: ${(worstModel.sec_pass_at_1 * 100).toFixed(1)}%` : undefined}
        />
      </div>

      {/* Bar Chart */}
      {chartData.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">pass@1 vs sec_pass@1 by Model</h2>
          <PassRateChart data={chartData} />
        </div>
      )}

      {/* Config Summary Table */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Model Configurations</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Config</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead className="text-right">Results</TableHead>
              <TableHead className="text-right">pass@1</TableHead>
              <TableHead className="text-right">sec_pass@1</TableHead>
              <TableHead className="text-right">CWEs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {configsWithResults.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link
                    href={`/models/${c.name}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={c.thinking ? "default" : "secondary"}>
                    {c.thinking ? "thinking" : "standard"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{c.total_results}</TableCell>
                <TableCell className="text-right">
                  {(c.pass_at_1 * 100).toFixed(1)}%
                </TableCell>
                <TableCell className="text-right">
                  {(c.sec_pass_at_1 * 100).toFixed(1)}%
                </TableCell>
                <TableCell className="text-right">{c.total_cwes}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Scenario Quick Links */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Scenarios</h2>
        <div className="flex flex-wrap gap-2">
          {scenarios.map((s) => (
            <Link key={s.scenario} href={`/scenarios/${s.scenario}`}>
              <Badge variant="outline" className="cursor-pointer hover:bg-muted">
                {s.scenario}
              </Badge>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
