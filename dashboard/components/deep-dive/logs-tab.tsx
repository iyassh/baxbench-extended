"use client";

import { useState, useEffect } from "react";
import { usePreviewServer } from "@/lib/use-preview-server";
import { LogViewer } from "@/components/log-viewer";

interface TestLog {
  name: string;
  type: "functional" | "security";
  content: string;
  passed: boolean;
}

export function LogsTab({ resultId }: { resultId: number }) {
  const { isAvailable, isLoading: serverLoading, fetchFromServer } = usePreviewServer();
  const [buildLog, setBuildLog] = useState("");
  const [testLogs, setTestLogs] = useState<TestLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (serverLoading || !isAvailable) {
      setLoading(false);
      return;
    }
    fetchFromServer<{ buildLog: string; testLogs: TestLog[] }>(
      `/api/result/${resultId}/logs`
    )
      .then((data) => {
        setBuildLog(data.buildLog);
        setTestLogs(data.testLogs);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [resultId, isAvailable, serverLoading, fetchFromServer]);

  if (serverLoading || loading) {
    return <div className="animate-pulse bg-zinc-800 rounded-lg h-64" />;
  }

  if (!isAvailable) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <p className="text-sm">Start the preview server to view logs</p>
        <code className="text-xs text-zinc-600 mt-2 block">
          npm run preview-server
        </code>
      </div>
    );
  }

  if (error) {
    return <div className="text-red-400 text-sm py-4">{error}</div>;
  }

  const funcLogs = testLogs.filter((l) => l.type === "functional");
  const secLogs = testLogs.filter((l) => l.type === "security");

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

      {!buildLog && testLogs.length === 0 && (
        <div className="text-zinc-500 text-sm py-4">No logs found</div>
      )}
    </div>
  );
}
