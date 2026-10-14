"use client";

import { useEffect, useState } from "react";
import Sheet from "@/app/components/ui/Sheet";
import Switch from "@/app/components/ui/Switch";
import SectionLabel from "@/app/components/ui/SectionLabel";
import SelectCheck from "@/app/components/ui/SelectCheck";
import type { BackupFolders, BackupOptions } from "@/lib/native/backup";
import { primaryButtonClass, secondaryButtonClass } from "@/app/components/library/EmptyState";
import NetworkChoice from "./NetworkChoice";

interface EnableBackupSheetProps {
  open: boolean;
  defaults: BackupOptions;
  busy: boolean;
  onConfirm: (options: BackupOptions) => void;
  onClose: () => void;
}

/** One answer of a radio group: a card with the round check. */
function Choice({
  checked,
  title,
  description,
  onSelect,
}: {
  checked: boolean;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-control border px-3.5 py-3 text-left transition-[background-color,border-color,transform] duration-180 ease-out-expo active:scale-[0.99] ${
        checked ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2"
      }`}
    >
      <SelectCheck selected={checked} variant="surface" className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-body font-medium text-ink">{title}</span>
        <span className="block text-footnote text-ink-muted">{description}</span>
      </span>
    </button>
  );
}

/** Asked when backup is turned on: include what's already on the phone, and which folders. */
export default function EnableBackupSheet({ open, defaults, busy, onConfirm, onClose }: EnableBackupSheetProps) {
  const [includeExisting, setIncludeExisting] = useState(defaults.includeExisting);
  const [folders, setFolders] = useState<BackupFolders>(defaults.folders);
  const [wifiOnly, setWifiOnly] = useState(defaults.wifiOnly);
  const [chargingOnly, setChargingOnly] = useState(defaults.chargingOnly);

  useEffect(() => {
    if (!open) return;
    setIncludeExisting(defaults.includeExisting);
    setFolders(defaults.folders);
    setWifiOnly(defaults.wifiOnly);
    setChargingOnly(defaults.chargingOnly);
  }, [open, defaults]);

  return (
    <Sheet open={open} onClose={onClose} title="Turn on backup">
      <div className="flex flex-col gap-6">
        <p className="text-callout font-normal text-ink-muted">
          Photos and videos upload to your GitHub repo in original quality, even when the app is closed. Anything
          already in your library is skipped, so nothing is uploaded twice.
        </p>

        <div role="radiogroup" aria-label="Photos already on this phone" className="flex flex-col gap-2">
          <SectionLabel as="h3" className="px-1 pb-0.5">
            Photos already on this phone
          </SectionLabel>
          <Choice
            checked={includeExisting}
            title="Back up everything"
            description="Everything already on this phone (newest first), then each new photo or video."
            onSelect={() => setIncludeExisting(true)}
          />
          <Choice
            checked={!includeExisting}
            title="Only new ones"
            description="Starts with what you take or download from now on."
            onSelect={() => setIncludeExisting(false)}
          />
        </div>

        <div role="radiogroup" aria-label="Folders" className="flex flex-col gap-2">
          <SectionLabel as="h3" className="px-1 pb-0.5">
            Folders
          </SectionLabel>
          <Choice
            checked={folders === "all"}
            title="All folders"
            description="Camera, screenshots, downloads and apps like WhatsApp."
            onSelect={() => setFolders("all")}
          />
          <Choice
            checked={folders === "camera"}
            title="Camera only"
            description="Just the photos and videos you take with the camera."
            onSelect={() => setFolders("camera")}
          />
        </div>

        <div className="flex flex-col gap-2">
          <SectionLabel as="h3" className="px-1 pb-0.5">
            Back up using
          </SectionLabel>
          <NetworkChoice wifiOnly={wifiOnly} onChange={setWifiOnly} />
          <p className="px-1 text-small text-ink-muted">
            {wifiOnly
              ? "Mobile data is never used."
              : "Uses mobile data when there's no Wi-Fi, but never while roaming."}
          </p>
        </div>

        <div className="rounded-control bg-surface-2 px-3.5 py-1">
          <Switch
            checked={chargingOnly}
            onChange={setChargingOnly}
            label="Only while charging"
            description="Backup never runs nonstop and always pauses on low battery. This waits for a charger too."
          />
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className={secondaryButtonClass}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm({ includeExisting, folders, wifiOnly, chargingOnly })}
            className={primaryButtonClass}
          >
            {busy ? "Turning on…" : "Turn on backup"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
