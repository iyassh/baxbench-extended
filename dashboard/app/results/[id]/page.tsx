import Link from "next/link";
import { notFound } from "next/navigation";
import { getResultById } from "@/lib/queries";
import { CweBadge } from "@/components/cwe-badge";
import { CodeViewer } from "@/components/code-viewer";
import { LogViewer } from "@/components/log-viewer";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import fs from "fs";
import path from "path";

function readFileContent(relativePath: string): string | null {
  try {
    const fullPath = path.join(process.cwd(), "..", relativePath);
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

function readCodeDir(relativePath: string): { name: string; content: string }[] {
  try {
    const dirPath = path.dirname(path.join(process.cwd(), "..", relativePath));
    const files = fs.readdirSync(dirPath);
    return files.map((f) => ({
      name: f,
      content: fs.readFileSync(path.join(dirPath, f), "utf-8"),
    }));
  } catch {
    return [];
  }
}

function readTestLogs(testLogPath: string): { name: string; content: string }[] {
  try {
    const sampleDir = path.dirname(path.join(process.cwd(), "..", testLogPath));
    const files = fs.readdirSync(sampleDir).filter(
      (f) => (f.startsWith("sec_test_") || f.startsWith("func_test_")) && f.endsWith(".log")
    );
    return files.map((f) => ({
      name: f.replace(".log", ""),
      content: fs.readFileSync(path.join(sampleDir, f), "utf-8"),
    }));
  } catch {
    return [];
  }
}

export default async function ResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = getResultById(parseInt(id));
  if (!result) notFound();

  const codeFiles = result.code_path ? readCodeDir(result.code_path) : [];
  const testLog = result.test_log_path ? readFileContent(result.test_log_path) : null;
  const testLogs = result.test_log_path ? readTestLogs(result.test_log_path) : [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">
          {result.scenario} / {result.framework}
        </h1>
        <div className="flex items-center gap-3 mt-2">
          <Link href={`/models/${result.config_name}`}>
            <Badge variant="outline">{result.config_name}</Badge>
          </Link>
          <Badge variant="outline" className="capitalize">
            safety: {result.safety_prompt}
          </Badge>
          <Badge variant="outline">sample {result.sample}</Badge>
        </div>
      </div>

      {/* Test Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Functional Tests</div>
          <div className={`text-xl font-bold ${result.functional_pass ? "text-green-600" : "text-red-600"}`}>
            {result.functional_pass ? "PASS" : "FAIL"}
          </div>
          <div className="text-sm text-muted-foreground">
            {result.num_passed_ft}/{result.num_total_ft} passed
          </div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Security Tests</div>
          <div className="text-xl font-bold">
            {result.num_total_st - (result.num_st_exceptions ?? 0) - result.cwes.length}/{result.num_total_st}
          </div>
          <div className="text-sm text-muted-foreground">
            {result.num_st_exceptions > 0 && `${result.num_st_exceptions} exceptions`}
          </div>
        </div>
        <div className="border rounded-lg p-4 col-span-2">
          <div className="text-sm text-muted-foreground mb-2">CWEs Detected</div>
          {result.cwes.length === 0 ? (
            <Badge variant="outline" className="text-green-600 border-green-600">
              No vulnerabilities found
            </Badge>
          ) : (
            <div className="flex flex-wrap gap-2">
              {result.cwes.map((cwe, i) => (
                <Link key={i} href={`/cwes/${cwe.cwe_num}`}>
                  <div className="border border-red-200 bg-red-50 rounded px-2 py-1">
                    <span className="font-medium text-red-700 text-sm">CWE-{cwe.cwe_num}</span>
                    <p className="text-xs text-red-600 mt-0.5 max-w-xs truncate">{cwe.cwe_desc}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Generated Code */}
      {codeFiles.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Generated Code</h2>
          {codeFiles.map((file) => (
            <div key={file.name} className="mb-4">
              <CodeViewer code={file.content} filename={file.name} />
            </div>
          ))}
        </div>
      )}

      <Separator />

      {/* Individual Test Logs */}
      {testLogs.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Test Logs</h2>
          <div className="space-y-2">
            {testLogs.map((log) => (
              <LogViewer key={log.name} title={log.name} content={log.content} />
            ))}
          </div>
        </div>
      )}

      {/* Full Test Log */}
      {testLog && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Full Test Output</h2>
          <LogViewer title="test.log" content={testLog} />
        </div>
      )}
    </div>
  );
}
