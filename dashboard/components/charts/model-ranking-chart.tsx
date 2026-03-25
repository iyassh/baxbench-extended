"use client";

import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { ChartTooltip } from "@/components/chart-tooltip";

interface ModelRankingData {
  name: string;
  sec_pass_at_1: number;
  pass_at_1: number;
  total_cwes: number;
  family: string;
  thinking: boolean;
}

interface ModelRankingChartProps {
  data: ModelRankingData[];
}

const familyColors: Record<string, { solid: string; light: string }> = {
  haiku: { solid: "#71717a", light: "#a1a1aa" },
  sonnet: { solid: "#3b82f6", light: "#60a5fa" },
  opus: { solid: "#8b5cf6", light: "#a78bfa" },
  deepseek: { solid: "#10b981", light: "#34d399" }, // emerald for free/open source
};

function getBarColor(family: string, thinking: boolean): string {
  const colors = familyColors[family] || familyColors.haiku;
  return thinking ? colors.light : colors.solid;
}

function CustomTooltipContent(props: {
  active?: boolean;
  payload?: Array<{ payload: ModelRankingData; value: number }>;
  label?: string;
}) {
  const { active, payload, label } = props;
  if (!active || !payload || payload.length === 0) return null;

  const d = payload[0].payload;
  return (
    <ChartTooltip
      active
      label={label}
      payload={[
        {
          name: "sec_pass@1",
          value: d.sec_pass_at_1,
          color: getBarColor(d.family, d.thinking),
        },
        {
          name: "pass@1",
          value: d.pass_at_1,
          color: "#a1a1aa",
        },
        {
          name: "CWEs Found",
          value: d.total_cwes,
          color: "#ef4444",
        },
      ]}
      formatter={(v) =>
        typeof v === "number" && v <= 100
          ? `${v.toFixed(1)}%`
          : String(v)
      }
    />
  );
}

export function ModelRankingChart({ data }: ModelRankingChartProps) {
  const sorted = [...data].sort(
    (a, b) => b.sec_pass_at_1 - a.sec_pass_at_1
  );

  const chartHeight = Math.max(500, sorted.length * 44);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
    >
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={sorted}
          layout="vertical"
          margin={{ top: 8, right: 40, left: 0, bottom: 8 }}
          barCategoryGap="20%"
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#27272a"
            horizontal={false}
          />
          <XAxis
            type="number"
            domain={[0, 100]}
            tick={{ fill: "#a1a1aa", fontSize: 12 }}
            tickFormatter={(v) => `${v}%`}
            axisLine={{ stroke: "#3f3f46" }}
            tickLine={{ stroke: "#3f3f46" }}
          />
          <YAxis
            dataKey="name"
            type="category"
            width={180}
            tick={{ fill: "#d4d4d8", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={<CustomTooltipContent />}
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
          />
          <Bar dataKey="sec_pass_at_1" radius={[0, 4, 4, 0]} maxBarSize={28}>
            {sorted.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={getBarColor(entry.family, entry.thinking)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-4 px-4 text-xs text-zinc-400">
        {Object.entries(familyColors).map(([family, colors]) => (
          <div key={family} className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: colors.solid }}
              />
              <span className="capitalize">{family}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: colors.light }}
              />
              <span className="capitalize">{family} (thinking)</span>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
