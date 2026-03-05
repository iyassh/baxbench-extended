import Link from "next/link";
import { notFound } from "next/navigation";
import { getCweDetail } from "@/lib/queries";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function CweDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = getCweDetail(parseInt(id));
  if (!data) notFound();

  const { cwe, byConfig, byScenario, byFramework } = data;

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">CWE-{cwe.num}</h1>
          <Badge variant={cwe.is_extended ? "default" : "secondary"}>
            {cwe.is_extended ? "Extended" : "Original"}
          </Badge>
        </div>
        <p className="text-lg font-medium mt-2">{cwe.name}</p>
        <p className="text-muted-foreground mt-1 max-w-3xl">{cwe.description}</p>
        <a
          href={`https://cwe.mitre.org/data/definitions/${cwe.num}.html`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline text-sm mt-2 inline-block"
        >
          View on MITRE
        </a>
      </div>

      {/* By Model */}
      <div>
        <h2 className="text-xl font-semibold mb-4">By Model</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Occurrences</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byConfig.map((row) => (
              <TableRow key={row.name}>
                <TableCell>
                  <Link href={`/models/${row.name}`} className="text-blue-600 hover:underline">
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right">{row.cnt}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* By Scenario */}
      <div>
        <h2 className="text-xl font-semibold mb-4">By Scenario</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scenario</TableHead>
              <TableHead className="text-right">Occurrences</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byScenario.map((row) => (
              <TableRow key={row.scenario}>
                <TableCell>
                  <Link href={`/scenarios/${row.scenario}`} className="text-blue-600 hover:underline">
                    {row.scenario}
                  </Link>
                </TableCell>
                <TableCell className="text-right">{row.cnt}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* By Framework */}
      <div>
        <h2 className="text-xl font-semibold mb-4">By Framework</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Framework</TableHead>
              <TableHead className="text-right">Occurrences</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byFramework.map((row) => (
              <TableRow key={row.framework}>
                <TableCell>{row.framework}</TableCell>
                <TableCell className="text-right">{row.cnt}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
