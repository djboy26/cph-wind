// scripts/data/lock.mjs
// The data lock: which build of the map data this commit of the code runs on.
//
// data.lock.json (committed) names a version and lists every data file with its size and
// SHA-256. The files live in object storage (Cloudflare R2) under <version>/<path>, the
// path being the file's place in this repo. `npm run data:pull` fetches them, checked
// against the hashes; `npm run data:publish` uploads a rebuilt set and rewrites the lock.
// The version is the first 12 hex digits of the SHA-256 over the sorted "path sha256"
// lines, so the same files always make the same version and any change makes a new one.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const LOCK_PATH = "data.lock.json";
/** What the app fetches, served from its own origin as /data/... (and deployed). */
export const APP_DIR = "public/data";
/** Pipeline inputs: published with each version so a build can be reproduced, never deployed. */
export const PIPELINE_FILES = ["data/raw/cph-buildings.json"];
/** Intermediates the pipeline regenerates in seconds; never locked or published. */
const SKIP = new Set(["public/data/cph-segments.json"]);

export const isAppFile = (path) => path.startsWith(APP_DIR + "/");

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path).on("error", reject).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex")));
  });
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** Hash the data in the working tree: everything under APP_DIR plus the pipeline inputs. */
export async function scanLocal({ root = "." } = {}) {
  const toRepoPath = (p) => relative(root, p).split(sep).join("/");
  const paths = (await walk(join(root, APP_DIR)).catch(() => [])).map(toRepoPath);
  const stale = paths.filter((p) => SKIP.has(p));
  for (const p of stale) console.warn(`warning: ${p} is a stale pipeline intermediate (it now lives in data/raw/); delete it. Not locked.`);
  const files = {};
  for (const p of [...paths.filter((q) => !SKIP.has(q)), ...PIPELINE_FILES].sort()) {
    const full = join(root, p);
    const s = await stat(full).catch(() => null);
    if (!s) throw new Error(`${p} is missing; run npm run data:rebuild (or npm run data:pull -- --all) first.`);
    files[p] = { bytes: s.size, sha256: await sha256File(full) };
  }
  return files;
}

export function versionOf(files) {
  const lines = Object.keys(files).sort().map((p) => `${p} ${files[p].sha256}\n`).join("");
  return createHash("sha256").update(lines).digest("hex").slice(0, 12);
}

export async function readLock(root = ".") {
  return JSON.parse(await readFile(join(root, LOCK_PATH), "utf8"));
}

export async function writeLock(lock, root = ".") {
  const files = Object.fromEntries(Object.keys(lock.files).sort().map((p) => [p, lock.files[p]]));
  const body = {
    $comment: "Which build of the map data this code runs on. Written by npm run data:publish (or data:lock); read by npm run data:pull. Do not edit by hand.",
    version: lock.version,
    origin: lock.origin ?? null,
    publishedAt: lock.publishedAt ?? null,
    files,
  };
  await writeFile(join(root, LOCK_PATH), JSON.stringify(body, null, 2) + "\n");
}

/** Bytes in binary megabytes, "64.3 MiB" (the unit du -h and most file browsers use). */
export const mb = (n) => `${(n / 1048576).toFixed(1)} MiB`;
