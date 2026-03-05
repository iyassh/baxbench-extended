import Link from "next/link";
import { getCwesWithStats } from "@/lib/queries";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function CwesPage() {
  const cwes = getCwesWithStats();
  const withOccurrences = cwes.filter((c) => c.occurrence_count > 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">CWE Explorer</h1>
        <p className="text-muted-foreground mt-1">
          Vulnerability analysis across all models — {cwes.length} CWEs tracked
          ({cwes.filter((c) => c.is_extended).length} extended)
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>CWE</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Occurrences</TableHead>
            <TableHead>Worst Model</TableHead>
            <TableHead>Best Model</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {withOccurrences
            .sort((a, b) => b.occurrence_count - a.occurrence_count)
            .map((cwe) => (
              <TableRow key={cwe.num}>
                <TableCell>
                  <Link
                    href={`/cwes/${cwe.num}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    CWE-{cwe.num}
                  </Link>
                </TableCell>
                <TableCell className="max-w-xs truncate text-sm">{cwe.name}</TableCell>
                <TableCell>
                  <Badge variant={cwe.is_extended ? "default" : "secondary"}>
                    {cwe.is_extended ? "Extended" : "Original"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{cwe.occurrence_count}</TableCell>
                <TableCell className="text-sm text-red-600">{cwe.worst_config}</TableCell>
                <TableCell className="text-sm text-green-600">{cwe.best_config}</TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  );
}
