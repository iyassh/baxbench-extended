"use client";

import { useState } from "react";
import { useResultDetails } from "@/lib/use-result-details";
import { CodeViewer } from "@/components/code-viewer";

export function CodeTab({ configName, resultId }: { configName: string; resultId: number }) {
  const { data, loading, error } = useResultDetails(configName, resultId);
  const [selectedFile, setSelectedFile] = useState(0);

  if (loading) {
    return <div className="animate-pulse bg-zinc-800 rounded-lg h-64" />;
  }

  if (error) {
    return <div className="text-red-400 text-sm py-4">{error}</div>;
  }

  const files = data?.code ?? [];

  if (files.length === 0) {
    return <div className="text-zinc-500 text-sm py-4">No code files found</div>;
  }

  const file = files[selectedFile] ?? files[0];

  return (
    <div className="space-y-3">
      {files.length > 1 && (
        <div className="flex gap-1">
          {files.map((f, i) => (
            <button
              key={f.name}
              onClick={() => setSelectedFile(i)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                i === selectedFile
                  ? "bg-zinc-700 text-zinc-100"
                  : "bg-zinc-900 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}
      <CodeViewer code={file.content} filename={file.name} />
    </div>
  );
}
