import { defineBackground } from "#imports";
import { getStorage, StorageKey } from "@/lib/storage";
import { createLogger } from "~/core/logging";
import { Message, onMessage } from "~/lib/messaging";
import { restoreGrantedSites } from "~/lib/site-access";

const logger = createLogger({ sessionId: crypto.randomUUID() });

/**
 * The background worker is where the agent runtime will live: it outlives any
 * side panel, so a run survives the panel being closed. Nothing here depends
 * on React. See docs/agent.md.
 */
const main = () => {
  // Runtime content-script registrations do not survive a browser restart,
  // but the user's permission grants do. Re-register for granted origins.
  restoreGrantedSites()
    .then((count) => logger.info("restored granted sites", { count }))
    .catch(() => logger.warn("could not restore granted sites"));
};

onMessage(Message.USER, () => {
  const storage = getStorage(StorageKey.USER);
  return storage.getValue();
});

export default defineBackground(main);
