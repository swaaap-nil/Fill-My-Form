import { useEffect, useState } from "react";
import { isAnalyticsConfigured } from "./client";
import { defaultAnalyticsEnabled } from "./preferences";
import { setAnalyticsEnabled, track } from "./track";

/**
 * Drives the analytics opt-out toggle. Separate from the sound React
 * context (src/lib/sfx/react.tsx) because the two preferences are
 * independent, but `track()` itself is wired into SoundProvider's play/
 * startLoop so every call site that already reports a lifecycle event to
 * uisfx reports the same event name to analytics, with no new call sites.
 */
export const useAnalyticsPreference = () => {
  const [enabled, setEnabled] = useState(defaultAnalyticsEnabled);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    import("./preferences").then(({ createAnalyticsPreferenceStore }) =>
      createAnalyticsPreferenceStore()
        .load()
        .then((loadedValue) => {
          if (!mounted) return;
          setEnabled(loadedValue);
          setLoaded(true);
        }),
    );
    return () => {
      mounted = false;
    };
  }, []);

  const toggle = async (next: boolean) => {
    setEnabled(next);
    await setAnalyticsEnabled(next);
  };

  return {
    enabled,
    loaded,
    configured: isAnalyticsConfigured,
    setEnabled: toggle,
  };
};

export { track };
