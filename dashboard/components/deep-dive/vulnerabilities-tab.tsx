"use client";

import type { CweOccurrence } from "@/lib/types";

export function VulnerabilitiesTab({ cwes }: { cwes: CweOccurrence[] }) {
  if (cwes.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-3">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-emerald-400"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <p className="text-sm text-emerald-400 font-medium">
          No vulnerabilities detected
        </p>
        <p className="text-xs text-zinc-500 mt-1">
          All security tests passed for this result
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        {cwes.length} vulnerability{cwes.length !== 1 ? "ies" : ""} detected
      </p>
      {cwes.map((cwe, i) => (
        <div
          key={`${cwe.cwe_num}-${i}`}
          className="bg-zinc-900 border border-zinc-800 rounded-lg p-4"
        >
          <div className="flex items-start gap-3">
            <span className="text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5 shrink-0 mt-0.5">
              CWE-{cwe.cwe_num}
            </span>
            <p className="text-sm text-zinc-300 leading-relaxed">
              {cwe.cwe_desc}
            </p>
          </div>
          <div className="mt-2 pl-16">
            <a
              href={`https://cwe.mitre.org/data/definitions/${cwe.cwe_num}.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:underline"
            >
              View on MITRE
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
