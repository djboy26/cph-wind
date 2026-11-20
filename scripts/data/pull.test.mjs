// scripts/data/pull.test.mjs
// data-pull.mjs end to end against a local HTTP server standing in for the bucket's public URL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const PULL = resolve("scripts/data-pull.mjs");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const objects = {
  "public/data/segtiles/index.json": '{"tiles":["10_1"]}',
  "public/data/segtiles/10_1.json": "[[1,2,3]]",
  "public/data/cph-roads.json": '{"type":"FeatureCollection","features":[]}',
  "data/raw/cph-buildings.json": '{"raw":true}',
};
let server, origin;
const served = new Map(); // URL path -> body; a test may corrupt one
beforeAll(async () => {
  for (const [p, body] of Object.entries(objects)) served.set(`/bucket/v1/${p}`, body);
  server = createServer((req, res) => {
    const body = served.get(req.url);
    if (body === undefined) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}/bucket`;
});
afterAll(() => server.close());

function repo({ published = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pull-"));
  const files = Object.fromEntries(Object.entries(objects).map(([p, b]) => [p, { bytes: Buffer.byteLength(b), sha256: sha(b) }]));
  writeFileSync(join(dir, "data.lock.json"), JSON.stringify({ version: "v1", origin: published ? origin : null, publishedAt: published ? "2026-10-08" : null, files }));
  return dir;
}
// Every run preloads a tripwire on process.exit. Once requests are open, the script must end
// by setting process.exitCode and letting the loop drain: on Windows, process.exit() with
// sockets still closing aborts the process (0xC0000409, a libuv assertion) instead of
// exiting 1. Linux exits fine either way, so only this tripwire catches it here.
const TRIPWIRE = join(mkdtempSync(join(tmpdir(), "tripwire-")), "exit-tripwire.mjs");
writeFileSync(TRIPWIRE, 'const exit = process.exit.bind(process);\nprocess.exit = (code) => { process.stderr.write(`[process.exit(${code})]\\n`); exit(code); };\n');
const NO_EXIT_CALL = /\[process\.exit\(/;

// Async, not spawnSync: the stand-in server lives in this process and must keep serving.
function run(dir, ...args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ["--import", pathToFileURL(TRIPWIRE).href, PULL, ...args], { cwd: dir });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });
}

describe("data:pull", () => {
  it("fetches the app's files into an empty tree, verified, and leaves the pipeline inputs alone", async () => {
    const dir = repo();
    expect((await run(dir, "--check")).status).toBe(1);
    const r = await run(dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/fetched 3 file\(s\), 0\.0 MiB/);
    expect(r.stderr).not.toMatch(NO_EXIT_CALL);
    expect(readFileSync(join(dir, "public/data/segtiles/10_1.json"), "utf8")).toBe("[[1,2,3]]");
    expect(existsSync(join(dir, "data/raw/cph-buildings.json"))).toBe(false);
    expect((await run(dir, "--check")).status).toBe(0);
    expect((await run(dir, "--all")).status).toBe(0);
    expect(existsSync(join(dir, "data/raw/cph-buildings.json"))).toBe(true);
  });

  it("never overwrites a local file that differs unless told to", async () => {
    const dir = repo();
    await run(dir);
    writeFileSync(join(dir, "public/data/cph-roads.json"), "{}");
    const r = await run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/differ from data\.lock\.json[\s\S]*npm run data:lock/);
    expect(readFileSync(join(dir, "public/data/cph-roads.json"), "utf8")).toBe("{}");
    expect((await run(dir, "--force")).status).toBe(0);
    expect(readFileSync(join(dir, "public/data/cph-roads.json"), "utf8")).toBe(objects["public/data/cph-roads.json"]);
  });

  it("rejects a download whose content does not match the lock, and writes nothing", async () => {
    const dir = repo();
    served.set("/bucket/v1/public/data/segtiles/10_1.json", "[[9,9,9]]");
    try {
      const r = await run(dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/does not match the lock/);
      expect(r.stderr).not.toMatch(NO_EXIT_CALL);
      expect(existsSync(join(dir, "public/data/segtiles/10_1.json"))).toBe(false);
    } finally {
      served.set("/bucket/v1/public/data/segtiles/10_1.json", objects["public/data/segtiles/10_1.json"]);
    }
  });

  it("explains an unpublished version instead of trying the network", async () => {
    const dir = repo({ published: false });
    const r = await run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/has not been published/);
  });

  it("a file missing from the bucket is a clear 404, not a retry loop", async () => {
    const dir = repo();
    mkdirSync(join(dir, "public/data"), { recursive: true });
    served.delete("/bucket/v1/public/data/cph-roads.json");
    try {
      const r = await run(dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/404, not in the bucket/);
      expect(r.stderr).not.toMatch(NO_EXIT_CALL);
    } finally {
      served.set("/bucket/v1/public/data/cph-roads.json", objects["public/data/cph-roads.json"]);
    }
  });
});
