import { lstatSync, readlinkSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Runs before `wxt` in the `dev:chrome` script.
 *
 * The dev browser uses a persistent profile (`.chrome-profile`) so that
 * pinning the extension and any site access survive a restart. The cost is a
 * lock: Chrome refuses to open a profile another instance already has, hands
 * off to that instance and exits, and WXT then reports
 *
 *   CDP connection closed before response to Extensions.loadUnpacked
 *
 * which says nothing about the actual cause. This turns that into a sentence
 * you can act on, and cleans up the common case automatically.
 */

const PROFILE = resolve(".chrome-profile");
const LOCKS = ["SingletonLock", "SingletonCookie", "SingletonSocket"];

/** Chrome writes the lock as a symlink named `<hostname>-<pid>`. */
const lockOwnerPid = (): number | null => {
  const lock = join(PROFILE, "SingletonLock");

  try {
    lstatSync(lock);
  } catch {
    return null; // No lock at all.
  }

  try {
    // Hostnames can contain dashes, so take the segment after the last one.
    const target = readlinkSync(lock);
    const pid = Number(target.slice(target.lastIndexOf("-") + 1));
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const pid = lockOwnerPid();

if (pid === null) {
  process.exit(0); // Nothing holding the profile.
}

if (isRunning(pid)) {
  console.error(
    [
      "",
      `A browser is already using the dev profile at ${PROFILE} (pid ${pid}).`,
      "",
      "Chrome allows one instance per profile, so this run would fail with a",
      "confusing CDP error. Either:",
      "",
      "  • quit that browser window and run `bun dev` again, or",
      "  • run `bun dev:fresh` to use a throwaway profile (you will re-pin), or",
      `  • kill it: kill ${pid}`,
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// The owning process is gone — a crash or a hard kill left the lock behind.
// Safe to clear.
for (const name of LOCKS) {
  rmSync(join(PROFILE, name), { force: true });
}
console.log(`Cleared a stale profile lock from pid ${pid}.`);
