/**
 * Loopback HTTP server that serves deterministic fixture pages for e2e tests.
 * All pages are self-contained; no external assets or scripts.
 */
import { createServer, type Server } from "node:http";

const PAGES: Record<string, string> = {
  "/search.html": `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Fixture Search</title></head>
<body>
  <h1>Search</h1>
  <form id="search-form" action="/result.html">
    <label for="q">Query</label>
    <input id="q" name="q" type="search" placeholder="enter query">
    <button type="submit">Search</button>
  </form>
</body>
</html>`,

  "/result.html": `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Fixture Result</title></head>
<body>
  <h1>Result</h1>
  <p id="answer">The answer is 42.</p>
</body>
</html>`,

  "/iframe.html": `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Fixture IFrame</title></head>
<body>
  <h1>Outer</h1>
  <iframe id="inner" src="/result.html" title="inner frame"></iframe>
</body>
</html>`,

  "/shell.html": `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Fixture SPA Shell</title></head>
<body>
  <h1>Shell</h1>
  <div id="content">loading…</div>
  <script>
    setTimeout(() => {
      document.getElementById("content").textContent = "Ready";
    }, 300);
  </script>
</body>
</html>`,
};

export type FixtureServer = {
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
};

export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const html = PAGES[path] ?? PAGES["/result.html"]!;
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(html);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("fixture server failed to start");
  const port = addr.port;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
