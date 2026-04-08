"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface CweData {
  num: number;
  name: string;
  occurrence_count: number;
  is_extended: boolean;
}

interface OwaspCategory {
  id: string;
  name: string;
  cwes: number[];
  description: string;
}

const OWASP_2025: OwaspCategory[] = [
  {
    id: "A01",
    name: "Broken Access Control",
    cwes: [284, 862, 863, 639, 918, 352],
    description: "Restrictions on authenticated users are not properly enforced",
  },
  {
    id: "A02",
    name: "Cryptographic Failures",
    cwes: [522, 798, 327, 338],
    description: "Failures related to cryptography that lead to exposure of sensitive data",
  },
  {
    id: "A03",
    name: "Injection",
    cwes: [79, 89, 78, 94, 117, 22, 611, 20],
    description: "User-supplied data is sent to an interpreter as part of a command or query",
  },
  {
    id: "A04",
    name: "Insecure Design",
    cwes: [840, 640],
    description: "Missing or ineffective security controls in the application design",
  },
  {
    id: "A05",
    name: "Security Misconfiguration",
    cwes: [693, 942, 614, 1275],
    description: "Missing security hardening, default configs, unnecessary features enabled",
  },
  {
    id: "A06",
    name: "Vulnerable Components",
    cwes: [1104],
    description: "Using components with known vulnerabilities",
  },
  {
    id: "A07",
    name: "Auth Failures",
    cwes: [287, 307, 384, 613],
    description: "Identity, authentication, and session management weaknesses",
  },
  {
    id: "A08",
    name: "Integrity Failures",
    cwes: [345, 347, 502],
    description: "Code and infrastructure without integrity verification",
  },
  {
    id: "A09",
    name: "Logging Failures",
    cwes: [209],
    description: "Insufficient logging, monitoring, and error handling",
  },
  {
    id: "A10",
    name: "Exceptional Conditions",
    cwes: [400, 703, 636],
    description: "Improper handling of errors and resource exhaustion (new in 2025)",
  },
];

interface OwaspTop10Props {
  cwes: CweData[];
}

export function OwaspTop10({ cwes }: OwaspTop10Props) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const cweMap = new Map<number, CweData>();
  cwes.forEach((c) => cweMap.set(c.num, c));

  const categoryData = OWASP_2025.map((cat) => {
    const matchedCwes = cat.cwes
      .map((num) => cweMap.get(num))
      .filter(Boolean) as CweData[];
    const totalFindings = matchedCwes.reduce(
      (sum, c) => sum + c.occurrence_count,
      0
    );
    const detectedCount = matchedCwes.filter(
      (c) => c.occurrence_count > 0
    ).length;
    return { ...cat, matchedCwes, totalFindings, detectedCount };
  });

  const categoriesWithFindings = categoryData.filter(
    (c) => c.totalFindings > 0
  ).length;
  const totalFindings = categoryData.reduce(
    (sum, c) => sum + c.totalFindings,
    0
  );

  return (
    <div>
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">
            OWASP Coverage
          </p>
          <p className="text-2xl font-bold text-emerald-400 mt-1">
            {categoriesWithFindings}/10
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            categories with findings
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">
            CWEs Mapped
          </p>
          <p className="text-2xl font-bold text-blue-400 mt-1">
            {OWASP_2025.reduce((s, c) => s + c.cwes.length, 0)}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            across all 10 categories
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">
            Total Findings
          </p>
          <p className="text-2xl font-bold text-red-400 mt-1">
            {totalFindings.toLocaleString()}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            vulnerability occurrences
          </p>
        </div>
      </div>

      {/* Category list */}
      <div className="space-y-2">
        {categoryData.map((cat) => {
          const isExpanded = expandedCategory === cat.id;
          const hasFindings = cat.totalFindings > 0;
          const maxFindings = Math.max(
            ...categoryData.map((c) => c.totalFindings),
            1
          );
          const barWidth = (cat.totalFindings / maxFindings) * 100;

          return (
            <div key={cat.id}>
              <button
                onClick={() =>
                  setExpandedCategory(isExpanded ? null : cat.id)
                }
                className={cn(
                  "w-full text-left bg-zinc-900 border rounded-xl p-4 transition-all hover:border-zinc-600",
                  isExpanded
                    ? "border-zinc-600"
                    : "border-zinc-800"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "text-xs font-bold px-2 py-1 rounded",
                        hasFindings
                          ? "bg-red-500/20 text-red-400"
                          : "bg-zinc-800 text-zinc-600"
                      )}
                    >
                      {cat.id}
                    </span>
                    <div>
                      <span className="text-sm font-medium text-zinc-200">
                        {cat.name}
                      </span>
                      <p className="text-xs text-zinc-500 mt-0.5 hidden sm:block">
                        {cat.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right hidden sm:block">
                      <span
                        className={cn(
                          "text-sm font-bold tabular-nums",
                          hasFindings ? "text-red-400" : "text-zinc-600"
                        )}
                      >
                        {cat.totalFindings.toLocaleString()}
                      </span>
                      <p className="text-[10px] text-zinc-600">
                        {cat.detectedCount}/{cat.cwes.length} CWEs found
                      </p>
                    </div>
                    {/* Mini bar */}
                    <div className="w-24 h-2 bg-zinc-800 rounded-full overflow-hidden hidden sm:block">
                      <div
                        className="h-full bg-red-400/70 rounded-full"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <svg
                      className={cn(
                        "w-4 h-4 text-zinc-500 transition-transform",
                        isExpanded && "rotate-180"
                      )}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </div>
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-zinc-900/50 border border-zinc-800 border-t-0 rounded-b-xl px-4 py-3 -mt-2">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-zinc-800">
                            <th className="text-left py-2 text-xs text-zinc-500 font-medium">
                              CWE
                            </th>
                            <th className="text-left py-2 text-xs text-zinc-500 font-medium">
                              Name
                            </th>
                            <th className="text-center py-2 text-xs text-zinc-500 font-medium">
                              Type
                            </th>
                            <th className="text-right py-2 text-xs text-zinc-500 font-medium">
                              Found
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {cat.cwes.map((cweNum) => {
                            const cwe = cweMap.get(cweNum);
                            const count = cwe?.occurrence_count || 0;
                            return (
                              <tr
                                key={cweNum}
                                className="border-b border-zinc-800/50"
                              >
                                <td className="py-1.5 text-xs font-mono text-zinc-400">
                                  CWE-{cweNum}
                                </td>
                                <td className="py-1.5 text-xs text-zinc-300">
                                  {cwe?.name || `CWE-${cweNum}`}
                                </td>
                                <td className="py-1.5 text-center">
                                  <span
                                    className={cn(
                                      "text-[10px] px-1.5 py-0.5 rounded-full",
                                      cwe?.is_extended
                                        ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                                        : "bg-zinc-800 text-zinc-500 border border-zinc-700"
                                    )}
                                  >
                                    {cwe?.is_extended ? "extended" : "original"}
                                  </span>
                                </td>
                                <td className="py-1.5 text-right">
                                  <span
                                    className={cn(
                                      "text-xs font-medium tabular-nums",
                                      count > 0
                                        ? "text-red-400"
                                        : "text-zinc-600"
                                    )}
                                  >
                                    {count > 0
                                      ? count.toLocaleString()
                                      : "0"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
