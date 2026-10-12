"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { repoKeyFor } from "@/lib/cache";
import {
  mergePeople,
  personHref,
  removeFromPerson,
  renamePerson,
  resolvePerson,
  setPersonCover,
  setPersonHidden,
  useAllPeople,
  type PersonDetails,
} from "@/lib/faces/people";
import { afterOverlayClosed, closeOverlaysThen } from "@/lib/library/history";
import { useLibrary } from "@/lib/library/hooks";
import { leaveForSignIn, signedOutAction } from "@/lib/library/signedOut";
import { useConfirm } from "@/app/components/ui/ConfirmDialog";
import { useToast } from "@/app/components/ui/Toast";
import EmptyState, { primaryButtonClass } from "@/app/components/library/EmptyState";
import MediaLibraryView from "@/app/components/library/MediaLibraryView";
import OverflowMenu from "@/app/components/library/OverflowMenu";
import PageHeader from "@/app/components/library/PageHeader";
import ScrollArea from "@/app/components/library/ScrollArea";
import SkeletonGrid from "@/app/components/library/SkeletonGrid";
import { BackIcon, CoverIcon, PencilIcon } from "@/app/components/library/icons";
import FaceAvatar from "./FaceAvatar";
import MergePeopleSheet from "./MergePeopleSheet";
import PersonNameSheet from "./PersonNameSheet";
import { EyeIcon, EyeOffIcon, MergeIcon, PersonRemoveIcon } from "./icons";

interface PersonClientProps {
  repoOwner: string;
  repoName: string;
  personId: string;
}

const iconButtonClass =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink";

function photos(count: number): string {
  return count === 1 ? "1 photo" : `${count.toLocaleString()} photos`;
}

