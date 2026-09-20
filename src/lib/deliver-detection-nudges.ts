export const notificationIdForTab = (tabId: number) =>
  `form-detection-${tabId}`;

export interface DetectionNudgeDelivery {
  readonly tabId: number;
  readonly knownFieldCount: number;
  readonly answerCount: number;
  readonly generation: string;
  readonly iconUrl: string;
}

export interface DetectionNudgeDeliveryPorts {
  readonly getTitle: () => string | undefined;
  readonly getBody: (
    knownFieldCount: number,
    answerCount: number,
  ) => string | undefined;
  readonly createNotification: (
    notificationId: string,
    options: {
      type: "basic";
      iconUrl: string;
      title: string;
      message: string;
    },
  ) => Promise<void>;
  readonly setBadge: (tabId: number) => Promise<void>;
  readonly showFormDetectionNudge: (
    tabId: number,
    payload: { knownFieldCount: number; answerCount: number },
  ) => Promise<void>;
  readonly ackFormPageDetected: (
    tabId: number,
    generation: string,
  ) => Promise<void>;
}

/** OS notification, toolbar badge, in-page banner, and detection ack — same dedupe gate as today. */
export const deliverDetectionNudges = async (
  delivery: DetectionNudgeDelivery,
  ports: DetectionNudgeDeliveryPorts,
): Promise<void> => {
  const { tabId, knownFieldCount, answerCount, generation, iconUrl } = delivery;
  const title = ports.getTitle();
  const message = ports.getBody(knownFieldCount, answerCount);

  await ports.createNotification(notificationIdForTab(tabId), {
    type: "basic",
    iconUrl,
    title: title || "Fill My Form",
    message:
      message || `${knownFieldCount} known fields, ${answerCount} answers`,
  });

  await ports.setBadge(tabId);
  await ports
    .showFormDetectionNudge(tabId, { knownFieldCount, answerCount })
    .catch(() => undefined);

  await ports.ackFormPageDetected(tabId, generation);
};
