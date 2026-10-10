"use client";

import type { ReactNode } from "react";
import type { MediaIndexEntry, MediaRecord } from "@/lib/media";
import Sheet from "@/app/components/ui/Sheet";
import { formatBytes, formatDateTime, formatDuration, isVideoItem, megapixels, typeLabel } from "./format";
import {
  CalendarIcon,
  ClockIcon,
  CloudUpIcon,
  DimensionsIcon,
  FileIcon,
  PhoneIcon,
  SparkleIcon,
  StorageIcon,
} from "./icons";

interface InfoSheetProps {
  open: boolean;
  onClose: () => void;
  item: MediaIndexEntry | null;
  /** Full metadata, when it has loaded. */
  record: MediaRecord | null;
  loading: boolean;
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <dt className="text-micro font-medium uppercase tracking-wide text-ink-faint">{label}</dt>
        <dd className="mt-0.5 break-words text-body text-ink">{children}</dd>
      </div>
    </div>
  );
}

function Pending() {
  return (
    <span className="skeleton inline-block h-4 w-24 rounded align-middle">
      <span className="sr-only">Loading</span>
    </span>
  );
}

export default function InfoSheet({ open, onClose, item, record, loading }: InfoSheetProps) {
  const width = item?.width ?? record?.width;
  const height = item?.height ?? record?.height;
  const duration = item?.duration ?? record?.duration;
  const size = item?.size ?? record?.size;
  const takenAt = item?.takenAt ?? record?.takenAt;
  const source = record?.source;

  return (
    <Sheet open={open} onClose={onClose} title="Details">
      {item && (
        <dl className="divide-y divide-border">
          <Row icon={<FileIcon size={18} />} label="File">
            <span className="font-medium">{item.filename}</span>
            <span className="block text-small text-ink-muted">{typeLabel(item.mimeType)}</span>
          </Row>
          <Row icon={<CalendarIcon size={18} />} label="Taken">
            {formatDateTime(takenAt) ?? (loading && !record ? <Pending /> : <span className="text-ink-muted">Unknown</span>)}
          </Row>
          <Row icon={<CloudUpIcon size={18} />} label="Uploaded">
            {formatDateTime(item.createdAt) ?? "Unknown"}
          </Row>
          <Row icon={<StorageIcon size={18} />} label="Size">
            {size !== undefined ? formatBytes(size) : loading ? <Pending /> : <span className="text-ink-muted">Unknown</span>}
          </Row>
          <Row icon={<DimensionsIcon size={18} />} label="Resolution">
            {width && height ? (
              <>
                {width} × {height}
                {megapixels(width, height) && (
                  <span className="text-ink-muted"> · {megapixels(width, height)}</span>
                )}
              </>
            ) : loading && !record ? (
              <Pending />
            ) : (
              <span className="text-ink-muted">Unknown</span>
            )}
          </Row>
          {isVideoItem(item) && (
            <Row icon={<ClockIcon size={18} />} label="Duration">
              {duration !== undefined ? formatDuration(duration) : loading ? <Pending /> : <span className="text-ink-muted">Unknown</span>}
            </Row>
          )}
          {source && (
            <Row icon={<PhoneIcon size={18} />} label="Added from">
              {source === "android-backup" ? "Automatic backup on your phone" : "Upload from the web"}
            </Row>
          )}
          {item.editedFrom && (
            <Row icon={<SparkleIcon size={18} />} label="Edited">
              An edited copy. The original is still in your library.
            </Row>
          )}
        </dl>
      )}
    </Sheet>
  );
}
