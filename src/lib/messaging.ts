import { defineExtensionMessaging } from "@webext-core/messaging";

/**
 * Empty until Phase 1c defines the panel/background protocol. The only
 * message here (`USER`) went with the auth UI it served.
 */
type Messages = Record<string, never>;

export const { sendMessage, onMessage } = defineExtensionMessaging<Messages>();
