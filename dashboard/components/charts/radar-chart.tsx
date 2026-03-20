"use client";

import {
  RadarChart as RechartsRadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
} from "recharts";
import type { RadarDataPoint } from "@/lib/types";

interface RadarChartProps {
  data: RadarDataPoint[];
  color?: string;
}

export function RadarChart({ data, color = "#34d399" }: RadarChartProps) {
  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <RechartsRadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
        <PolarGrid stroke="#3f3f46" />
        <PolarAngleAxis
          dataKey="axis"
          tick={{ fill: "#a1a1aa", fontSize: 11 }}
        />
        <Radar
          name="Performance"
          dataKey="value"
          stroke={color}
          fill={color}
          fillOpacity={0.3}
          animationDuration={800}
          animationEasing="ease-out"
        />
      </RechartsRadarChart>
    </ResponsiveContainer>
  );
}
