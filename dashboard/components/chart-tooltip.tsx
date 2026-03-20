interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  formatter?: (value: number) => string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-3">
      {label && (
        <p className="text-sm font-medium text-zinc-200 mb-2">{label}</p>
      )}
      <div className="space-y-1.5">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-zinc-400">{entry.name}</span>
            <span className="ml-auto tabular-nums font-medium text-zinc-100">
              {formatter ? formatter(entry.value) : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
