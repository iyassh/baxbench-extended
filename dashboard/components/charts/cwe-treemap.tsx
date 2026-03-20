"use client";

import { motion } from "framer-motion";
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";
import type { CweTreemapItem } from "@/lib/types";

interface CweTreemapProps {
  data: CweTreemapItem[];
}

function getColor(affectedModels: number, maxModels: number): string {
  if (maxModels <= 1) return "#f59e0b"; // amber-500
  const ratio = (affectedModels - 1) / (maxModels - 1);
  // Interpolate between amber-500 (#f59e0b) and red-500 (#ef4444)
  const r = Math.round(245 + (239 - 245) * ratio);
  const g = Math.round(158 + (68 - 158) * ratio);
  const b = Math.round(11 + (68 - 11) * ratio);
  return `rgb(${r}, ${g}, ${b})`;
}

interface CustomContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  occurrences?: number;
  affected_models?: number;
  maxModels: number;
}

function CustomContent({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  name,
  occurrences,
  affected_models = 1,
  maxModels,
}: CustomContentProps) {
  const fill = getColor(affected_models, maxModels);
  const showName = width > 60 && height > 40;
  const showCount = width > 30 && height > 20;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        fill={fill}
        fillOpacity={0.7}
        stroke="#27272a"
        strokeWidth={2}
        className="transition-opacity hover:fill-opacity-100"
      />
      {showName && (
        <text
          x={x + width / 2}
          y={y + height / 2 - (showCount ? 8 : 0)}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-white text-[11px] font-medium"
          style={{ pointerEvents: "none" }}
        >
          {name && name.length > width / 7 ? name.slice(0, Math.floor(width / 7)) + "..." : name}
        </text>
      )}
      {showCount && (
        <text
          x={x + width / 2}
          y={y + height / 2 + (showName ? 10 : 0)}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-white/70 text-[10px] font-mono"
          style={{ pointerEvents: "none" }}
        >
          {occurrences}
        </text>
      )}
    </g>
  );
}

interface TreemapTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: CweTreemapItem & { root?: unknown };
  }>;
}

function TreemapTooltip({ active, payload }: TreemapTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;
  if (item.root !== undefined && !item.cwe_num) return null;

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-3">
      <p className="text-sm font-medium text-zinc-200">{item.name}</p>
      <p className="text-xs text-zinc-400 font-mono">CWE-{item.cwe_num}</p>
      <div className="mt-2 space-y-1">
        <div className="flex items-center justify-between gap-4 text-xs">
          <span className="text-zinc-400">Occurrences</span>
          <span className="tabular-nums font-medium text-zinc-100">
            {item.occurrences}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 text-xs">
          <span className="text-zinc-400">Affected Models</span>
          <span className="tabular-nums font-medium text-zinc-100">
            {item.affected_models}
          </span>
        </div>
      </div>
    </div>
  );
}

export function CweTreemap({ data }: CweTreemapProps) {
  const maxModels = Math.max(...data.map((d) => d.affected_models), 1);

  const treemapData = data.map((d) => ({
    ...d,
    size: d.occurrences,
  }));

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <ResponsiveContainer width="100%" height={350}>
        <Treemap
          data={treemapData}
          dataKey="size"
          nameKey="name"
          content={<CustomContent maxModels={maxModels} />}
        >
          <Tooltip content={<TreemapTooltip />} />
        </Treemap>
      </ResponsiveContainer>
    </motion.div>
  );
}
