import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { track } from "~/lib/analytics/track";
import type { SfxEvent } from "./events";
import {
  createSoundPreferenceStore,
  defaultSoundPreferences,
  type SoundPreferences,
} from "./preferences";
import { getSharedUISoundService, type UISoundService } from "./service";

interface SoundContextValue {
  readonly preferences: SoundPreferences;
  readonly canPlayAudio: boolean;
  readonly play: (event: SfxEvent) => void;
  readonly startLoop: (id: string, event: SfxEvent) => void;
  readonly stopLoop: (id: string) => void;
  readonly setEnabled: (enabled: boolean) => Promise<void>;
  readonly setVolume: (volume: number) => Promise<void>;
  readonly unlockFromGesture: () => void;
}

const noopContext: SoundContextValue = {
  preferences: defaultSoundPreferences,
  canPlayAudio: false,
  play: () => {},
  startLoop: () => {},
  stopLoop: () => {},
  setEnabled: async () => {},
  setVolume: async () => {},
  unlockFromGesture: () => {},
};

const SoundContext = createContext<SoundContextValue>(noopContext);

export const SoundProvider = ({
  children,
}: {
  readonly children: React.ReactNode;
}) => {
  const [preferences, setPreferences] = useState(defaultSoundPreferences);
  const serviceRef = useRef<UISoundService | null>(null);

  useEffect(() => {
    let mounted = true;
    const destroyOnUnload = () => {
      void serviceRef.current?.destroy();
    };
    window.addEventListener("beforeunload", destroyOnUnload);

    createSoundPreferenceStore()
      .load()
      .then((loaded) => {
        if (!mounted) return;
        setPreferences(loaded);
        serviceRef.current = getSharedUISoundService(loaded);
      });

    return () => {
      mounted = false;
      window.removeEventListener("beforeunload", destroyOnUnload);
      serviceRef.current?.stopAll();
    };
  }, []);

  const value = useMemo<SoundContextValue>(
    () => ({
      preferences,
      canPlayAudio: serviceRef.current?.canPlayAudio ?? false,
      play: (event) => {
        serviceRef.current?.play(event);
        track(event);
      },
      startLoop: (id, event) => {
        serviceRef.current?.startLoop(id, event);
        track(event);
      },
      stopLoop: (id) => serviceRef.current?.stopLoop(id),
      setEnabled: async (enabled) => {
        const next = { ...preferences, enabled };
        setPreferences(next);
        await serviceRef.current?.setEnabled(enabled);
      },
      setVolume: async (volume) => {
        const next = { ...preferences, volume };
        setPreferences(next);
        await serviceRef.current?.setVolume(volume);
      },
      unlockFromGesture: () => serviceRef.current?.unlockFromGesture(),
    }),
    [preferences],
  );

  return (
    <SoundContext.Provider value={value}>
      <div
        className="contents"
        onKeyDownCapture={(event) => {
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          value.unlockFromGesture();
        }}
        onPointerDownCapture={() => value.unlockFromGesture()}
      >
        {children}
      </div>
    </SoundContext.Provider>
  );
};

export const useSound = () => useContext(SoundContext);
