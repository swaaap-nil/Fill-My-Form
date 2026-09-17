import { afterEach, describe, expect, it } from "bun:test";
import type { UISFXOptions, UISFXPlayer } from "uisfx";
import {
  createUISoundService,
  resetSharedUISoundServiceForTests,
} from "~/lib/sfx/service";

const captureWindow = () =>
  Object.getOwnPropertyDescriptor(globalThis, "window");

const setTestWindow = (value: unknown) => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value,
  });
};

const restoreWindow = (descriptor: PropertyDescriptor | undefined) => {
  if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
  else Reflect.deleteProperty(globalThis, "window");
};

const createFakePlayer = () => {
  const state = {
    unlocks: 0,
    plays: [] as string[],
    stopped: 0,
    stopAll: 0,
    destroyed: 0,
    enabled: true,
    volume: 0.7,
  };

  const player: UISFXPlayer = {
    async unlock() {
      state.unlocks += 1;
      return true;
    },
    play(cue) {
      state.plays.push(cue);
      return {
        stop() {
          state.stopped += 1;
        },
        ended: Promise.resolve(),
      };
    },
    async preload() {},
    setPack() {},
    getPack: () => "soft",
    setVolume(volume) {
      state.volume = volume;
    },
    getVolume: () => state.volume,
    setEnabled(enabled) {
      state.enabled = enabled;
    },
    isEnabled: () => state.enabled,
    stopAll() {
      state.stopAll += 1;
    },
    async destroy() {
      state.destroyed += 1;
    },
  };

  return { player, state };
};

afterEach(async () => {
  await resetSharedUISoundServiceForTests();
});

describe("UI sound service", () => {
  it("does not create a player when Web Audio is unavailable", () => {
    const previous = captureWindow();
    setTestWindow(undefined);
    let created = 0;

    try {
      const service = createUISoundService({
        createPlayer: (_options?: UISFXOptions) => {
          created += 1;
          return createFakePlayer().player;
        },
      });

      expect(service.canPlayAudio).toBe(false);
      expect(created).toBe(0);
      expect(service.play("scanSucceeded")).toBeNull();
    } finally {
      restoreWindow(previous);
    }
  });

  it("suppresses playback until a gesture unlock succeeds", async () => {
    const previous = captureWindow();
    setTestWindow({ AudioContext: function AudioContext() {} });
    const fake = createFakePlayer();

    try {
      const service = createUISoundService({
        createPlayer: () => fake.player,
      });

      expect(service.play("scanSucceeded")).toBeNull();
      service.unlockFromGesture();
      await Promise.resolve();
      service.play("scanSucceeded");

      expect(fake.state.unlocks).toBe(1);
      expect(fake.state.plays).toEqual(["success"]);
    } finally {
      restoreWindow(previous);
    }
  });

  it("starts loops idempotently and clears them on stop", async () => {
    const previous = captureWindow();
    setTestWindow({ AudioContext: function AudioContext() {} });
    const fake = createFakePlayer();

    try {
      const service = createUISoundService({ createPlayer: () => fake.player });
      service.unlockFromGesture();
      await Promise.resolve();

      const first = service.startLoop("scan", "scanStarted");
      const second = service.startLoop("scan", "scanStarted");
      service.stopLoop("scan");
      service.stopLoop("scan");

      expect(first).toBe(second);
      expect(fake.state.plays).toEqual(["scanning"]);
      expect(fake.state.stopped).toBe(1);
    } finally {
      restoreWindow(previous);
    }
  });

  it("stops active loops and all voices when sound is disabled", async () => {
    const previous = captureWindow();
    setTestWindow({ AudioContext: function AudioContext() {} });
    const fake = createFakePlayer();

    try {
      const service = createUISoundService({ createPlayer: () => fake.player });
      service.unlockFromGesture();
      await Promise.resolve();
      service.startLoop("scan", "scanStarted");

      await service.setEnabled(false);

      expect(fake.state.enabled).toBe(false);
      expect(fake.state.stopped).toBe(1);
      expect(fake.state.stopAll).toBe(1);
      expect(service.play("scanSucceeded")).toBeNull();
    } finally {
      restoreWindow(previous);
    }
  });

  it("destroys the player and clears active loops on teardown", async () => {
    const previous = captureWindow();
    setTestWindow({ AudioContext: function AudioContext() {} });
    const fake = createFakePlayer();

    try {
      const service = createUISoundService({ createPlayer: () => fake.player });
      service.unlockFromGesture();
      await Promise.resolve();
      service.startLoop("scan", "scanStarted");

      await service.destroy();

      expect(fake.state.stopped).toBe(1);
      expect(fake.state.stopAll).toBe(1);
      expect(fake.state.destroyed).toBe(1);
      expect(service.isUnlocked()).toBe(false);
    } finally {
      restoreWindow(previous);
    }
  });
});
