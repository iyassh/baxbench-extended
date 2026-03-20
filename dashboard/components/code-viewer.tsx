"use client";

import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface CodeViewerProps {
  code: string;
  language?: string;
  filename?: string;
}

function detectLanguage(filename: string): string {
  if (filename.endsWith(".py")) return "python";
  if (filename.endsWith(".js") || filename.endsWith(".ts")) return "javascript";
  if (filename.endsWith(".go")) return "go";
  return "text";
}

export function CodeViewer({ code, language, filename }: CodeViewerProps) {
  const lang = language ?? (filename ? detectLanguage(filename) : "text");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden">
      {filename && (
        <div className="bg-zinc-800 text-zinc-300 text-xs px-4 py-2 font-mono">
          {filename}
        </div>
      )}
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs px-2 py-1 rounded transition-colors"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <SyntaxHighlighter
        language={lang}
        style={oneDark}
        showLineNumbers
        customStyle={{
          margin: 0,
          fontSize: "0.8rem",
          background: "transparent",
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
