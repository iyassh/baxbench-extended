"use client";

import { motion } from "framer-motion";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import type { ConfigWithStats } from "@/lib/types";

interface ModelCardProps {
  config: ConfigWithStats;
  onClick: () => void;
  sparklineData?: { name: string; value: number }[];
}

function getFamily(name: string): string {
  if (name.includes("opus")) return "Opus";
  if (name.includes("sonnet")) return "Sonnet";
  if (name.includes("haiku")) return "Haiku";
  if (name.includes("deepseek")) return "DeepSeek";
  if (name.includes("llama")) return "Llama";
  return "Unknown";
}

const familyDotColor: Record<string, string> = {
  Haiku: "bg-zinc-400",
  Sonnet: "bg-blue-400",
  Opus: "bg-purple-400",
  DeepSeek: "bg-green-400",
  Llama: "bg-orange-400",
  Unknown: "bg-zinc-500",
};

function secPassColor(rate: number): string {
  if (rate >= 80) return "text-emerald-400";
  if (rate >= 50) return "text-amber-400";
  return "text-red-400";
}

export function ModelCard({ config, onClick, sparklineData }: ModelCardProps) {
  const family = getFamily(config.name);
  const secPass = Math.round(config.sec_pass_at_1 * 1000) / 10;
  const trueSecPass = Math.round((config.true_sec_pass_at_1 || 0) * 1000) / 10;
  const passAt1 = Math.round(config.pass_at_1 * 1000) / 10;
  const secWorking = config.functional_passes > 0
    ? Math.round((config.secure_passes / config.functional_passes) * 1000) / 10
    : 0;

  return (
    <motion.div
      layout
      layoutId={`model-card-${config.name}`}
      whileHover={{
        scale: 1.02,
        borderColor: "rgba(113, 113, 122, 0.5)",
      }}
      onClick={onClick}
      className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 cursor-pointer transition-shadow hover:shadow-lg hover:shadow-zinc-900/50"
    >
      {/* Top row: name + family */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100 truncate mr-2">
          {config.name}
        </h3>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`inline-block w-2 h-2 rounded-full ${familyDotColor[family]}`}
          />
          <span className="text-xs text-zinc-400">{family}</span>
        </div>
      </div>

      {/* Thinking/Standard pill */}
      <div className="mt-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
            config.thinking
              ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
              : "bg-zinc-800 text-zinc-400 border border-zinc-700"
          }`}
        >
          {config.thinking ? "thinking" : "standard"}
        </span>
      </div>

      {/* Metrics grid */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <div className={`text-xl font-bold tabular-nums ${secPassColor(secPass)}`}>
            {secPass.toFixed(1)}%
          </div>
          <p className="text-[10px] text-zinc-500">sec_pass@1</p>
        </div>
        <div>
          <div className={`text-xl font-bold tabular-nums ${secPassColor(trueSecPass)}`}>
            {trueSecPass.toFixed(1)}%
          </div>
          <p className="text-[10px] text-zinc-500">true_sec@1</p>
        </div>
        <div>
          <div className={`text-xl font-bold tabular-nums ${secWorking > 0 ? "text-purple-400" : "text-zinc-600"}`}>
            {secWorking.toFixed(1)}%
          </div>
          <p className="text-[10px] text-zinc-500">Sec (Working)</p>
        </div>
        <div>
          <div className="text-xl font-bold tabular-nums text-blue-400">
            {passAt1.toFixed(1)}%
          </div>
          <p className="text-[10px] text-zinc-500">pass@1</p>
        </div>
      </div>

      {/* Bottom row: CWEs + total results */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400" />
          <span className="text-sm text-red-400 tabular-nums">{config.total_cwes}</span>
          <span className="text-xs text-zinc-500">CWEs</span>
        </div>
        <div className="text-xs text-zinc-600 tabular-nums">
          {config.secure_passes}/{config.functional_passes}/{config.total_results}
          <span className="text-zinc-700 ml-1">sec/func/total</span>
        </div>
      </div>

      {/* Mini sparkline */}
      {sparklineData && sparklineData.length > 1 && (
        <div className="mt-3 -mx-1">
          <ResponsiveContainer width="100%" height={30}>
            <LineChart data={sparklineData}>
              <Line
                type="monotone"
                dataKey="value"
                stroke="#34d399"
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </motion.div>
  );
}
