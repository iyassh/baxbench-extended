"use client";

import { useState } from "react";
import { usePreviewServer } from "@/lib/use-preview-server";

export function PreviewTab({
  resultId,
  framework,
  scenario,
}: {
  resultId: number;
  framework: string;
  scenario: string;
}) {
  const { isAvailable, hasDocker, isLoading: serverLoading } = usePreviewServer();
  const [port, setPort] = useState<number | null>(null);
  const [containerId, setContainerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // API tester state
  const [method, setMethod] = useState<string>("GET");
  const [path, setPath] = useState("/");
  const [body, setBody] = useState("");
  const [response, setResponse] = useState<{
    status: number;
    statusText: string;
    headers: string;
    body: string;
    time: number;
  } | null>(null);
  const [sending, setSending] = useState(false);

  const handleStart = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `http://localhost:3001/api/result/${resultId}/preview/start`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPort(data.port);
      setContainerId(data.containerId);
      await new Promise((r) => setTimeout(r, 3000));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (!containerId) return;
    try {
      await fetch(`http://localhost:3001/api/result/${resultId}/preview/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ containerId }),
      });
    } catch {}
    setPort(null);
    setContainerId(null);
    setResponse(null);
  };

  const handleSend = async () => {
    if (!port) return;
    setSending(true);
    setResponse(null);
    const start = Date.now();
    try {
      const opts: RequestInit = {
        method,
        headers: { "Content-Type": "application/json" },
      };
      if (method !== "GET" && method !== "HEAD" && body.trim()) {
        opts.body = body;
      }
      const res = await fetch(`http://localhost:${port}${path}`, opts);
      const time = Date.now() - start;
      const text = await res.text();
      let prettyBody = text;
      try {
        prettyBody = JSON.stringify(JSON.parse(text), null, 2);
      } catch {}

      const hdrs: string[] = [];
      res.headers.forEach((v, k) => hdrs.push(`${k}: ${v}`));

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: hdrs.join("\n"),
        body: prettyBody,
        time,
      });
    } catch (e: any) {
      setResponse({
        status: 0,
        statusText: "Connection failed",
        headers: "",
        body: e.message,
        time: Date.now() - start,
      });
    } finally {
      setSending(false);
    }
  };

  if (serverLoading) {
    return <div className="animate-pulse bg-zinc-800 rounded-lg h-64" />;
  }

  if (!isAvailable) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <p className="text-sm">Live preview is only available locally</p>
        <code className="text-xs text-zinc-600 mt-2 block">
          npm run preview-server
        </code>
      </div>
    );
  }

  if (!hasDocker) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <p className="text-sm">Docker is required for live preview</p>
        <p className="text-xs text-zinc-600 mt-1">
          Install and start Docker Desktop to enable this feature
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="inline-block w-8 h-8 border-2 border-zinc-600 border-t-blue-400 rounded-full animate-spin mb-4" />
        <p className="text-sm text-zinc-400">
          Building Docker image for {framework}...
        </p>
        <p className="text-xs text-zinc-600 mt-1">
          This may take 30-60 seconds
        </p>
      </div>
    );
  }

  if (port) {
    return (
      <div className="space-y-4">
        {/* Status bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm text-zinc-300">
              Running on{" "}
              <span className="text-blue-400 font-mono">
                localhost:{port}
              </span>
            </span>
          </div>
          <button
            onClick={handleStop}
            className="text-xs px-3 py-1.5 rounded-md bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
          >
            Stop
          </button>
        </div>

        {/* Request builder */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
          <div className="flex gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1.5 text-sm text-zinc-200 font-mono"
            >
              {["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <div className="flex-1 flex items-center bg-zinc-800 border border-zinc-700 rounded-md overflow-hidden">
              <span className="text-xs text-zinc-500 px-2 font-mono shrink-0">
                localhost:{port}
              </span>
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/endpoint"
                className="flex-1 bg-transparent px-1 py-1.5 text-sm text-zinc-200 font-mono outline-none"
              />
            </div>
            <button
              onClick={handleSend}
              disabled={sending}
              className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {sending ? "..." : "Send"}
            </button>
          </div>

          {method !== "GET" && method !== "HEAD" && (
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                Request Body (JSON)
              </p>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder='{"key": "value"}'
                rows={3}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 font-mono outline-none resize-none"
              />
            </div>
          )}
        </div>

        {/* Response */}
        {response && (
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800">
              <span
                className={`text-sm font-bold font-mono ${
                  response.status >= 200 && response.status < 300
                    ? "text-emerald-400"
                    : response.status >= 400
                      ? "text-red-400"
                      : response.status === 0
                        ? "text-red-400"
                        : "text-amber-400"
                }`}
              >
                {response.status || "ERR"}
              </span>
              <span className="text-xs text-zinc-500">
                {response.statusText}
              </span>
              <span className="text-xs text-zinc-600 ml-auto">
                {response.time}ms
              </span>
            </div>

            {response.headers && (
              <details className="border-b border-zinc-800">
                <summary className="px-4 py-1.5 text-[10px] text-zinc-500 uppercase tracking-wider cursor-pointer hover:bg-zinc-900">
                  Headers
                </summary>
                <pre className="px-4 py-2 text-xs font-mono text-zinc-400 max-h-32 overflow-y-auto">
                  {response.headers}
                </pre>
              </details>
            )}

            <pre className="px-4 py-3 text-sm font-mono text-zinc-300 max-h-[400px] overflow-y-auto whitespace-pre-wrap">
              {response.body || "(empty response)"}
            </pre>
          </div>
        )}

        {/* Quick actions for common scenarios */}
        {!response && (
          <div className="text-xs text-zinc-600">
            Try sending a request to test the API
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="text-center py-16">
      <p className="text-sm text-zinc-400 mb-4">
        Launch the generated {framework} app in a Docker container
      </p>
      <button
        onClick={handleStart}
        className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
      >
        Launch App
      </button>
      {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
    </div>
  );
}
