import {
  createUISFX,
  type PlayingSFX,
  type UISFXOptions,
  type UISFXPlayer,
} from "uisfx";
import {
  optionsForEvent,
  SELECTED_SFX_PACK,
  SFX_EVENT_CUES,
  type SfxEvent,
} from "./events";
import {
  createSoundPreferenceStore,
  defaultSoundPreferences,
  type SoundPreferences,
} from "./preferences";

type CreateUISFX = (options?: UISFXOptions) => UISFXPlayer;

export interface UISoundService {
  readonly canPlayAudio: boolean;
  readonly isUnlocked: () => boolean;
  readonly getPreferences: () => SoundPreferences;
  unlockFromGesture(): void;
  play(event: SfxEvent): PlayingSFX | null;
  startLoop(id: string, event: SfxEvent): PlayingSFX | null;
  stopLoop(id: string): void;
  stopAll(): void;
  setEnabled(enabled: boolean): Promise<void>;
  setVolume(volume: number): Promise<void>;
  destroy(): Promise<void>;
}

interface ServiceOptions {
  readonly preferences?: SoundPreferences;
  readonly createPlayer?: CreateUISFX;
}

const canUseWebAudio = () =>
  typeof window !== "undefined" &&
  ("AudioContext" in window || "webkitAudioContext" in window);

const clampVolume = (volume: number) => Math.min(1, Math.max(0, volume));

export const createUISoundService = ({
  preferences = defaultSoundPreferences,
  createPlayer = createUISFX,
}: ServiceOptions = {}): UISoundService => {
  let prefs: SoundPreferences = {
    enabled: preferences.enabled,
    volume: clampVolume(preferences.volume),
  };
  let player: UISFXPlayer | null = null;
  let unlocked = false;
  const loops = new Map<string, PlayingSFX>();
  const store = createSoundPreferenceStore();

  if (canUseWebAudio()) {
    player = createPlayer({
      pack: SELECTED_SFX_PACK,
      volume: prefs.volume,
      enabled: prefs.enabled,
    });
  }

  const stopLoop = (id: string) => {
    loops.get(id)?.stop();
    loops.delete(id);
  };

  const stopAll = () => {
    for (const id of loops.keys()) stopLoop(id);
    player?.stopAll();
  };

  return {
    canPlayAudio: player !== null,
    isUnlocked: () => unlocked,
    getPreferences: () => prefs,

    unlockFromGesture() {
      if (!player || unlocked || !prefs.enabled) return;
      void player.unlock().then((ok) => {
        unlocked = ok || unlocked;
      });
    },

    play(event) {
      if (!player || !unlocked || !prefs.enabled) return null;
      return player.play(SFX_EVENT_CUES[event], optionsForEvent(event));
    },

    startLoop(id, event) {
      if (!player || !unlocked || !prefs.enabled) return null;
      const existing = loops.get(id);
      if (existing) return existing;
      const handle = player.play(SFX_EVENT_CUES[event], {
        ...optionsForEvent(event),
        loop: true,
      });
      if (handle) loops.set(id, handle);
      return handle;
    },

    stopLoop,
    stopAll,

    async setEnabled(enabled) {
      prefs = { ...prefs, enabled };
      if (!enabled) stopAll();
      player?.setEnabled(enabled);
      await store.save(prefs);
    },

    async setVolume(volume) {
      prefs = { ...prefs, volume: clampVolume(volume) };
      player?.setVolume(prefs.volume);
      await store.save(prefs);
    },

    async destroy() {
      stopAll();
      await player?.destroy();
      player = null;
      unlocked = false;
    },
  };
};

let sharedService: UISoundService | null = null;

export const getSharedUISoundService = (
  preferences?: SoundPreferences,
): UISoundService => {
  sharedService ??= createUISoundService({ preferences });
  if (preferences) {
    void sharedService.setVolume(preferences.volume);
    void sharedService.setEnabled(preferences.enabled);
  }
  return sharedService;
};

export const resetSharedUISoundServiceForTests = async () => {
  await sharedService?.destroy();
  sharedService = null;
};
