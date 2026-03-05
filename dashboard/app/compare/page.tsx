import {
  getThinkingComparison,
  getSafetyPromptComparison,
  getFrameworkComparison,
  getAllConfigs,
} from "@/lib/queries";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { SafetyComparisonChart } from "@/components/charts/safety-comparison-chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ComparePage() {
  const thinkingPairs = getThinkingComparison();
  const safetyData = getSafetyPromptComparison();
  const frameworkData = getFrameworkComparison();
  const allConfigs = getAllConfigs().filter((c) => c.total_results > 0);

  // Build safety chart data
  const safetyChartData: Record<string, { config_name: string; none: number; generic: number; specific: number }> = {};
  for (const row of safetyData) {
    if (!safetyChartData[row.config_name]) {
      safetyChartData[row.config_name] = { config_name: row.config_name, none: 0, generic: 0, specific: 0 };
    }
    const rate = row.total > 0 ? Math.round((row.secure_passes / row.total) * 1000) / 10 : 0;
    safetyChartData[row.config_name][row.safety_prompt as "none" | "generic" | "specific"] = rate;
  }

  // Framework comparison
  const fwByFramework: Record<string, typeof frameworkData> = {};
  for (const row of frameworkData) {
    if (!fwByFramework[row.framework]) fwByFramework[row.framework] = [];
    fwByFramework[row.framework].push(row);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Comparisons</h1>
        <p className="text-muted-foreground mt-1">
          Side-by-side analysis across dimensions
        </p>
      </div>

      <Tabs defaultValue="safety">
        <TabsList>
          <TabsTrigger value="safety">Safety Prompts</TabsTrigger>
          <TabsTrigger value="thinking">Thinking vs Standard</TabsTrigger>
          <TabsTrigger value="frameworks">Frameworks</TabsTrigger>
          <TabsTrigger value="tiers">Model Tiers</TabsTrigger>
        </TabsList>

        {/* Safety Prompts Tab */}
        <TabsContent value="safety" className="space-y-6">
          <h2 className="text-xl font-semibold">Effect of Safety Prompts on sec_pass@1</h2>
          {Object.values(safetyChartData).length > 0 && (
            <SafetyComparisonChart data={Object.values(safetyChartData)} />
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Config</TableHead>
                <TableHead className="text-right">None</TableHead>
                <TableHead className="text-right">Generic</TableHead>
                <TableHead className="text-right">Specific</TableHead>
                <TableHead className="text-right">Improvement</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.values(safetyChartData).map((row) => (
                <TableRow key={row.config_name}>
                  <TableCell className="font-medium">{row.config_name}</TableCell>
                  <TableCell className="text-right">{row.none}%</TableCell>
                  <TableCell className="text-right">{row.generic}%</TableCell>
                  <TableCell className="text-right">{row.specific}%</TableCell>
                  <TableCell className="text-right">
                    <span className={row.specific > row.none ? "text-green-600" : "text-red-600"}>
                      {row.specific - row.none > 0 ? "+" : ""}
                      {(row.specific - row.none).toFixed(1)}pp
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        {/* Thinking vs Standard Tab */}
        <TabsContent value="thinking" className="space-y-6">
          <h2 className="text-xl font-semibold">Thinking Mode vs Standard</h2>
          {thinkingPairs.length === 0 ? (
            <p className="text-muted-foreground">
              No thinking/standard pairs with results yet. Run benchmarks for both modes to see this comparison.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Standard sec_pass@1</TableHead>
                  <TableHead className="text-right">Thinking sec_pass@1</TableHead>
                  <TableHead className="text-right">Delta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {thinkingPairs.map((pair) => {
                  const delta = pair.thinking.sec_pass_at_1 - pair.standard.sec_pass_at_1;
                  return (
                    <TableRow key={pair.standard.name}>
                      <TableCell className="font-medium">
                        {pair.standard.name.replace("-standard", "")}
                      </TableCell>
                      <TableCell className="text-right">
                        {(pair.standard.sec_pass_at_1 * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">
                        {(pair.thinking.sec_pass_at_1 * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={delta > 0 ? "text-green-600" : delta < 0 ? "text-red-600" : ""}>
                          {delta > 0 ? "+" : ""}{(delta * 100).toFixed(1)}pp
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* Frameworks Tab */}
        <TabsContent value="frameworks" className="space-y-6">
          <h2 className="text-xl font-semibold">Framework Comparison</h2>
          {Object.entries(fwByFramework).map(([fw, rows]) => (
            <div key={fw}>
              <h3 className="text-lg font-medium mb-2">{fw}</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Config</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">pass@1</TableHead>
                    <TableHead className="text-right">sec_pass@1</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.config_name}>
                      <TableCell>{row.config_name}</TableCell>
                      <TableCell className="text-right">{row.total}</TableCell>
                      <TableCell className="text-right">
                        {row.total > 0 ? ((row.functional_passes / row.total) * 100).toFixed(1) : 0}%
                      </TableCell>
                      <TableCell className="text-right">
                        {row.total > 0 ? ((row.secure_passes / row.total) * 100).toFixed(1) : 0}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </TabsContent>

        {/* Model Tiers Tab */}
        <TabsContent value="tiers" className="space-y-6">
          <h2 className="text-xl font-semibold">Model Tiers</h2>
          <p className="text-muted-foreground">Haiku vs Sonnet vs Opus performance</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Config</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Results</TableHead>
                <TableHead className="text-right">pass@1</TableHead>
                <TableHead className="text-right">sec_pass@1</TableHead>
                <TableHead className="text-right">CWEs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allConfigs
                .sort((a, b) => b.sec_pass_at_1 - a.sec_pass_at_1)
                .map((c) => {
                  const tier = c.name.includes("opus")
                    ? "Opus"
                    : c.name.includes("sonnet")
                    ? "Sonnet"
                    : "Haiku";
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{tier}</Badge>
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
                  );
                })}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  );
}
