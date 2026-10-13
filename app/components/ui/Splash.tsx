import BrandMark from "./BrandMark";

/** The brief state while the stored session is read (a native call in the app). Fades in
 * late, so a fast load never flashes it; the mark's missing tile breathes meanwhile. */
export default function Splash() {
  return (
    <main aria-busy="true" className="fixed inset-0 flex items-center justify-center bg-bg">
      <span className="sr-only">Loading 404GB</span>
      <div className="animate-fade-in" style={{ animationDelay: "180ms" }}>
        <BrandMark missing="breathe" className="h-14 w-14 rounded-[13px] shadow-[0_14px_36px_-14px_rgb(200_245_66/0.5)]" />
      </div>
    </main>
  );
}
