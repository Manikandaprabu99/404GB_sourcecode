const GROUPS = [18, 12];

/** Placeholder grid in the same shape as the real one while a cold load runs. */
export default function SkeletonGrid() {
  return (
    <div aria-busy="true" aria-label="Loading your photos" className="animate-fade-in">
      {GROUPS.map((count, group) => (
        <div key={group} className="mb-2.5">
          <div className="flex h-11 items-center px-3 sm:px-1">
            <span className="skeleton block h-3.5 rounded-full" style={{ width: group === 0 ? 72 : 112 }} />
          </div>
          <div className="grid grid-cols-3 gap-0.5 sm:grid-cols-4 sm:gap-1 min-[900px]:grid-cols-5 min-[1200px]:grid-cols-6">
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="skeleton aspect-square" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
