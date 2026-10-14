"use client";

import Link from "next/link";
import { useMemo, type MouseEvent, type ReactNode } from "react";
import type { MediaIndexEntry, MediaRecord } from "@/lib/media";
import { metadataPath } from "@/lib/media/types";
import Sheet from "@/app/components/ui/Sheet";
import FaceAvatar from "@/app/components/people/FaceAvatar";
import { openExternal } from "@/app/components/auth/TokenSignIn";
import { personHref, usePeople } from "@/lib/faces/people";
import { useAlbums } from "@/lib/library/hooks";
import { categoryHref, classify, EDITED_CATEGORY, SOURCE_CATEGORIES, VIDEOS_CATEGORY } from "@/lib/library/categories";
import { useSession } from "@/lib/session/useSession";
import { formatBytes, formatDateTime, formatDuration, isVideoItem, megapixels, typeLabel, viewerTitle } from "./format";
import {
  AlbumIcon,
  ClockIcon,
  CloudUpIcon,
  DimensionsIcon,
  ExternalIcon,
  FileIcon,
  GitHubIcon,
  PhoneIcon,
  SparkleIcon,
  StorageIcon,
  TagIcon,
} from "./icons";

interface InfoSheetProps {
  open: boolean;
  onClose: () => void;
  item: MediaIndexEntry | null;
  /** Full metadata, when it has loaded. */
  record: MediaRecord | null;
  loading: boolean;
  repoKey: string;
}

// docs/DESIGN.md › Cards / SettingsBlocks: grouped inset rows with a rounded-square icon badge.
function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[56px] items-center gap-3.5 px-4 py-2.5">
      <span className="lv-info-badge flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]">{icon}</span>
      <div className="min-w-0 flex-1">
        <dt className="text-[13px] leading-[18px] text-ink-muted">{label}</dt>
        <dd className="mt-0.5 break-words text-[15px] leading-[22px] tabular-nums text-ink">{children}</dd>
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

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-6 px-1 text-[13px] font-semibold leading-[18px] text-ink-muted">{children}</h3>;
}

const CARD = "lv-info-card divide-y divide-border overflow-hidden rounded-[22px]";

/** The categories an item sits in, as links (Camera, WhatsApp, Videos, Edited, a device folder). */
function categoriesOf(item: MediaIndexEntry): { id: string; name: string }[] {
  const c = classify(item);
  const out: { id: string; name: string }[] = [];
  if (c.source) out.push({ id: c.source, name: SOURCE_CATEGORIES.find((s) => s.id === c.source)?.name ?? c.source });
  else if (c.folderId && c.folderName) out.push({ id: c.folderId, name: c.folderName });
  if (c.video) out.push({ id: VIDEOS_CATEGORY.id, name: VIDEOS_CATEGORY.name });
  if (c.edited) out.push({ id: EDITED_CATEGORY.id, name: EDITED_CATEGORY.name });
  return out;
}

