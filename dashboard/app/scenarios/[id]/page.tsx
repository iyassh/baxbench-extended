import Link from "next/link";
import { notFound } from "next/navigation";
import { getScenarioResults, getPromptsForScenario } from "@/lib/queries";
import { CweBadge } from "@/components/cwe-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatCard } from "@/components/stat-card";

export default async function ScenarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scenario = decodeURIComponent(id);
  const results = getScenarioResults(scenario);
  const prompts = getPromptsForScenario(scenario);

  if (results.length === 0 && prompts.length === 0) notFound();

  const totalResults = results.length;
  const functionalPasses = results.filter((r) => r.functional_pass).length;
  const securePasses = results.filter(
    (r) => r.functional_pass && r.cwes.length === 0
  ).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{scenario}</h1>
        <p className="text-muted-foreground mt-1">
          {totalResults} results across all models and frameworks
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard title="Total Results" value={totalResults} />
        <StatCard
          title="pass@1"
          value={`${totalResults > 0 ? ((functionalPasses / totalResults) * 100).toFixed(1) : 0}%`}
        />
        <StatCard
          title="sec_pass@1"
          value={`${totalResults > 0 ? ((securePasses / totalResults) * 100).toFixed(1) : 0}%`}
        />
      </div>

      {/* Prompts */}
      {prompts.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Prompts</h2>
          <Tabs defaultValue={prompts[0]?.safety_prompt ?? "none"}>
            <TabsList>
              {[...new Set(prompts.map((p) => p.safety_prompt))].map((sp) => (
                <TabsTrigger key={sp} value={sp} className="capitalize">
                  {sp}
                </TabsTrigger>
              ))}
            </TabsList>
            {[...new Set(prompts.map((p) => p.safety_prompt))].map((sp) => (
              <TabsContent key={sp} value={sp}>
                {prompts
                  .filter((p) => p.safety_prompt === sp)
                  .slice(0, 1)
                  .map((p) => (
                    <div key={p.id} className="mt-2">
                      <div className="text-sm text-muted-foreground mb-2">
                        Framework: {p.framework} | Spec: {p.spec_type}
                      </div>
                      <pre className="bg-zinc-950 text-zinc-300 p-4 rounded-md text-xs overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
                        {p.prompt_text}
                      </pre>
                    </div>
                  ))}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      )}

      {/* Results Table */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Results</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Framework</TableHead>
              <TableHead>Safety</TableHead>
              <TableHead>Functional</TableHead>
              <TableHead>Security</TableHead>
              <TableHead>CWEs</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    href={`/models/${r.config_name}`}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    {r.config_name}
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
                </TableCell>
                <TableCell className="text-sm">
                  {r.num_total_st - (r.num_st_exceptions ?? 0) - r.cwes.length}/{r.num_total_st}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {r.cwes.map((cwe, i) => (
                      <CweBadge key={i} num={cwe.cwe_num} desc={cwe.cwe_desc} />
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/results/${r.id}`}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