/** A person's photos (newest first) with rename, merge, hide and "not this person". */
export default function PersonClient({ repoOwner, repoName, personId }: PersonClientProps) {
  const repoKey = repoKeyFor(repoOwner, repoName);
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const library = useLibrary(repoKey);
  const { people, ready } = useAllPeople(repoKey);
  const person = people.find((p) => p.id === personId) ?? null;
  const [naming, setNaming] = useState(false);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    const action = signedOutAction(library.error);
    if (action === "choose-repo") router.replace("/repos");
    else if (action === "sign-in") leaveForSignIn();
  }, [library.error, router]);

  // Merged into someone (here or on another device): follow them.
  const root = ready && !person ? resolvePerson(personId) : personId;
  useEffect(() => {
    if (root !== personId) router.replace(personHref(root));
  }, [root, personId, router]);

  const items = useMemo(() => {
    if (!person) return [];
    const ids = new Set(person.mediaIds);
    return library.items.filter((item) => ids.has(item.id));
  }, [person, library.items]);

  const goBack = () =>
    closeOverlaysThen(() => {
      if (window.history.length > 1) router.back();
      else router.push("/albums");
    });

  const backButton = (
    <button type="button" onClick={goBack} aria-label="Back" className={iconButtonClass}>
      <BackIcon size={20} />
    </button>
  );

  if (!person) {
    const notFound = ready && root === personId;
    return (
      <ScrollArea scrollKey={`person:${personId}`}>
        <PageHeader title={notFound ? "Person" : ""} leading={backButton} />
        {notFound ? (
          <EmptyState illustration="search" title="Person not found" message="Their photos may have been deleted.">
            <Link href="/people" className={primaryButtonClass}>
              See all people
            </Link>
          </EmptyState>
        ) : (
          <div className="sm:px-6">
            <SkeletonGrid />
          </div>
        )}
      </ScrollArea>
    );
  }

  const current: PersonDetails = person;
  const label = current.name ?? "this person";
  const others = people.filter((p) => p.id !== current.id);

  function rename(name: string | null) {
    setNaming(false);
    void renamePerson(current.id, name);
  }

  async function merge(chosen: PersonDetails[]) {
    const named = chosen.filter((p) => p.name && p.name !== current.name);
    const keepsName = current.name ?? named[0]?.name ?? null;
    const ok = await confirm({
      title: chosen.length === 1 ? "Merge these people?" : `Merge ${chosen.length + 1} people?`,
      message: keepsName
        ? `Their photos will be grouped as ${keepsName}.${named.length > (current.name ? 0 : 1) ? " Other names stay saved in your repo." : ""}`
        : "Their photos will be grouped as one person.",
      confirmLabel: "Merge",
    });
    if (!ok) return;
    setMerging(false);
    setNaming(false);
    void mergePeople(
      chosen.map((p) => p.id),
      current.id
    );
    toast({ tone: "success", message: keepsName ? `Merged into ${keepsName}` : "Merged" });
  }

  async function samePerson(other: PersonDetails) {
    const ok = await confirm({
      title: `Same person as ${other.name}?`,
      message: `${photos(current.mediaIds.length)} will be grouped with ${other.name}.`,
      confirmLabel: "Merge",
    });
    if (!ok) return;
    setNaming(false);
    void mergePeople([current.id], other.id);
    // The page follows the merge to the person who stays.
    afterOverlayClosed(() => router.replace(personHref(other.id)));
  }

  async function toggleHidden() {
    if (current.hidden) {
      void setPersonHidden(current.id, false);
      toast({ message: `${current.name ?? "This person"} is shown in People again` });
      return;
    }
    const ok = await confirm({
      title: `Hide ${label}?`,
      message: "They won't appear in People or search. Their photos stay in your library. You can show them again from Settings › People.",
      confirmLabel: "Hide",
    });
    if (!ok) return;
    void setPersonHidden(current.id, true);
    toast({
      message: `Hid ${current.name ?? "this person"}`,
      actionLabel: "Undo",
      onAction: () => void setPersonHidden(current.id, false),
      durationMs: 5000,
    });
  }

  function notThisPerson(ids: string[], exit: () => void) {
    exit();
    void removeFromPerson(current.id, ids);
    toast({
      message: ids.length === 1 ? `Removed 1 photo from ${label}` : `Removed ${ids.length} photos from ${label}`,
    });
  }

  const loading = items.length === 0 && (!library.hydrated || (!library.synced && !library.error));

  return (
    <>
      <MediaLibraryView
        repoKey={repoKey}
        scrollKey={`person:${current.id}`}
        items={items}
        loading={loading}
        empty={<EmptyState illustration="photos" title="No photos" message="This person's photos were deleted." />}
        extraActions={(ids, exit) => [
          {
            key: "not-this-person",
            label: "Not this person",
            icon: <PersonRemoveIcon size={20} />,
            onClick: () => notThisPerson(ids, exit),
          },
          {
            key: "person-cover",
            label: "Use as profile photo",
            icon: <CoverIcon size={20} />,
            overflow: true,
            disabled: ids.length !== 1,
            onClick: () => {
              exit();
              void setPersonCover(current.id, ids[0]);
              toast({ tone: "success", message: "Profile photo updated" });
            },
          },
        ]}
        header={({ selectMode, startSelect }) => (
          <div className="bg-bg pt-safe sm:pt-0">
            <div className="flex h-16 items-center gap-1 px-2 sm:px-6">
              {backButton}
              <FaceAvatar repoKey={repoKey} face={current.cover} muted={current.hidden} className="ml-1 h-10 w-10" />
              <div className="min-w-0 flex-1 pl-2">
                {current.name ? (
                  <h1 className="truncate text-h3 font-semibold tracking-tight text-ink">{current.name}</h1>
                ) : (
                  <button
                    type="button"
                    onClick={() => setNaming(true)}
                    className="-ml-1 truncate rounded-full px-1 text-left text-h3 font-semibold tracking-tight text-accent transition-colors duration-180 hover:bg-accent/10"
                  >
                    Add a name
                  </button>
                )}
                <p className="truncate text-micro text-ink-muted">
                  {photos(items.length || current.mediaIds.length)}
                  {current.hidden ? " · Hidden" : ""}
                </p>
              </div>
              {items.length > 0 && !selectMode && (
                <button
                  type="button"
                  onClick={startSelect}
                  className="h-9 shrink-0 rounded-full px-3 text-small font-medium text-ink transition-colors duration-180 hover:bg-surface-2"
                >
                  Select
                </button>
              )}
              <OverflowMenu
                label="Person options"
                items={[
                  {
                    key: "name",
                    label: current.name ? "Rename" : "Add a name",
                    icon: <PencilIcon size={18} />,
                    onSelect: () => setNaming(true),
                  },
                  {
                    key: "merge",
                    label: "Same person as…",
                    icon: <MergeIcon size={18} />,
                    onSelect: () => setMerging(true),
                  },
                  {
                    key: "hide",
                    label: current.hidden ? "Show in People" : "Hide person",
                    icon: current.hidden ? <EyeIcon size={18} /> : <EyeOffIcon size={18} />,
                    onSelect: () => void toggleHidden(),
                  },
                ]}
              />
            </div>
          </div>
        )}
      />

      <PersonNameSheet
        open={naming}
        repoKey={repoKey}
        person={current}
        others={others}
        onRename={rename}
        onSamePerson={(other) => void samePerson(other)}
        onClose={() => setNaming(false)}
      />

      <MergePeopleSheet
        open={merging}
        repoKey={repoKey}
        person={current}
        people={people}
        onMerge={(chosen) => void merge(chosen)}
        onClose={() => setMerging(false)}
      />
    </>
  );
}