export default function InfoSheet({ open, onClose, item, record, loading, repoKey }: InfoSheetProps) {
  const width = item?.width ?? record?.width;
  const height = item?.height ?? record?.height;
  const duration = item?.duration ?? record?.duration;
  const size = item?.size ?? record?.size;
  const takenAt = item?.takenAt ?? record?.takenAt;
  const source = record?.source;
  const title = viewerTitle(takenAt ?? item?.createdAt);

  const { people } = usePeople(repoKey);
  const albums = useAlbums(repoKey, { load: open });
  const session = useSession();
  const id = item?.id;
  const inPhoto = useMemo(() => (id ? people.filter((person) => person.mediaIds.includes(id)) : []), [people, id]);
  const inAlbums = useMemo(() => (id ? albums.albums.filter((album) => album.mediaIds.includes(id)) : []), [albums.albums, id]);
  const categories = useMemo(() => (item ? categoriesOf(item) : []), [item]);
  const githubUrl =
    item && session.owner && session.repo
      ? `https://github.com/${session.owner}/${session.repo}/blob/${encodeURIComponent(session.branch ?? "main")}/${metadataPath(item.id)}`
      : null;

  return (
    <Sheet open={open} onClose={onClose} title="Details">
      {item && (
        <div className="pb-2">
          {title && (
            <div className="px-1 pb-4">
              <p className="text-[17px] font-semibold leading-[22px] tracking-[-0.01em] text-ink">{title.date}</p>
              <p className="mt-0.5 text-[13px] leading-[18px] tabular-nums text-ink-muted">
                {title.time}
                {!takenAt && " · Upload time"}
              </p>
            </div>
          )}

          <dl className={CARD}>
            <Row icon={<FileIcon size={17} />} label="File">
              <span className="font-medium">{item.filename}</span>
              <span className="block text-[13px] leading-[18px] text-ink-muted">{typeLabel(item.mimeType)}</span>
            </Row>
            <Row icon={<StorageIcon size={17} />} label="Size">
              {size !== undefined ? formatBytes(size) : loading ? <Pending /> : <span className="text-ink-muted">Unknown</span>}
            </Row>
            <Row icon={<DimensionsIcon size={17} />} label="Dimensions">
              {width && height ? (
                <>
                  {width} × {height}
                  {megapixels(width, height) && <span className="text-ink-muted"> · {megapixels(width, height)}</span>}
                </>
              ) : loading && !record ? (
                <Pending />
              ) : (
                <span className="text-ink-muted">Unknown</span>
              )}
            </Row>
            {isVideoItem(item) && (
              <Row icon={<ClockIcon size={17} />} label="Duration">
                {duration !== undefined ? formatDuration(duration) : loading ? <Pending /> : <span className="text-ink-muted">Unknown</span>}
              </Row>
            )}
            <Row icon={<ClockIcon size={17} />} label="Taken">
              {formatDateTime(takenAt) ?? (loading && !record ? <Pending /> : <span className="text-ink-muted">Unknown</span>)}
            </Row>
            <Row icon={<CloudUpIcon size={17} />} label="Uploaded">
              {formatDateTime(item.createdAt) ?? "Unknown"}
            </Row>
            {source && (
              <Row icon={<PhoneIcon size={17} />} label="Added from">
                {source === "android-backup" ? "Automatic backup on your phone" : "Upload from the web"}
              </Row>
            )}
            {item.editedFrom && (
              <Row icon={<SparkleIcon size={17} />} label="Edited">
                An edited copy. The original is still in your library.
              </Row>
            )}
          </dl>

          {inPhoto.length > 0 && (
            <section aria-label="People in this photo">
              <SectionTitle>People</SectionTitle>
              <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
                {inPhoto.map((person) => (
                  <li key={person.id} className="shrink-0">
                    <Link
                      href={personHref(person.id)}
                      onClick={onClose}
                      className="flex w-[76px] flex-col items-center gap-1.5 rounded-[14px] p-1.5 transition-transform duration-160 active:scale-[0.97]"
                    >
                      <FaceAvatar repoKey={repoKey} face={person.cover} className="h-14 w-14" />
                      <span className="w-full truncate text-center text-[12px] font-medium leading-4 text-ink">
                        {person.name ?? "Add a name"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(inAlbums.length > 0 || categories.length > 0) && (
            <section aria-label="Albums and categories">
              <SectionTitle>{inAlbums.length > 0 ? "Albums and categories" : "Categories"}</SectionTitle>
              <ul className="flex flex-wrap gap-2">
                {inAlbums.map((album) => (
                  <li key={album.id}>
                    <Link href={`/albums/view?id=${encodeURIComponent(album.id)}`} onClick={onClose} className="lv-info-chip">
                      <AlbumIcon size={15} />
                      {album.name}
                    </Link>
                  </li>
                ))}
                {categories.map((category) => (
                  <li key={category.id}>
                    <Link href={categoryHref(category.id)} onClick={onClose} className="lv-info-chip">
                      <TagIcon size={15} />
                      {category.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {githubUrl && (
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event: MouseEvent<HTMLAnchorElement>) => openExternal(event, githubUrl)}
              className={`lv-info-card mt-6 flex min-h-[52px] rounded-[22px] items-center gap-3.5 px-4 text-[15px] text-ink transition-transform duration-160 active:scale-[0.99]`}
            >
              <span className="lv-info-badge flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]">
                <GitHubIcon size={17} />
              </span>
              <span className="min-w-0 flex-1">
                View on GitHub
                <span className="block truncate text-[13px] leading-[18px] text-ink-muted">{metadataPath(item.id)}</span>
              </span>
              <ExternalIcon size={16} className="shrink-0 text-ink-muted" />
            </a>
          )}
        </div>
      )}
    </Sheet>
  );
}
