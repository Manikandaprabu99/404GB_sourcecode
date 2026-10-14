"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ThemeChoice } from "@/app/components/ThemeToggle";
import { SettingsCard, SettingsRow } from "@/app/components/library/SettingsBlocks";
import { CheckIcon, MoonIcon } from "@/app/components/library/icons";
import { TileSwitch } from "@/app/components/ui/Switch";
import { select as hapticSelect } from "@/lib/ui/haptics";
import {
  ACCENTS,
  FONTS,
  getAppearance,
  resolvedTheme,
  setAppearance,
  subscribeAppearance,
  type AccentId,
  type Appearance,
  type FontId,
} from "@/lib/ui/appearance";

/** The stored appearance plus the theme on screen; null until mounted. */
function useAppearanceState(): [Appearance | null, "light" | "dark"] {
  const [appearance, setState] = useState<Appearance | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    setState(getAppearance());
    setTheme(resolvedTheme());
    const unsubscribe = subscribeAppearance(setState);
    const observer = new MutationObserver(() => setTheme(resolvedTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, []);
  return [appearance, theme];
}

/** Arrow keys move the choice in a radio group of buttons. */
function useRovingRadios<T>(values: readonly T[], value: T | undefined, onChange: (next: T) => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, values.findIndex((v) => v === value));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + values.length) % values.length;
    refs.current[next]?.focus();
    onChange(values[next]);
  };
  const ref = (i: number) => (el: HTMLButtonElement | null) => {
    refs.current[i] = el;
  };
  return { index, onKeyDown, ref };
}

function AccentSwatches({ value, theme }: { value: AccentId | undefined; theme: "light" | "dark" }) {
  const choose = (accent: AccentId) => {
    if (accent === value) return;
    hapticSelect();
    setAppearance({ accent });
  };
  const roving = useRovingRadios(
    ACCENTS.map((a) => a.id),
    value,
    choose
  );
  return (
    <div role="radiogroup" aria-label="Accent colour" onKeyDown={roving.onKeyDown} className="grid grid-cols-8 gap-2 sm:flex sm:gap-3">
      {ACCENTS.map((accent, i) => {
        const on = accent.id === value;
        const fill = theme === "light" ? accent.light : accent.dark;
        const darkTick = accent.id === "graphite" && theme === "dark";
        return (
          <button
            key={accent.id}
            ref={roving.ref(i)}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`Accent: ${accent.name}`}
            title={accent.name}
            tabIndex={on || (value === undefined && i === 0) ? 0 : -1}
            onClick={() => choose(accent.id)}
            className={`relative flex aspect-square w-full max-w-[40px] items-center justify-center justify-self-center rounded-full sm:h-10 sm:w-10 transition-transform duration-160 ease-out-expo active:scale-90 ${
              on ? "ring-2 ring-offset-2 ring-offset-surface" : ""
            }`}
            style={{ background: fill, ...(on ? { ["--tw-ring-color" as string]: fill } : null) }}
          >
            {on && (
              <span className={`animate-check-pop ${darkTick ? "text-[rgb(13_15_20)]" : "text-white"}`}>
                <CheckIcon size={16} strokeWidth={3} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function FontCards({ value }: { value: FontId | undefined }) {
  const choose = (font: FontId) => {
    if (font === value) return;
    hapticSelect();
    setAppearance({ font });
  };
  const roving = useRovingRadios(
    FONTS.map((f) => f.id),
    value,
    choose
  );
  return (
    <div role="radiogroup" aria-label="Font" onKeyDown={roving.onKeyDown} className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {FONTS.map((font, i) => {
        const on = font.id === value;
        return (
          <button
            key={font.id}
            ref={roving.ref(i)}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`Font: ${font.name}`}
            title={font.note}
            tabIndex={on || (value === undefined && i === 0) ? 0 : -1}
            onClick={() => choose(font.id)}
            className={`pressable flex min-h-[84px] min-w-0 flex-col items-center justify-center gap-1 rounded-control px-1.5 py-3 text-ink transition-colors duration-180 ${
              on ? "bg-accent-soft shadow-[inset_0_0_0_2px_rgb(var(--accent))]" : "bg-surface-2 hover:bg-surface-3 dark:bg-ink/[0.05]"
            }`}
            style={{ fontFamily: font.family }}
          >
            <span className="text-[26px] font-semibold leading-8 tracking-[-0.02em]">Aa</span>
            <span className={`max-w-full truncate text-[12px] font-medium leading-4 ${on ? "text-accent-text" : "text-ink-muted"}`}>
              {font.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Settings › Appearance: theme, Pure black (dark only), accent and font, applied live. */
export default function AppearanceSettings() {
  const [appearance, theme] = useAppearanceState();
  return (
    <SettingsCard>
      <div className="flex flex-col gap-3 px-4 py-4">
        <p className="text-body font-medium text-ink">Theme</p>
        <ThemeChoice className="w-full" />
      </div>
      {theme === "dark" && (
        <SettingsRow
          icon={<MoonIcon size={18} />}
          iconTone="indigo"
          title="Pure black"
          description="A true black background for OLED screens."
          trailing={
            <TileSwitch
              label="Pure black"
              checked={appearance?.black ?? false}
              disabled={appearance === null}
              onChange={(black) => setAppearance({ black })}
            />
          }
        />
      )}
      <div className="flex flex-col gap-3.5 px-4 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-body font-medium text-ink">Accent colour</p>
          <p className="text-footnote text-ink-muted">{ACCENTS.find((a) => a.id === appearance?.accent)?.name}</p>
        </div>
        <AccentSwatches value={appearance?.accent} theme={theme} />
      </div>
      <div className="flex flex-col gap-3.5 px-4 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-body font-medium text-ink">Font</p>
          <p className="text-footnote text-ink-muted">{FONTS.find((f) => f.id === appearance?.font)?.note}</p>
        </div>
        <FontCards value={appearance?.font} />
      </div>
    </SettingsCard>
  );
}
