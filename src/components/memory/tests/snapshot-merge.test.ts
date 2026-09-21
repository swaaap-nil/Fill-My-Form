import { describe, expect, it } from "bun:test";
import {
  overlayLocalRecords,
  overlaySavedKeys,
} from "~/components/memory/snapshot-merge";

describe("overlayLocalRecords", () => {
  it("keeps a value typed after the snapshot request started", () => {
    const merged = overlayLocalRecords(
      {},
      { "contact.email": "ananya@example.com" },
      { "contact.email": 2 },
      1,
    );

    expect(merged["contact.email"]).toBe("ananya@example.com");
  });

  it("lets the snapshot win for keys not edited since the request started", () => {
    const merged = overlayLocalRecords(
      { "contact.email": "stored@example.com" },
      { "contact.email": "stale draft" },
      { "contact.email": 1 },
      1,
    );

    expect(merged["contact.email"]).toBe("stored@example.com");
  });

  it("keeps a field the user cleared while the snapshot was in flight", () => {
    const merged = overlayLocalRecords(
      { "contact.email": "stored@example.com" },
      { "contact.email": "" },
      { "contact.email": 3 },
      2,
    );

    expect(merged["contact.email"]).toBe("");
  });

  it("drops a snapshot key that the local state no longer has", () => {
    const merged = overlayLocalRecords(
      { "documents.resume": "old" },
      {},
      { "documents.resume": 2 },
      1,
    );

    expect("documents.resume" in merged).toBe(false);
  });

  it("merges edited and unedited keys independently", () => {
    const merged = overlayLocalRecords(
      { a: "stored-a", b: "stored-b" },
      { a: "typed-a", b: "typed-b" },
      { a: 5, b: 1 },
      2,
    );

    expect(merged).toEqual({ a: "typed-a", b: "stored-b" });
  });
});

describe("overlaySavedKeys", () => {
  it("keeps a key saved locally after the snapshot request started", () => {
    const merged = overlaySavedKeys(
      new Set(),
      new Set(["contact.email"]),
      { "contact.email": 2 },
      1,
    );

    expect(merged.has("contact.email")).toBe(true);
  });

  it("forgets a key deleted locally after the snapshot request started", () => {
    const merged = overlaySavedKeys(
      new Set(["contact.email"]),
      new Set(),
      { "contact.email": 2 },
      1,
    );

    expect(merged.has("contact.email")).toBe(false);
  });

  it("takes the snapshot's keys when nothing was edited since", () => {
    const merged = overlaySavedKeys(
      new Set(["contact.email"]),
      new Set(["other"]),
      { other: 1 },
      1,
    );

    expect([...merged]).toEqual(["contact.email"]);
  });
});
