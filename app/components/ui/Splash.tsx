import BrandMark from "./BrandMark";

/** The brief state while the stored session is read (a native call in the app). Fades in
 * late, so a fast load never flashes it. */
export default function Splash() {
  return (
    <main aria-busy="true" className="fixed inset-0 flex items-center justify-center bg-bg">
      <span className="sr-only">Loading 404GB</span>
      <div className="animate-fade-in" style={{ animationDelay: "180ms" }}>
        <BrandMark className="h-14 w-14 animate-pulse drop-shadow-[0_10px_28px_rgb(99_102_241/0.35)]" />
      </div>
    </main>
  );
}
