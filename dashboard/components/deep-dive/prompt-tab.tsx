"use client";

import { useResultDetails } from "@/lib/use-result-details";

export function PromptTab({ configName, resultId }: { configName: string; resultId: number }) {
  const { data, loading, error } = useResultDetails(configName, resultId);

  if (loading) {
    return <div className="animate-pulse bg-zinc-800 rounded-lg h-64" />;
  }

  if (error) {
    return <div className="text-red-400 text-sm py-4">{error}</div>;
  }

  if (!data?.prompt) {
    return <div className="text-zinc-500 text-sm py-4">Prompt not available</div>;
  }

  return (
    <pre className="text-sm font-mono text-zinc-300 bg-zinc-950 border border-zinc-800 rounded-lg p-4 overflow-x-auto max-h-[600px] overflow-y-auto whitespace-pre-wrap">
      {data.prompt}
    </pre>
  );
}
