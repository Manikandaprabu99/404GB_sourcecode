"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Sheet from "@/app/components/ui/Sheet";
import { primaryButtonClass, secondaryButtonClass } from "./EmptyState";

interface AlbumNameSheetProps {
  open: boolean;
  title: string;
  initialName?: string;
  submitLabel: string;
  busyLabel: string;
  /** Rejecting keeps the sheet open and shows the error. */
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}

/** Name prompt for creating or renaming an album. */
export default function AlbumNameSheet({
  open,
  title,
  initialName = "",
  submitLabel,
  busyLabel,
  onSubmit,
  onClose,
}: AlbumNameSheetProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setBusy(false);
    setError(null);
    const frame = requestAnimationFrame(() => inputRef.current?.select());
    return () => cancelAnimationFrame(frame);
  }, [open, initialName]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  const unchanged = initialName !== "" && name.trim() === initialName;

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="Album name"
          aria-label="Album name"
          enterKeyHint="done"
          className="h-12 rounded-xl border border-border bg-surface-2 px-4 text-body text-ink outline-none transition-colors duration-180 placeholder:text-ink-faint focus:border-accent"
        />
        {error && <p className="text-small text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim() || busy || unchanged} className={primaryButtonClass}>
            {busy ? busyLabel : submitLabel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
