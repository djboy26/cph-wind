// scripts/data-pull.mjs — put the map data pinned in data.lock.json into the working tree.
//
//   npm run data:pull               the app's data (public/data/), downloading only what is missing
//   npm run data:pull -- --all      also the pipeline inputs (data/raw/)
//   npm run data:pull -- --check    no network: exit 1 if anything is missing or differs (npm test runs this)
//   npm run data:pull -- --force    also replace local files that differ from the lock
//
// Every file is checked against its SHA-256 in the lock, so a pull either produces exactly
// the locked data or fails. A local file that differs from the lock is never overwritten
// without --force: it is usually data you rebuilt on purpose (record it with npm run data:lock).
// Runs before `npm run build` and `npm run dev`, so Vercel and CI fetch the data themselves.
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { readLock, sha256File, isAppFile, mb } from "./data/lock.mjs";

const args = new Set(process.argv.slice(2));
const CHECK = args.has("--check"), ALL = args.has("--all"), FORCE = args.has("--force");
const CONCURRENCY = 8;

const lock = await readLock();
const wanted = Object.entries(lock.files).filter(([p]) => ALL || isAppFile(p));

// 1. What is already right, what is missing, what differs.
const missing = [], differ = [];
let okBytes = 0;
for (const [p, f] of wanted) {
  const s = await stat(p).catch(() => null);
  if (!s) { missing.push(p); continue; }
  if (s.size === f.bytes && (await sha256File(p)) === f.sha256) { okBytes += f.bytes; continue; }
  differ.push(p);
}

const list = (xs) => xs.slice(0, 8).map((x) => `  ${x}`).join("\n") + (xs.length > 8 ? `\n  … and ${xs.length - 8} more` : "");

if (CHECK) {
  if (!missing.length && !differ.length) {
    console.log(`data: ${wanted.length} files match data.lock.json (version ${lock.version}, ${mb(okBytes)}).`);
    process.exit(0);
  }
  console.error(`data: the working tree does not match data.lock.json (version ${lock.version}).`);
  if (missing.length) console.error(`${missing.length} missing:\n${list(missing)}`);
  if (differ.length) console.error(`${differ.length} differ from the lock:\n${list(differ)}`);
  console.error(`\nFetch the locked data:  npm run data:pull`);
  if (differ.length) console.error(`Rebuilt the data on purpose? Record it:  npm run data:lock  (then npm run data:publish before you push)`);
  process.exit(1);
}

if (differ.length && !FORCE) {
  console.error(`data: ${differ.length} local file(s) differ from data.lock.json (version ${lock.version}):\n${list(differ)}`);
  console.error(`\nIf you rebuilt the data on purpose, record it:  npm run data:lock`);
  console.error(`To throw the local files away and take the locked ones:  npm run data:pull -- --force`);
  process.exit(1);
}

const todo = [...missing, ...(FORCE ? differ : [])];
if (!todo.length) {
  console.log(`data: ${wanted.length} files already match data.lock.json (version ${lock.version}, ${mb(okBytes)}).`);
  process.exit(0);
}
if (!lock.origin || !lock.publishedAt) {
  console.error(`data: ${todo.length} file(s) are missing, but version ${lock.version} in data.lock.json has not been published, so there is nowhere to fetch them from.`);
  console.error(`Whoever rebuilt the data runs  npm run data:publish  and commits data.lock.json.\n${list(todo)}`);
  process.exit(1);
}

// 2. Download, verify, then move into place.
const base = lock.origin.replace(/\/+$/, "");
async function fetchVerified(p, signal) {
  const f = lock.files[p];
  const url = `${base}/${lock.version}/${p}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { signal });
      if (r.status === 404) throw Object.assign(new Error(`${url}: 404, not in the bucket (was version ${lock.version} published?)`), { fatal: true });
      if (!r.ok) throw new Error(`${url}: ${r.status} ${r.statusText}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const sha = createHash("sha256").update(buf).digest("hex");
      // A complete response with the wrong content is the bucket's problem, not the network's: no retry.
      if (buf.length !== f.bytes || sha !== f.sha256) throw Object.assign(new Error(`${url}: content does not match the lock (${buf.length} bytes, sha256 ${sha.slice(0, 12)}…)`), { fatal: true });
      await mkdir(dirname(p), { recursive: true });
      const part = `${p}.part`;
      await writeFile(part, buf);
      await rm(p, { force: true });
      await rename(part, p);
      return buf.length;
    } catch (e) {
      if (e.fatal || attempt === 3 || signal.aborted) throw e;
      await sleep(1000 * attempt * attempt, undefined, { signal }); // rejects at once if another worker failed
    }
  }
}

const t0 = Date.now();
let bytes = 0, done = 0;
const queue = [...todo];
const controller = new AbortController();
let failure = null;
async function worker() {
  while (queue.length && !failure) {
    const p = queue.shift();
    try {
      const n = await fetchVerified(p, controller.signal); // not `bytes += await …`: that reads bytes before the await and loses other workers' adds
      bytes += n;
      done++;
    } catch (e) {
      // The first failure stops the others; their aborted requests land here too.
      if (!failure) { failure = e; controller.abort(); }
      return;
    }
  }
}
// allSettled, then let the script end with exitCode set: never process.exit() while requests
// are still open. On Windows, exiting with sockets still closing trips a libuv assertion
// (src\win\async.c) and the process dies with 0xC0000409 instead of exiting 1.
await Promise.allSettled(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
if (failure) {
  console.error(`data: pull failed: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`data: fetched ${done} file(s), ${mb(bytes)} in ${((Date.now() - t0) / 1000).toFixed(1)} s from ${base} (version ${lock.version}); ${wanted.length - done} already matched.`);
}
