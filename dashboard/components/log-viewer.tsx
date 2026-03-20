"use client";

import { useState } from "react";

interface LogViewerProps {
  title: string;
  content: string;
  defaultOpen?: boolean;
}

export function LogViewer({
  title,
  content,
  defaultOpen = false,
}: LogViewerProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-zinc-800 rounded-lg bg-zinc-950 overflow-hidden">
      <button
        className="w-full text-left px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800/60 flex items-center justify-between transition-colors"
        onClick={() => setOpen(!open)}
      >
        {title}
        <span className="text-zinc-500">{open ? "\u2212" : "+"}</span>
      </button>
      {open && (
        <pre className="px-4 py-3 text-sm font-mono text-zinc-300 bg-zinc-950 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap border-t border-zinc-800">
          {content}
        </pre>
      )}
    </div>
  );
}
