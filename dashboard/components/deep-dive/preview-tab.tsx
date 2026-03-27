"use client";

import { useState } from "react";
import { usePreviewServer } from "@/lib/use-preview-server";

export function PreviewTab({
  resultId,
  framework,
}: {
  resultId: number;
  framework: string;
}) {
  const { isAvailable, hasDocker, isLoading: serverLoading } = usePreviewServer();
  const [port, setPort] = useState<number | null>(null);
  const [containerId, setContainerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      // Wait a few seconds for the app to start
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
        <p className="text-xs text-zinc-600 mt-1">This may take 30-60 seconds</p>
      </div>
    );
  }

  if (port) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm text-zinc-300">
              Running on{" "}
              <a
                href={`http://localhost:${port}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline font-mono"
              >
                localhost:{port}
              </a>
            </span>
          </div>
          <button
            onClick={handleStop}
            className="text-xs px-3 py-1.5 rounded-md bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
          >
            Stop
          </button>
        </div>
        <div className="border border-zinc-800 rounded-lg overflow-hidden bg-white">
          <iframe
            src={`http://localhost:${port}`}
            className="w-full h-[500px]"
            title="App Preview"
          />
        </div>
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
      {error && (
        <p className="text-red-400 text-xs mt-3">{error}</p>
      )}
    </div>
  );
}
