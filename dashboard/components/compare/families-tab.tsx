"use client";

import { motion } from "framer-motion";

export interface FamilyVizData {
  family: string;
  configs: string[];
  values: number[];
  median: number;
  min: number;
  max: number;
}

interface FamiliesTabProps {
  data: FamilyVizData[];
}

const familyColors: Record<string, { bar: string; dot: string; bg: string; median: string }> = {
  haiku: {
    bar: "bg-zinc-600/40",
    dot: "bg-zinc-400",
    bg: "bg-zinc-500/10",
    median: "bg-zinc-300",
  },
  sonnet: {
    bar: "bg-blue-600/40",
    dot: "bg-blue-400",
    bg: "bg-blue-500/10",
    median: "bg-blue-300",
  },
  opus: {
    bar: "bg-purple-600/40",
    dot: "bg-purple-400",
    bg: "bg-purple-500/10",
    median: "bg-purple-300",
  },
};

function getColors(family: string) {
  return familyColors[family] || familyColors.haiku;
}

export function FamiliesTab({ data }: FamiliesTabProps) {
  // Find the overall range for consistent scaling
  const allValues = data.flatMap((d) => d.values);
  const globalMin = Math.max(0, Math.min(...allValues) - 5);
  const globalMax = Math.min(100, Math.max(...allValues) + 5);
  const range = globalMax - globalMin;

  function toPercent(value: number): number {
    if (range === 0) return 50;
    return ((value - globalMin) / range) * 100;
  }

  return (
    <div className="space-y-8">
      {/* Distribution visualization */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-6"
      >
        <h3 className="text-lg font-semibold text-zinc-100 mb-2">
          sec_pass@1 Distribution by Family
        </h3>
        <p className="text-sm text-zinc-500 mb-6">
          Range shows min to max, with individual configs as dots and median
          marked
        </p>

        {/* Axis labels */}
        <div className="flex justify-between text-xs text-zinc-500 mb-2 px-[140px]">
          <span>{globalMin.toFixed(0)}%</span>
          <span>{((globalMin + globalMax) / 2).toFixed(0)}%</span>
          <span>{globalMax.toFixed(0)}%</span>
        </div>

        <div className="space-y-6">
          {data.map((family) => {
            const colors = getColors(family.family);
            const leftPct = toPercent(family.min);
            const rightPct = toPercent(family.max);
            const widthPct = rightPct - leftPct;
            const medianPct = toPercent(family.median);

            return (
              <div key={family.family} className="flex items-center gap-4">
                {/* Family label */}
                <div className="w-[120px] shrink-0 text-right">
                  <span className="text-sm font-medium text-zinc-200 capitalize">
                    {family.family}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {family.configs.length} config
                    {family.configs.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Range bar */}
                <div className="flex-1 relative h-10">
                  {/* Background track */}
                  <div className="absolute inset-0 bg-zinc-800/50 rounded" />

                  {/* Range bar (min to max) */}
                  <div
                    className={`absolute top-2 bottom-2 rounded ${colors.bar}`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${Math.max(widthPct, 0.5)}%`,
                    }}
                  />

                  {/* Individual config dots */}
                  {family.values.map((val, i) => (
                    <div
                      key={i}
                      className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ${colors.dot} border border-zinc-900 z-10`}
                      style={{ left: `${toPercent(val)}%` }}
                      title={`${family.configs[i]}: ${(val * 100).toFixed(1)}%`}
                    />
                  ))}

                  {/* Median marker */}
                  <div
                    className={`absolute top-0 bottom-0 w-0.5 ${colors.median} z-20`}
                    style={{ left: `${medianPct}%` }}
                  />
                  <div
                    className={`absolute -top-1 w-3 h-3 rounded-full ${colors.median} border-2 border-zinc-900 z-20`}
                    style={{
                      left: `${medianPct}%`,
                      transform: "translateX(-50%)",
                    }}
                    title={`Median: ${(family.median * 100).toFixed(1)}%`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-6 mt-6 pt-4 border-t border-zinc-800 text-xs text-zinc-500">
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-2 rounded bg-zinc-600/40" />
            <span>Range (min-max)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-400" />
            <span>Individual config</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-zinc-300 border-2 border-zinc-900" />
            <span>Median</span>
          </div>
        </div>
      </motion.div>

      {/* Family summary cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        {data.map((family) => {
          const colors = getColors(family.family);
          return (
            <div
              key={family.family}
              className={`${colors.bg} border border-zinc-800 rounded-xl p-5`}
            >
              <h4 className="text-base font-semibold text-zinc-100 capitalize mb-4">
                {family.family}
              </h4>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Configs</span>
                  <span className="font-medium tabular-nums text-zinc-200">
                    {family.configs.length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Median sec_pass@1</span>
                  <span className="font-medium tabular-nums text-zinc-200">
                    {(family.median * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Range</span>
                  <span className="font-medium tabular-nums text-zinc-200">
                    {(family.min * 100).toFixed(1)}% &ndash;{" "}
                    {(family.max * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}
