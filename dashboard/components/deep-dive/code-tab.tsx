"use client";

import { useState, useEffect } from "react";
import { usePreviewServer } from "@/lib/use-preview-server";
import { CodeViewer } from "@/components/code-viewer";

interface CodeFile {
  name: string;
  content: string;
  language: string;
}

export function CodeTab({ resultId }: { resultId: number }) {
  const { isAvailable, isLoading: serverLoading, fetchFromServer } = usePreviewServer();
  const [files, setFiles] = useState<CodeFile[]>([]);
  const [selectedFile, setSelectedFile] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (serverLoading || !isAvailable) {
      setLoading(false);
      return;
    }
    fetchFromServer<{ files: CodeFile[] }>(`/api/result/${resultId}/code`)
      .then((data) => {
        setFiles(data.files);
        setSelectedFile(0);
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
        <p className="text-sm">Start the preview server to view code</p>
        <code className="text-xs text-zinc-600 mt-2 block">
          npm run preview-server
        </code>
      </div>
    );
  }

  if (error) {
    return <div className="text-red-400 text-sm py-4">{error}</div>;
  }

  if (files.length === 0) {
    return <div className="text-zinc-500 text-sm py-4">No code files found</div>;
  }

  const file = files[selectedFile];

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
