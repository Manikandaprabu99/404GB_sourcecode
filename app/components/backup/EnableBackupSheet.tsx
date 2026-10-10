"use client";

import { useEffect, useState } from "react";
import Sheet from "@/app/components/ui/Sheet";
import Switch from "@/app/components/ui/Switch";
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
      className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors duration-180 ${
        checked ? "border-accent bg-accent/10" : "border-border hover:bg-surface-2"
      }`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-180 ${
          checked ? "border-accent" : "border-ink-faint"
        }`}
      >
        <span
          className={`h-2.5 w-2.5 rounded-full bg-accent transition-transform duration-180 ease-spring ${
            checked ? "scale-100" : "scale-0"
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-body font-medium text-ink">{title}</span>
        <span className="block text-small text-ink-muted">{description}</span>
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
      <div className="flex flex-col gap-5">
        <p className="text-small text-ink-muted">
          Photos and videos upload to your GitHub repo in original quality, even when the app is closed. Anything
          already in your library is skipped, so nothing is uploaded twice.
        </p>

        <div role="radiogroup" aria-label="Photos already on this phone" className="flex flex-col gap-2">
          <h3 className="text-small font-semibold text-ink">Photos already on this phone</h3>
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
          <h3 className="text-small font-semibold text-ink">Folders</h3>
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
          <h3 className="text-small font-semibold text-ink">Back up using</h3>
          <NetworkChoice wifiOnly={wifiOnly} onChange={setWifiOnly} />
          <p className="text-micro text-ink-faint">
            {wifiOnly
              ? "Mobile data is never used."
              : "Uses mobile data when there's no Wi-Fi, but never while roaming."}
          </p>
        </div>

        <div className="rounded-xl border border-border px-3.5 py-3">
          <Switch
            checked={chargingOnly}
            onChange={setChargingOnly}
            label="Only while charging"
            description="Backup never runs nonstop and always pauses on low battery. This waits for a charger too."
          />
        </div>

        <div className="flex justify-end gap-2">
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
