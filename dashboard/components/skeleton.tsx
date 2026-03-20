export function SkeletonCard() {
  return (
    <div className="h-32 bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-3">
      <div className="h-3 w-24 bg-zinc-800/50 rounded animate-pulse" />
      <div className="h-7 w-20 bg-zinc-800/50 rounded animate-pulse" />
      <div className="h-2.5 w-32 bg-zinc-800/50 rounded animate-pulse" />
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="h-64 bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col justify-end gap-2">
      <div className="flex items-end gap-1.5 h-full">
        {[40, 65, 50, 80, 55, 70, 45, 90, 60, 75, 50, 85].map(
          (height, i) => (
            <div
              key={i}
              className="flex-1 bg-zinc-800/50 rounded-t animate-pulse"
              style={{ height: `${height}%` }}
            />
          )
        )}
      </div>
      <div className="flex justify-between pt-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-2.5 w-10 bg-zinc-800/50 rounded animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  const widths = ["w-3/4", "w-1/2", "w-5/6", "w-2/3", "w-3/5"];

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex gap-4 p-4 border-b border-zinc-800">
        <div className="h-3 w-20 bg-zinc-800/50 rounded animate-pulse" />
        <div className="h-3 w-28 bg-zinc-800/50 rounded animate-pulse" />
        <div className="h-3 w-16 bg-zinc-800/50 rounded animate-pulse" />
        <div className="h-3 w-24 bg-zinc-800/50 rounded animate-pulse ml-auto" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 p-4 border-b border-zinc-800/50 last:border-b-0"
        >
          <div
            className={`h-3 ${widths[i % widths.length]} bg-zinc-800/50 rounded animate-pulse`}
          />
          <div className="h-3 w-12 bg-zinc-800/50 rounded animate-pulse ml-auto" />
        </div>
      ))}
    </div>
  );
}
