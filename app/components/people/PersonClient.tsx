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
import { SelectButton, SubScreenBar, SubScreenTitle } from "@/app/components/library/SubScreenHeader";
import { BackIcon, CoverIcon, PencilIcon } from "@/app/components/library/icons";
import IconButton from "@/app/components/ui/IconButton";
import { Telemetry } from "@/app/components/ui/SectionLabel";
import FaceAvatar from "./FaceAvatar";
import MergePeopleSheet from "./MergePeopleSheet";
import PersonNameSheet from "./PersonNameSheet";
import { EyeIcon, EyeOffIcon, MergeIcon, PersonRemoveIcon } from "./icons";

interface PersonClientProps {
  repoOwner: string;
  repoName: string;
  personId: string;
}

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
    <IconButton variant="tile" label="Back" onClick={goBack}>
      <BackIcon size={20} />
    </IconButton>
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
        contained
        header={({ selectMode, startSelect, collapsed }) => (
          <SubScreenBar
            backLabel="Back"
            onBack={goBack}
            title={current.name ?? "Add a name"}
            collapsed={collapsed}
            actions={
              <>
                {items.length > 0 && !selectMode && <SelectButton onClick={startSelect} />}
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
              </>
            }
          />
        )}
        intro={() => (
          // A large face, the name (tap to rename) and the count.
          <SubScreenTitle
            leading={
              <FaceAvatar
                repoKey={repoKey}
                face={current.cover}
                muted={current.hidden}
                className="h-24 w-24 shadow-[0_10px_30px_-10px_rgb(0_0_0/0.5)] ring-[3px] ring-surface sm:h-28 sm:w-28"
              />
            }
            title={
              current.name ? (
                <h1 className="line-clamp-2 break-words text-large-title text-ink">
                  <button
                    type="button"
                    onClick={() => setNaming(true)}
                    title="Rename"
                    className="-mx-1.5 rounded-[10px] px-1.5 text-left transition-colors duration-180 hover:bg-ink/[0.06]"
                  >
                    {current.name}
                  </button>
                </h1>
              ) : (
                <button
                  type="button"
                  onClick={() => setNaming(true)}
                  className="-mx-1.5 self-start rounded-[10px] px-1.5 text-left text-large-title text-accent-text transition-colors duration-180 hover:bg-accent-soft"
                >
                  Add a name
                </button>
              )
            }
            telemetry={
              <Telemetry
                items={[photos(items.length || current.mediaIds.length), current.hidden ? "Hidden" : null]}
              />
            }
          />
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
