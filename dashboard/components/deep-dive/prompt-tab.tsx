"use client";

import { useState, useEffect } from "react";
import { usePreviewServer } from "@/lib/use-preview-server";

export function PromptTab({ resultId }: { resultId: number }) {
  const { isAvailable, isLoading: serverLoading, fetchFromServer } = usePreviewServer();
  const [prompt, setPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (serverLoading || !isAvailable) {
      setLoading(false);
      return;
    }
    fetchFromServer<{ prompt: string }>(`/api/result/${resultId}/prompt`)
      .then((data) => setPrompt(data.prompt))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [resultId, isAvailable, serverLoading, fetchFromServer]);

  if (serverLoading || loading) {
    return <div className="animate-pulse bg-zinc-800 rounded-lg h-64" />;
  }

  if (!isAvailable) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <p className="text-sm">Start the preview server to view prompts</p>
        <code className="text-xs text-zinc-600 mt-2 block">
          npm run preview-server
        </code>
      </div>
    );
  }

  if (error) {
    return <div className="text-red-400 text-sm py-4">{error}</div>;
  }

  return (
    <pre className="text-sm font-mono text-zinc-300 bg-zinc-950 border border-zinc-800 rounded-lg p-4 overflow-x-auto max-h-[600px] overflow-y-auto whitespace-pre-wrap">
      {prompt}
    </pre>
  );
}
