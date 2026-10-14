import BrandMark from "./BrandMark";

/** Shown while the stored session is read; fades in late so a fast load never flashes it. */
export default function Splash() {
  return (
    <main aria-busy="true" className="fixed inset-0 flex items-center justify-center bg-bg">
      <span className="sr-only">Loading 404GB</span>
      <div className="animate-fade-in" style={{ animationDelay: "180ms" }}>
        <BrandMark className="h-16 w-16 drop-shadow-[0_14px_30px_rgb(22_96_235/0.45)]" />
      </div>
    </main>
  );
}
