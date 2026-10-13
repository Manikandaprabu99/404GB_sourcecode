"use client";

import Link from "next/link";
import {
  requestRescan,
  setScanMobileData,
  setScanPaused,
  useAllPeople,
  useFaceScanStatus,
  useFaces,
  type PersonDetails,
} from "@/lib/faces/people";
import { IconTile, SettingsRow, cardClass, rowButtonClass } from "@/app/components/library/SettingsBlocks";
import { ChevronRightIcon, RefreshIcon, ShieldIcon } from "@/app/components/library/icons";
import Switch from "@/app/components/ui/Switch";
import TileMeter from "@/app/components/ui/TileMeter";
import { useToast } from "@/app/components/ui/Toast";
import BackgroundScanToggle from "./BackgroundScanToggle";
import FaceAvatar from "./FaceAvatar";
import { scanDetail, scanHeadline, scanInProgress } from "./scanText";
import { EyeOffIcon, PauseIcon, PlayIcon, ScanFaceIcon } from "./icons";

const BACKEND_LABEL: Record<string, string> = { webgl: "GPU (WebGL)", wasm: "CPU (WebAssembly)", cpu: "CPU", stub: "test" };

/** How many faces the card's stack shows. */
const STACK_MAX = 4;

/** The top people's faces, overlapping (the card's lead), or the face tile before anyone is found. */
function AvatarStack({ repoKey, people }: { repoKey: string; people: readonly PersonDetails[] }) {
  if (people.length === 0) {
    return (
      <IconTile tone="accent-2" className="h-10 w-10">
        <ScanFaceIcon size={20} />
      </IconTile>
    );
  }
  const more = people.length - STACK_MAX;
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center">
      {people.slice(0, STACK_MAX).map((person, i) => (
        <FaceAvatar
          key={person.id}
          repoKey={repoKey}
          face={person.cover}
          className={`h-10 w-10 ring-[2.5px] ring-surface ${i > 0 ? "-ml-3" : ""}`}
        />
      ))}
      {more > 0 && (
        <span className="telemetry -ml-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-3 pl-2 text-ink ring-[2.5px] ring-surface">
          +{more.toLocaleString()}
        </span>
      )}
    </span>
  );
}

/** Settings › People: scan progress, pause/resume, mobile data, finding people while charging
 * (Android app), re-scan, hidden people and the privacy note. */
export default function PeopleSettings({ repoKey }: { repoKey: string }) {
  const status = useFaceScanStatus();
  const faces = useFaces(repoKey);
  const { people } = useAllPeople(repoKey);
  const toast = useToast();
  const visible = people.filter((p) => p.visible);
  const visibleCount = visible.length;
  const hiddenCount = people.filter((p) => p.hidden).length;
  const mine = status.repoKey === repoKey;
  const working = mine && scanInProgress(status) && !status.paused;
  const detail = mine ? scanDetail(status) : null;
  const saveError = faces.error && faces.error.kind !== "offline" ? faces.error.message : null;

  let headline = mine ? scanHeadline(status) : "Starting…";
  if (mine && status.state === "done" && visibleCount > 0) {
    headline += ` · ${visibleCount.toLocaleString()} ${visibleCount === 1 ? "person" : "people"}`;
  }

  return (
    <div className={`divide-y divide-border/60 overflow-hidden ${cardClass}`}>
      <div className="flex flex-col gap-3.5 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <AvatarStack repoKey={repoKey} people={visible} />
          <button
            type="button"
            onClick={() => setScanPaused(!status.paused)}
            className={rowButtonClass}
            aria-label={status.paused ? "Resume face grouping" : "Pause face grouping"}
          >
            {status.paused ? <PlayIcon size={15} /> : <PauseIcon size={15} />}
            {status.paused ? "Resume" : "Pause"}
          </button>
        </div>
        <div className="min-w-0">
          <p className="text-h3 text-ink">Face grouping</p>
          <p data-testid="face-scan-status" className="mt-0.5 text-small text-ink-muted">
            <span className="block text-ink">{headline}</span>
            {detail && <span className="block">{detail}</span>}
            {saveError && <span className="block text-danger">{saveError}</span>}
          </p>
        </div>
        {mine && status.total > 0 && status.done < status.total && (
          <TileMeter
            fluid
            tiles={20}
            label="Photos checked"
            ariaLabel="Photos checked for faces"
            value={status.done}
            max={status.total}
            active={working}
            className="animate-fade-in"
          />
        )}
      </div>

      <div className="px-4 py-1">
        <Switch
          checked={status.mobileData}
          onChange={setScanMobileData}
          label="Use mobile data"
          description="Download photo previews for face grouping over mobile data too. Previews already on this device are always used."
        />
      </div>

      {/* Android app only (nothing renders elsewhere). */}
      <BackgroundScanToggle />

      <SettingsRow
        icon={<RefreshIcon size={18} />}
        title="Re-scan"
        description="Check every photo again, including ones that couldn't be read. Names and corrections are kept."
        trailing={
          <button
            type="button"
            onClick={() => {
              requestRescan();
              if (status.paused) setScanPaused(false);
              toast({ message: "Checking your photos for faces again" });
            }}
            className={rowButtonClass}
          >
            Re-scan
          </button>
        }
      />

      {hiddenCount > 0 && (
        <Link
          href="/people?hidden=1"
          className="group flex min-h-[56px] items-center gap-3.5 px-4 py-3 transition-colors duration-180 hover:bg-surface-2"
        >
          <IconTile>
            <EyeOffIcon size={18} />
          </IconTile>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium text-ink">Hidden people</span>
            <span className="block text-small text-ink-muted">
              {hiddenCount.toLocaleString()} hidden from People and search
            </span>
          </span>
          <ChevronRightIcon
            size={18}
            className="shrink-0 text-ink-muted transition-transform duration-180 ease-out-expo group-hover:translate-x-0.5"
          />
        </Link>
      )}

      <SettingsRow
        icon={<ShieldIcon size={18} />}
        iconTone="accent-2"
        title="Private by design"
        description={
          <>
            Faces are found and grouped on this device; your photos are never sent anywhere else. Face positions
            and face signatures are saved in your repo (<span className="font-mono text-micro">manifest/faces.json</span>)
            so your other devices don&apos;t scan again.
            {mine && status.backend && (
              <span className="telemetry mt-2 block text-ink-muted">
                Runs on {BACKEND_LABEL[status.backend] ?? status.backend}
              </span>
            )}
          </>
        }
      />
    </div>
  );
}
