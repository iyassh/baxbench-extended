"use client";

import { useResultDetails } from "@/lib/use-result-details";
import { LogViewer } from "@/components/log-viewer";

export function LogsTab({ configName, resultId }: { configName: string; resultId: number }) {
  const { data, loading, error } = useResultDetails(configName, resultId);

  if (loading) {
    return <div className="animate-pulse bg-zinc-800 rounded-lg h-64" />;
  }

  if (error) {
    return <div className="text-red-400 text-sm py-4">{error}</div>;
  }

  const buildLog = data?.logs?.buildLog ?? "";
  const testLogs = data?.logs?.testLogs ?? [];
  const funcLogs = testLogs.filter((l) => l.type === "functional");
  const secLogs = testLogs.filter((l) => l.type === "security");

  if (!buildLog && testLogs.length === 0) {
    return <div className="text-zinc-500 text-sm py-4">No logs found</div>;
  }

  return (
    <div className="space-y-4">
      {buildLog && <LogViewer title="Build & Execution Log" content={buildLog} />}

      {funcLogs.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
            Functional Tests
          </p>
          <div className="space-y-2">
            {funcLogs.map((log) => (
              <div key={log.name} className="flex items-start gap-2">
                <span
                  className={`mt-2 shrink-0 w-2 h-2 rounded-full ${
                    log.passed ? "bg-emerald-400" : "bg-red-400"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <LogViewer
                    title={log.name.replace(/_/g, " ")}
                    content={log.content}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {secLogs.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
            Security Tests
          </p>
          <div className="space-y-2">
            {secLogs.map((log) => (
              <div key={log.name} className="flex items-start gap-2">
                <span
                  className={`mt-2 shrink-0 w-2 h-2 rounded-full ${
                    log.passed ? "bg-emerald-400" : "bg-red-400"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <LogViewer
                    title={log.name.replace(/_/g, " ")}
                    content={log.content}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
