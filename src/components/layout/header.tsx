import { Volume2, VolumeX } from "lucide-react";
import type * as React from "react";
import { browser } from "wxt/browser";
import { Logo } from "~/components/common/logo";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { AUTHOR_WEBSITE_URL } from "~/lib/author-link";
import { useSound } from "~/lib/sfx/react";

export const Header = ({ action }: { readonly action?: React.ReactNode }) => {
  return (
    <header className="flex w-full items-center gap-3 rounded-lg border border-border bg-card/90 px-3 py-2 shadow-sm shadow-black/5 dark:shadow-black/20">
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-2">
          <Logo className="size-8 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="overflow-visible text-sm leading-tight">
              <span className="font-semibold">
                {browser.i18n.getMessage("extensionName")}
              </span>
              <span className="pr-0.5 font-normal text-[11px] text-muted-foreground/80 italic">
                {" "}
                {browser.i18n.getMessage("extensionByAuthor")}{" "}
                <a
                  className="text-muted-foreground/90 underline-offset-2 transition-colors hover:text-foreground hover:underline"
                  href={AUTHOR_WEBSITE_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  {browser.i18n.getMessage("extensionAuthorName")}
                </a>
              </span>
            </p>
          </div>
        </div>
        <SoundControl />
      </div>
      <div className="ml-auto flex shrink-0 flex-col items-stretch gap-2 min-[440px]:flex-row min-[440px]:items-center">
        {action}
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
    <div className="-mt-0.5 flex shrink-0 items-center gap-2">
      {enabled && (
        <Label className="sr-only" htmlFor="sound-volume">
          Sound volume
        </Label>
      )}
      <div className="flex size-8 shrink-0 items-center justify-center">
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
      {enabled && (
        <SoundVolumeSlider
          id="sound-volume"
          onChange={changeVolume}
          value={sound.preferences.volume}
        />
      )}
    </div>
  );
};

const SoundVolumeSlider = ({
  id,
  onChange,
  value,
}: {
  readonly id: string;
  readonly onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  readonly value: number;
}) => {
  const gradientId = `${id}-gradient`;
  const clipId = `${id}-clip`;
  const thumb = getVolumeCurvePoint(value);
  const thumbColor = getVolumeThumbColor(value);

  return (
    <div className="relative h-5 w-24 shrink-0">
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        preserveAspectRatio="none"
        viewBox="0 0 96 20"
      >
        <defs>
          <linearGradient
            gradientUnits="userSpaceOnUse"
            id={gradientId}
            x1="2"
            x2="94"
            y1="0"
            y2="0"
          >
            <stop stopColor="#5863ff" />
            <stop offset="0.55" stopColor="#b7b1ff" />
            <stop offset="0.78" stopColor="#dec1f3" />
            <stop offset="1" stopColor="#ee82c4" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect height="20" width={thumb.x} x="0" y="0" />
          </clipPath>
        </defs>
        <path
          d={volumeCurvePath}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="3"
          className="text-input"
        />
        <path
          clipPath={`url(#${clipId})`}
          d={volumeCurvePath}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeLinecap="round"
          strokeWidth="3"
        />
      </svg>
      <input
        aria-label="Sound volume"
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        id={id}
        max="1"
        min="0"
        onChange={onChange}
        step="0.05"
        type="range"
        value={value}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 shadow-sm shadow-black/20 transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
        style={{
          backgroundColor: thumbColor,
          left: `${thumb.x}px`,
          top: `${thumb.y}px`,
        }}
      />
    </div>
  );
};

type CurvePoint = {
  readonly x: number;
  readonly y: number;
};

type CurveSegment = {
  readonly start: CurvePoint;
  readonly control1: CurvePoint;
  readonly control2: CurvePoint;
  readonly end: CurvePoint;
};

const volumeCurveSegments: readonly CurveSegment[] = [
  {
    start: { x: 2, y: 11 },
    control1: { x: 18, y: 11 },
    control2: { x: 20, y: 5 },
    end: { x: 31, y: 7.5 },
  },
  {
    start: { x: 31, y: 7.5 },
    control1: { x: 42, y: 10 },
    control2: { x: 44, y: 17 },
    end: { x: 55, y: 10 },
  },
  {
    start: { x: 55, y: 10 },
    control1: { x: 66, y: 3 },
    control2: { x: 69, y: 4.5 },
    end: { x: 78, y: 8.5 },
  },
  {
    start: { x: 78, y: 8.5 },
    control1: { x: 87, y: 12.5 },
    control2: { x: 86, y: 13 },
    end: { x: 94, y: 9 },
  },
];

const volumeCurvePath = volumeCurveSegments
  .map((segment, index) => {
    const command =
      `C${segment.control1.x} ${segment.control1.y} ` +
      `${segment.control2.x} ${segment.control2.y} ` +
      `${segment.end.x} ${segment.end.y}`;

    if (index === 0) {
      return `M${segment.start.x} ${segment.start.y}${command}`;
    }

    return command;
  })
  .join("");

const getVolumeCurvePoint = (value: number): CurvePoint => {
  const clampedValue = Math.min(1, Math.max(0, value));
  const first = volumeCurveSegments[0]?.start ?? { x: 0, y: 0 };
  const last = volumeCurveSegments.at(-1)?.end ?? first;
  const targetX = first.x + (last.x - first.x) * clampedValue;
  const segment =
    volumeCurveSegments.find(({ end }) => targetX <= end.x) ??
    volumeCurveSegments.at(-1);

  if (!segment) return first;

  let low = 0;
  let high = 1;
  for (let i = 0; i < 8; i += 1) {
    const mid = (low + high) / 2;
    const point = getCubicBezierPoint(segment, mid);
    if (point.x < targetX) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return getCubicBezierPoint(segment, (low + high) / 2);
};

const getCubicBezierPoint = (
  { start, control1, control2, end }: CurveSegment,
  t: number,
): CurvePoint => {
  const inverse = 1 - t;
  const inverseSquared = inverse * inverse;
  const inverseCubed = inverseSquared * inverse;
  const tSquared = t * t;
  const tCubed = tSquared * t;

  return {
    x:
      inverseCubed * start.x +
      3 * inverseSquared * t * control1.x +
      3 * inverse * tSquared * control2.x +
      tCubed * end.x,
    y:
      inverseCubed * start.y +
      3 * inverseSquared * t * control1.y +
      3 * inverse * tSquared * control2.y +
      tCubed * end.y,
  };
};

const getVolumeThumbColor = (value: number) => {
  if (value >= 0.78) return "#ee82c4";
  if (value >= 0.55) return "#dec1f3";
  if (value >= 0.25) return "#b7b1ff";
  return "#5863ff";
};
