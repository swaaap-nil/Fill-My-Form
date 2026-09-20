export const DETECTION_BADGE_TEXT = "1";

export interface DetectionBadgeBrowser {
  readonly action?: {
    setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    setBadgeBackgroundColor?(details: {
      color: string;
      tabId?: number;
    }): Promise<void>;
  };
}

export const setDetectionBadge = async (
  browserApi: DetectionBadgeBrowser,
  tabId: number,
): Promise<void> => {
  if (!browserApi.action) return;
  await browserApi.action.setBadgeText({
    text: DETECTION_BADGE_TEXT,
    tabId,
  });
  await browserApi.action.setBadgeBackgroundColor?.({
    color: "#059669",
    tabId,
  });
};

export const clearDetectionBadge = async (
  browserApi: DetectionBadgeBrowser,
  tabId: number,
): Promise<void> => {
  if (!browserApi.action) return;
  await browserApi.action.setBadgeText({ text: "", tabId });
};
