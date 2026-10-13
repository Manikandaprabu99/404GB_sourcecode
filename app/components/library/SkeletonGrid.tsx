const GROUPS = [18, 12];

/** Placeholder grid in the same shape as the real one while a cold load runs: a day header
 * (title + telemetry) and surface-2 tiles with a slow shimmer. */
export default function SkeletonGrid() {
  return (
    <div aria-busy="true" aria-label="Loading your photos" className="animate-fade-in">
      {GROUPS.map((count, group) => (
        <div key={group} className="mb-3">
          <div className="flex h-12 items-center justify-between px-4 sm:px-1">
            <span className="skeleton block h-4 rounded-[5px]" style={{ width: group === 0 ? 64 : 148 }} />
            <span className="skeleton block h-2.5 rounded-[3px]" style={{ width: group === 0 ? 92 : 28 }} />
          </div>
          <div className="grid grid-cols-3 gap-0.5 sm:grid-cols-4 sm:gap-[3px] min-[900px]:grid-cols-5 lg:gap-1 min-[1200px]:grid-cols-6">
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="skeleton aspect-square rounded-thumb" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
