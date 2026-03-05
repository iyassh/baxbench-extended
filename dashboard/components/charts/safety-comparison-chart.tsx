"use client";

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

interface SafetyComparisonChartProps {
  data: {
    config_name: string;
    none: number;
    generic: number;
    specific: number;
  }[];
}

export function SafetyComparisonChart({ data }: SafetyComparisonChartProps) {
  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="config_name" angle={-35} textAnchor="end" fontSize={11} height={80} />
        <YAxis domain={[0, 100]} label={{ value: "%", position: "insideLeft" }} />
        <Tooltip formatter={(value) => `${value}%`} />
        <Legend />
        <Bar dataKey="none" name="No safety prompt" fill="#ef4444" />
        <Bar dataKey="generic" name="Generic" fill="#f59e0b" />
        <Bar dataKey="specific" name="Specific" fill="#22c55e" />
      </BarChart>
    </ResponsiveContainer>
  );
}
