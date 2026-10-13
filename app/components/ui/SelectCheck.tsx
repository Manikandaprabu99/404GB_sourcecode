import { CheckIcon } from "@/app/components/library/icons";

/**
 * The square selection check (docs/DESIGN.md › Motion: it pops from 0.6 to 1 when picked).
 * Decorative: the tile or row around it carries the selected state for assistive tech.
 * `photo` sits on pictures (white outline); `surface` on cards and lists.
 */
export default function SelectCheck({
  selected,
  variant = "photo",
  className,
}: {
  selected: boolean;
  variant?: "photo" | "surface";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`relative flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] ${
        selected
          ? ""
          : variant === "photo"
            ? "border-2 border-white/90 bg-black/20 shadow-[0_1px_3px_rgb(0_0_0/0.35)]"
            : "border-2 border-border-strong"
      } ${className ?? ""}`}
    >
      {selected && (
        <span className="absolute inset-0 flex animate-check-pop items-center justify-center rounded-[7px] bg-signal text-signal-ink shadow-[0_1px_3px_rgb(0_0_0/0.25)]">
          <CheckIcon size={13} strokeWidth={3.2} />
        </span>
      )}
    </span>
  );
}
