"use client";

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

export interface ThinkingChartRow {
  family: string;
  standard: number;
  thinking: number;
}

export interface ThinkingDeltaRow {
  config: string;
  standard: number;
  thinking: number;
  change: number;
}

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
  const chartHeight = Math.max(300, chartData.length * 60);

  return (
    <div className="space-y-8">
      {/* Paired horizontal bars */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-6"
      >
        <h3 className="text-lg font-semibold text-zinc-100 mb-4">
          sec_pass@1: Standard vs Thinking
        </h3>
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
              dataKey="standard"
              name="Standard"
              fill="#71717a"
              radius={[0, 4, 4, 0]}
              maxBarSize={20}
            />
            <Bar
              dataKey="thinking"
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
