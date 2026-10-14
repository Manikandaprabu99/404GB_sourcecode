import { CheckIcon } from "@/app/components/library/icons";

/** A decorative round 24px check: white ring, or accent fill with a tick that pops in.
 * `photo` sits on pictures; `surface` on cards and lists. */
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
      className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
        selected
          ? ""
          : variant === "photo"
            ? "border-[1.75px] border-white bg-black/15 shadow-[0_1px_3px_rgb(0_0_0/0.3)]"
            : "border-[1.75px] border-border-strong"
      } ${className ?? ""}`}
    >
      {selected && (
        <span
          className={`absolute inset-0 flex animate-check-pop items-center justify-center rounded-full bg-accent text-accent-ink ${
            variant === "photo" ? "shadow-[0_0_0_1.75px_white,0_1px_4px_rgb(0_0_0/0.3)]" : ""
          }`}
        >
          <CheckIcon size={14} strokeWidth={3} />
        </span>
      )}
    </span>
  );
}
