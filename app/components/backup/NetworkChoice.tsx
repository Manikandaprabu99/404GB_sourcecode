"use client";

import { SignalIcon, WifiIcon } from "@/app/components/library/icons";

/** Segmented "Wi-Fi only" / "Wi-Fi + mobile data" choice for backups. */
export default function NetworkChoice({
  wifiOnly,
  disabled,
  onChange,
  className = "",
}: {
  wifiOnly: boolean;
  disabled?: boolean;
  onChange: (wifiOnly: boolean) => void;
  className?: string;
}) {
  const options = [
    { value: true, label: "Wi-Fi only", icon: <WifiIcon size={16} /> },
    { value: false, label: "Wi-Fi + mobile data", icon: <SignalIcon size={16} /> },
  ];
  return (
    <div role="radiogroup" aria-label="Back up using" className={`grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1 ${className}`}>
      {options.map(({ value, label, icon }) => {
        const active = wifiOnly === value;
        return (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !active && onChange(value)}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-small font-medium transition-all duration-180 ease-out-expo disabled:opacity-60 ${
              active ? "bg-surface text-ink shadow-soft" : "text-ink-muted hover:text-ink"
            }`}
          >
            {icon}
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
