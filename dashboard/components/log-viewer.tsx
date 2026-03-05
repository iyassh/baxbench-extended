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
    <div className="border rounded-md">
      <button
        className="w-full text-left px-4 py-2 text-sm font-medium hover:bg-muted/50 flex items-center justify-between"
        onClick={() => setOpen(!open)}
      >
        {title}
        <span className="text-muted-foreground">{open ? "\u2212" : "+"}</span>
      </button>
      {open && (
        <pre className="px-4 py-3 text-xs font-mono bg-zinc-950 text-zinc-300 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
          {content}
        </pre>
      )}
    </div>
  );
}
