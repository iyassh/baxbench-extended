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
import { cn } from "@/lib/utils";

export interface FrameworkChartRow {
  config: string;
  flask: number;
  express: number;
  fiber: number;
  flask_pass?: number;
  express_pass?: number;
  fiber_pass?: number;
  flask_secw?: number;
  express_secw?: number;
  fiber_secw?: number;
}

export interface FrameworkSummary {
  framework: string;
  average: number;
  best: { config: string; value: number };
  worst: { config: string; value: number };
}

type MetricKey = "sec_pass" | "pass_at_1" | "sec_working";

interface FrameworksTabProps {
  chartData: FrameworkChartRow[];
  summaries: FrameworkSummary[];
}

const frameworkColors: Record<string, string> = {
  "Python-Flask": "#3b82f6",
  "JavaScript-express": "#f59e0b",
  "Go-Fiber": "#10b981",
};

const frameworkLabels: Record<string, string> = {
  "Python-Flask": "Flask",
  "JavaScript-express": "Express",
  "Go-Fiber": "Fiber",
};

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

export function FrameworksTab({ chartData, summaries }: FrameworksTabProps) {
  const [metric, setMetric] = useState<MetricKey>("sec_pass");

  const metricButtons: { key: MetricKey; label: string }[] = [
    { key: "sec_pass", label: "sec_pass@1" },
    { key: "pass_at_1", label: "pass@1" },
    { key: "sec_working", label: "Sec (Working)" },
  ];

  const metricLabels: Record<MetricKey, string> = {
    sec_pass: "sec_pass@1 by Framework",
    pass_at_1: "pass@1 by Framework (code quality)",
    sec_working: "Sec (Working) by Framework (security of working code)",
  };

  const flaskKey = metric === "pass_at_1" ? "flask_pass" : metric === "sec_working" ? "flask_secw" : "flask";
  const expressKey = metric === "pass_at_1" ? "express_pass" : metric === "sec_working" ? "express_secw" : "express";
  const fiberKey = metric === "pass_at_1" ? "fiber_pass" : metric === "sec_working" ? "fiber_secw" : "fiber";

  return (
    <div className="space-y-8">
      {/* Chart with metric toggle */}
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
        <ResponsiveContainer width="100%" height={420}>
          <BarChart
            data={chartData}
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
              dataKey={flaskKey}
              name="Flask"
              fill="#3b82f6"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
            <Bar
              dataKey={expressKey}
              name="Express"
              fill="#f59e0b"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
            <Bar
              dataKey={fiberKey}
              name="Fiber"
              fill="#10b981"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          </BarChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Framework summary cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        {summaries.map((fw) => (
          <div
            key={fw.framework}
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-5"
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-3 h-3 rounded-full"
                style={{
                  backgroundColor:
                    frameworkColors[fw.framework] || "#71717a",
                }}
              />
              <h4 className="text-base font-semibold text-zinc-100">
                {frameworkLabels[fw.framework] || fw.framework}
              </h4>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">Avg sec_pass@1</span>
                <span className="font-medium tabular-nums text-zinc-200">
                  {fw.average.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Best model</span>
                <span className="font-medium text-emerald-400 truncate ml-2 max-w-[160px]">
                  {fw.best.config}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Worst model</span>
                <span className="font-medium text-red-400 truncate ml-2 max-w-[160px]">
                  {fw.worst.config}
                </span>
              </div>
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
