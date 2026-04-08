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
import { cn } from "@/lib/utils";

export interface ThinkingChartRow {
  family: string;
  standard: number;
  thinking: number;
  standard_true?: number;
  thinking_true?: number;
  standard_pass?: number;
  thinking_pass?: number;
  standard_secw?: number;
  thinking_secw?: number;
}

export interface ThinkingDeltaRow {
  config: string;
  standard: number;
  thinking: number;
  change: number;
}

type MetricKey = "sec_pass" | "true_sec" | "pass_at_1" | "sec_working";

interface ThinkingTabProps {
  chartData: ThinkingChartRow[];
  deltaData: ThinkingDeltaRow[];
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

export function ThinkingTab({ chartData, deltaData }: ThinkingTabProps) {
  const [metric, setMetric] = useState<MetricKey>("sec_pass");
  const chartHeight = Math.max(300, chartData.length * 60);

  const metricButtons: { key: MetricKey; label: string }[] = [
    { key: "sec_pass", label: "sec_pass@1" },
    { key: "true_sec", label: "true_sec@1" },
    { key: "pass_at_1", label: "pass@1" },
    { key: "sec_working", label: "Sec (Working)" },
  ];

  const metricLabels: Record<MetricKey, string> = {
    sec_pass: "sec_pass@1: Standard vs Thinking",
    true_sec: "true_sec@1: Standard vs Thinking",
    pass_at_1: "pass@1: Standard vs Thinking (code quality)",
    sec_working: "Sec (Working): Standard vs Thinking",
  };

  const suffixMap: Record<MetricKey, string> = { sec_pass: "", true_sec: "_true", pass_at_1: "_pass", sec_working: "_secw" };
  const s = suffixMap[metric];
  const stdKey = `standard${s}`;
  const thinkKey = `thinking${s}`;

  return (
    <div className="space-y-8">
      {/* Paired horizontal bars */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-6"
      >
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-lg font-semibold text-zinc-100">
            {metricLabels[metric]}
          </h3>
          <div className="flex items-center gap-2">
            {metricButtons.map((btn) => (
              <button
                key={btn.key}
                onClick={() => setMetric(btn.key)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                  metric === btn.key
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
                )}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 8, right: 40, left: 0, bottom: 8 }}
            barCategoryGap="30%"
            barGap={4}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#27272a"
              horizontal={false}
            />
            <XAxis
              type="number"
              domain={[0, "auto"]}
              tick={{ fill: "#a1a1aa", fontSize: 12 }}
              tickFormatter={(v) => `${v}%`}
              axisLine={{ stroke: "#3f3f46" }}
              tickLine={{ stroke: "#3f3f46" }}
            />
            <YAxis
              dataKey="family"
              type="category"
              width={160}
              tick={{ fill: "#d4d4d8", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
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
              dataKey={stdKey}
              name="Standard"
              fill="#71717a"
              radius={[0, 4, 4, 0]}
              maxBarSize={20}
            />
            <Bar
              dataKey={thinkKey}
              name="Thinking"
              fill="#a855f7"
              radius={[0, 4, 4, 0]}
              maxBarSize={20}
            />
          </BarChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Delta table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
        className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-zinc-800">
          <h3 className="text-lg font-semibold text-zinc-100">
            Thinking Mode Impact
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="px-6 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Config
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Standard
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Thinking
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-zinc-400 uppercase tracking-wider">
                  Change
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {deltaData.map((row) => (
                <tr
                  key={row.config}
                  className="hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="px-6 py-3 font-medium text-zinc-200">
                    {row.config}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums text-zinc-400">
                    {row.standard.toFixed(1)}%
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums text-zinc-400">
                    {row.thinking.toFixed(1)}%
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span
                      className={`inline-flex items-center gap-1 tabular-nums font-medium ${
                        row.change > 0
                          ? "text-emerald-400"
                          : row.change < 0
                            ? "text-red-400"
                            : "text-zinc-500"
                      }`}
                    >
                      {row.change > 0 ? (
                        <ArrowUp className="w-3.5 h-3.5" />
                      ) : row.change < 0 ? (
                        <ArrowDown className="w-3.5 h-3.5" />
                      ) : null}
                      {row.change > 0 ? "+" : ""}
                      {row.change.toFixed(1)}pp
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
