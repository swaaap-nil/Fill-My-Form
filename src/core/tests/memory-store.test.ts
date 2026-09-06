import { createInMemoryMemoryStore } from "~/core/memory/in-memory";
import { runMemoryStoreContract } from "./memory-store-contract";

runMemoryStoreContract("createInMemoryMemoryStore", () => {
  let clock = "2026-01-01T00:00:00.000Z";
  const store = createInMemoryMemoryStore(() => clock);
  clock = "2026-02-01T00:00:00.000Z";
  return store;
});
