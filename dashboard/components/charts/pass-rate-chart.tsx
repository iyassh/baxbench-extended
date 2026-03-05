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

interface PassRateChartProps {
  data: {
    name: string;
    pass_at_1: number;
    sec_pass_at_1: number;
  }[];
}

export function PassRateChart({ data }: PassRateChartProps) {
  const formatted = data.map((d) => ({
    ...d,
    pass_at_1: Math.round(d.pass_at_1 * 1000) / 10,
    sec_pass_at_1: Math.round(d.sec_pass_at_1 * 1000) / 10,
    gap: Math.round((d.pass_at_1 - d.sec_pass_at_1) * 1000) / 10,
  }));

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart data={formatted} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" angle={-35} textAnchor="end" fontSize={11} height={80} />
        <YAxis domain={[0, 100]} label={{ value: "%", position: "insideLeft" }} />
        <Tooltip formatter={(value) => `${value}%`} />
        <Legend />
        <Bar dataKey="pass_at_1" name="pass@1 (functional)" fill="#3b82f6" />
        <Bar dataKey="sec_pass_at_1" name="sec_pass@1 (secure)" fill="#22c55e" />
      </BarChart>
    </ResponsiveContainer>
  );
}
