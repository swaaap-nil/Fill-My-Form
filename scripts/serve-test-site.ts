/**
 * Static server for `test-site/`. Zero dependencies — Bun's built-in server is
 * enough, and a fixture site is not worth a package.
 */
const ROOT = new URL("../test-site/", import.meta.url);
const port = Number(process.env.PORT ?? 4173);

const server = Bun.serve({
  port,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);

    // Reject traversal before it reaches the filesystem.
    if (relative.includes("..")) {
      return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(new URL(relative, ROOT));
    return (await file.exists())
      ? new Response(file)
      : new Response("Not found", { status: 404 });
  },
});

console.log(`Test site: http://localhost:${server.port}`);
