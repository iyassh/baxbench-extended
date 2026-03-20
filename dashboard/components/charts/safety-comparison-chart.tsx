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

interface SafetyComparisonData {
  config: string;
  none: number;
  generic: number;
  specific: number;
}

interface SafetyComparisonChartProps {
  data: SafetyComparisonData[];
}

function CustomTooltipContent(props: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
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

export function SafetyComparisonChart({ data }: SafetyComparisonChartProps) {
  // Sort by improvement delta (biggest improvement from none to specific first)
  const sorted = [...data].sort((a, b) => {
    const deltaA = a.specific - a.none;
    const deltaB = b.specific - b.none;
    return deltaB - deltaA;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
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
            domain={[0, 100]}
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
            formatter={(value) => (
              <span className="text-xs text-zinc-400">{value}</span>
            )}
          />
          <Bar
            dataKey="none"
            name="No Safety Prompt"
            fill="#f59e0b"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
          />
          <Bar
            dataKey="generic"
            name="Generic Prompt"
            fill="#3b82f6"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
          />
          <Bar
            dataKey="specific"
            name="Specific Prompt"
            fill="#10b981"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
          />
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
