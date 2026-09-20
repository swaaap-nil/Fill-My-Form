import { describe, expect, it } from "bun:test";
import {
  deliverDetectionNudges,
  notificationIdForTab,
} from "~/lib/deliver-detection-nudges";

describe("deliverDetectionNudges", () => {
  it("creates notification, badge, in-page nudge, and ack in order", async () => {
    const steps: string[] = [];

    await deliverDetectionNudges(
      {
        tabId: 9,
        knownFieldCount: 2,
        answerCount: 3,
        generation: "https://jobs.example/apply",
        iconUrl: "chrome-extension://abc/icons/48.png",
      },
      {
        getTitle: () => "Fill My Form",
        getBody: (known, answers) =>
          `${known} known fields, ${answers} answers ready to review`,
        createNotification: async (id, options) => {
          steps.push("notification");
          expect(id).toBe(notificationIdForTab(9));
          expect(options).toEqual({
            type: "basic",
            iconUrl: "chrome-extension://abc/icons/48.png",
            title: "Fill My Form",
            message: "2 known fields, 3 answers ready to review",
          });
        },
        setBadge: async (tabId) => {
          steps.push("badge");
          expect(tabId).toBe(9);
        },
        showFormDetectionNudge: async (tabId, payload) => {
          steps.push("banner");
          expect(tabId).toBe(9);
          expect(payload).toEqual({
            knownFieldCount: 2,
            answerCount: 3,
          });
        },
        ackFormPageDetected: async (tabId, generation) => {
          steps.push("ack");
          expect(tabId).toBe(9);
          expect(generation).toBe("https://jobs.example/apply");
        },
      },
    );

    expect(steps).toEqual(["notification", "badge", "banner", "ack"]);
  });

  it("uses fallback copy when i18n strings are missing", async () => {
    let message = "";
    await deliverDetectionNudges(
      {
        tabId: 1,
        knownFieldCount: 4,
        answerCount: 5,
        generation: "gen",
        iconUrl: "icon.png",
      },
      {
        getTitle: () => undefined,
        getBody: () => undefined,
        createNotification: async (_id, options) => {
          message = options.message;
        },
        setBadge: async () => {},
        showFormDetectionNudge: async () => {},
        ackFormPageDetected: async () => {},
      },
    );

    expect(message).toBe("4 known fields, 5 answers");
  });

  it("still acks when the in-page nudge message fails", async () => {
    const steps: string[] = [];
    await deliverDetectionNudges(
      {
        tabId: 2,
        knownFieldCount: 1,
        answerCount: 1,
        generation: "g",
        iconUrl: "icon.png",
      },
      {
        getTitle: () => "T",
        getBody: () => "B",
        createNotification: async () => {
          steps.push("notification");
        },
        setBadge: async () => {
          steps.push("badge");
        },
        showFormDetectionNudge: async () => {
          steps.push("banner-fail");
          throw new Error("no content script");
        },
        ackFormPageDetected: async () => {
          steps.push("ack");
        },
      },
    );

    expect(steps).toEqual(["notification", "badge", "banner-fail", "ack"]);
  });
});
