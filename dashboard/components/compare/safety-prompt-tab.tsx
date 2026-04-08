"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ChartTooltip } from "@/components/chart-tooltip";
import { ArrowUp, ArrowDown } from "lucide-react";

export interface SafetyChartRow {
  config: string;
  none: number;
  generic: number;
  specific: number;
  none_true: number;
  generic_true: number;
  specific_true: number;
}

export interface SafetyDeltaRow {
  config: string;
  none: number;
  specific: number;
  change: number;
  none_true: number;
  specific_true: number;
  change_true: number;
}

interface SafetyPromptTabProps {
  chartData: SafetyChartRow[];
  deltaData: SafetyDeltaRow[];
  avgImprovement: number;
  avgImprovementTrue: number;
}

function CustomTooltipContent(props: {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    dataKey: string;
  }>;
  label?: string;
}) {
  const { active, payload, label } = props;
  if (!active || !payload || payload.length === 0) return null;

  return (
    <ChartTooltip
      active
      label={label}
      payload={payload.map((p) => ({
        name: p.name,
        value: p.value,
        color: p.color,
      }))}
      formatter={(v) => `${v.toFixed(1)}%`}
    />
  );
}

export function SafetyPromptTab({
  chartData,
  deltaData,
  avgImprovement,
  avgImprovementTrue,
}: SafetyPromptTabProps) {
  const [showTrue, setShowTrue] = useState(false);

  const sorted = [...chartData].sort((a, b) => {
    if (showTrue) {
      const deltaA = a.specific_true - a.none_true;
      const deltaB = b.specific_true - b.none_true;
      return deltaB - deltaA;
    } else {
      const deltaA = a.specific - a.none;
      const deltaB = b.specific - b.none;
      return deltaB - deltaA;
    }
  });

  return (
    <div className="space-y-8">
      {/* Toggle button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">
            Safety Prompt Impact
          </h3>
          <p className="text-sm text-zinc-500 mt-1">
            {showTrue
              ? "Showing true_sec@1 (clean tests only)"
              : "Showing sec_pass@1 (includes crashes)"}
          </p>
        </div>
        <button
          onClick={() => setShowTrue(!showTrue)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors text-sm font-medium text-zinc-200"
        >
          <span>{showTrue ? "Show sec_pass@1" : "Show true_sec@1"}</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        </button>
      </div>

      {/* Grouped bar chart */}
      <motion.div
        key={showTrue ? "true" : "sec"}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-6"
      >
        <h3 className="text-lg font-semibold text-zinc-100 mb-4">
          {showTrue ? "true_sec@1" : "sec_pass@1"} by Safety Prompt Type
        </h3>
        <ResponsiveContainer width="100%" height={420}>
          <BarChart
            data={sorted}
            margin={{ top: 8, right: 30, left: 0, bottom: 60 }}
            barCategoryGap="25%"
            barGap={2}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#27272a"
              vertical={false}
            />
            <XAxis
              dataKey="config"
              angle={-35}
              textAnchor="end"
              fontSize={11}
              height={80}
              tick={{ fill: "#a1a1aa" }}
              axisLine={{ stroke: "#3f3f46" }}
              tickLine={{ stroke: "#3f3f46" }}
            />
            <YAxis
              domain={[0, "auto"]}
              tick={{ fill: "#a1a1aa", fontSize: 12 }}
              tickFormatter={(v) => `${v}%`}
              axisLine={{ stroke: "#3f3f46" }}
              tickLine={{ stroke: "#3f3f46" }}
            />
            <Tooltip
              content={<CustomTooltipContent />}
              cursor={{ fill: "rgba(255,255,255,0.03)" }}
            />
            <Legend
              wrapperStyle={{ paddingTop: "12px" }}
              formatter={(value: string) => (
                <span className="text-xs text-zinc-400">{value}</span>
              )}
            />
            <Bar
              dataKey={showTrue ? "none_true" : "none"}
              name="No Safety Prompt"
              fill="#f59e0b"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
            <Bar
              dataKey={showTrue ? "generic_true" : "generic"}
              name="Generic Prompt"
              fill="#3b82f6"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
            <Bar
              dataKey={showTrue ? "specific_true" : "specific"}
              name="Specific Prompt"
              fill="#10b981"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          </BarChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Delta table */}
      <motion.div
        key={showTrue ? "true-table" : "sec-table"}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1, ease: "easeOut" }}
        className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-zinc-800">
          <h3 className="text-lg font-semibold text-zinc-100">
            Safety Prompt Impact — All Three Prompts
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Config
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-red-400 uppercase tracking-wider">
                  None
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-blue-400 uppercase tracking-wider">
                  Generic
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-emerald-400 uppercase tracking-wider">
                  Specific
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Change (None→Spec)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {sorted.map((row) => {
                const noneVal = showTrue ? row.none_true : row.none;
                const genVal = showTrue ? row.generic_true : row.generic;
                const specVal = showTrue ? row.specific_true : row.specific;
                const changeVal = specVal - noneVal;

                return (
                  <tr
                    key={row.config}
                    className="hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-zinc-200 text-xs">
                      {row.config}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-red-400 text-xs">
                      {noneVal.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-blue-400 text-xs">
                      {genVal.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-400 text-xs">
                      {specVal.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`inline-flex items-center gap-1 tabular-nums font-medium ${
                          changeVal > 0
                            ? "text-emerald-400"
                            : changeVal < 0
                              ? "text-red-400"
                              : "text-zinc-500"
                        }`}
                      >
                        {changeVal > 0 ? (
                          <ArrowUp className="w-3.5 h-3.5" />
                        ) : changeVal < 0 ? (
                          <ArrowDown className="w-3.5 h-3.5" />
                        ) : null}
                        {changeVal > 0 ? "+" : ""}
                        {changeVal.toFixed(1)}pp
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Insight callout */}
      <motion.div
        key={showTrue ? "true-insight" : "sec-insight"}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2, ease: "easeOut" }}
        className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-4"
      >
        <p className="text-sm text-emerald-300/90">
          On average, specific safety prompts{" "}
          {(showTrue ? avgImprovementTrue : avgImprovement) >= 0 ? "improve" : "decrease"} {showTrue ? "true security" : "security (incl. crashes)"} by{" "}
          <span className="font-semibold text-emerald-300">
            {Math.abs(showTrue ? avgImprovementTrue : avgImprovement).toFixed(1)}%
          </span>{" "}
          compared to no safety prompt.
        </p>
      </motion.div>
    </div>
  );
}
