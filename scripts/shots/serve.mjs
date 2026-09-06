// scripts/shots/serve.mjs
// A static server for dist/ with no dependencies, so the screenshot harness does not
// need a dev server or vite preview. Starts on a free port and returns it.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

export function serveDist(root) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      let file = normalize(join(root, decodeURIComponent(url.pathname)));
      if (!file.startsWith(normalize(root))) { res.writeHead(403); res.end(); return; }
      try {
        if ((await stat(file)).isDirectory()) file = join(file, "index.html");
        const body = await readFile(file);
        res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404); res.end();
      }
    });
    server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, close: () => server.close() }));
  });
}
