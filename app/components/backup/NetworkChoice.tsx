"use client";

import { SignalIcon, WifiIcon } from "@/app/components/library/icons";
import SegmentedControl from "@/app/components/ui/SegmentedControl";

const OPTIONS = [
  { value: true, label: "Wi-Fi only", icon: <WifiIcon size={16} /> },
  // Short enough for half of a 360px phone's card.
  { value: false, label: "Mobile data too", icon: <SignalIcon size={16} /> },
];

/** Segmented "Wi-Fi only" / "Mobile data too" choice for backups. */
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
  return (
    <SegmentedControl
      label="Back up using"
      value={wifiOnly}
      options={OPTIONS}
      onChange={onChange}
      disabled={disabled}
      className={className}
    />
  );
}
