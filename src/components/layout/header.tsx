import { Volume2, VolumeX } from "lucide-react";
import type * as React from "react";
import { browser } from "wxt/browser";
import { Logo } from "~/components/common/logo";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { useSound } from "~/lib/sfx/react";

export const Header = ({ action }: { readonly action?: React.ReactNode }) => {
  return (
    <header className="flex w-full items-center gap-3 rounded-lg border border-border bg-card/90 p-3 shadow-sm shadow-black/5 dark:shadow-black/20">
      <div className="flex min-w-0 items-center gap-2">
        <Logo className="size-8 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="truncate font-semibold text-sm leading-tight">
            {browser.i18n.getMessage("extensionName")}
          </p>
          <p className="truncate text-muted-foreground text-xs">
            {browser.i18n.getMessage("headerSubtitle")}
          </p>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {action}
        <SoundControl />
      </div>
    </header>
  );
};

const SoundControl = () => {
  const sound = useSound();
  const enabled = sound.preferences.enabled;

  const toggleSound = async () => {
    sound.unlockFromGesture();
    if (enabled) {
      sound.play("soundDisabled");
      await sound.setEnabled(false);
    } else {
      await sound.setEnabled(true);
      sound.play("soundEnabled");
    }
  };

  const changeVolume = async (event: React.ChangeEvent<HTMLInputElement>) => {
    sound.unlockFromGesture();
    await sound.setVolume(Number(event.target.value));
    sound.play("soundVolumeChanged");
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      {enabled && (
        <Label className="sr-only" htmlFor="sound-volume">
          Sound volume
        </Label>
      )}
      {enabled && (
        <input
          aria-label="Sound volume"
          className="h-2 w-20 accent-primary"
          id="sound-volume"
          max="1"
          min="0"
          onChange={changeVolume}
          step="0.05"
          type="range"
          value={sound.preferences.volume}
        />
      )}
      <Button
        aria-label={enabled ? "Turn sound off" : "Turn sound on"}
        onClick={toggleSound}
        size="icon-sm"
        title={enabled ? "Turn sound off" : "Turn sound on"}
        type="button"
        variant="ghost"
      >
        {enabled ? (
          <Volume2 className="size-4" />
        ) : (
          <VolumeX className="size-4" />
        )}
      </Button>
    </div>
  );
};
