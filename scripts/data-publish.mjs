// scripts/data-publish.mjs — record the map data in the working tree as a version, and publish it.
//
//   npm run data:lock       hash the local data into data.lock.json; uploads nothing
//   npm run data:publish    upload it to R2 under <version>/ and record the version, the
//                           public URL and the date in data.lock.json; commit that file
//
// The order after a rebuild: npm run data:rebuild, npm run data:validate, npm run data:publish,
// commit data.lock.json. Uploads are idempotent: an object already in the bucket with the
// same SHA-256 is skipped, so an interrupted publish is simply run again.
//
// data:publish reads its credentials from .r2.local in the repo root (gitignored, never
// committed), one KEY=value per line:
//   R2_ACCOUNT_ID         Cloudflare account id (the S3 endpoint is https://<id>.r2.cloudflarestorage.com)
//   R2_ACCESS_KEY_ID      from an R2 API token with Object Read & Write on the bucket
//   R2_SECRET_ACCESS_KEY  the same token's secret
//   R2_BUCKET             the bucket name, e.g. cph-wind-data
//   R2_PUBLIC_URL         the bucket's public URL, e.g. https://pub-<hash>.r2.dev
// R2_ENDPOINT may override the endpoint (tests point it at a local S3 server).
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { scanLocal, versionOf, readLock, writeLock, mb } from "./data/lock.mjs";
import { s3Client } from "./data/s3.mjs";

const LOCK_ONLY = process.argv.includes("--lock-only");
const CONCURRENCY = 6;

const files = await scanLocal();
const version = versionOf(files);
const total = Object.values(files).reduce((n, f) => n + f.bytes, 0);
const prev = await readLock().catch(() => null);

if (LOCK_ONLY) {
  const same = prev && prev.version === version;
  await writeLock({ version, origin: prev?.origin ?? null, publishedAt: same ? prev.publishedAt : null, files });
  console.log(`data: data.lock.json records version ${version}, ${Object.keys(files).length} files, ${mb(total)}.`);
  if (!same) console.log(`It is a new version, not published yet: until npm run data:publish uploads it, only a checkout that already has these files can build.`);
  process.exit(0);
}

const env = process.env;
const need = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL"].filter((k) => !env[k] && !(k === "R2_ACCOUNT_ID" && env.R2_ENDPOINT));
if (need.length) {
  console.error(`data:publish needs ${need.join(", ")} in .r2.local (see the top of scripts/data-publish.mjs).`);
  process.exit(1);
}
const endpoint = env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const publicUrl = env.R2_PUBLIC_URL.replace(/\/+$/, "");
const s3 = s3Client({ endpoint, bucket: env.R2_BUCKET, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY });

const t0 = Date.now();
let uploaded = 0, skipped = 0, upBytes = 0;
const queue = Object.keys(files);
const controller = new AbortController();
const signal = controller.signal;
let failure = null;
async function worker() {
  while (queue.length && !failure) {
    const p = queue.shift();
    const f = files[p];
    const key = `${version}/${p}`;
    try {
      const head = await s3.head(key, { signal });
      if (head && head.bytes === f.bytes && head.sha256 === f.sha256) { skipped++; continue; }
      const body = await readFile(p);
      await s3.put(key, body, {
        contentType: p.endsWith(".json") ? "application/json" : "application/octet-stream",
        cacheControl: "public, max-age=31536000, immutable",
        sha256: f.sha256,
        signal,
      });
      uploaded++; upBytes += f.bytes;
      if (uploaded % 20 === 0) console.log(`  … ${uploaded} uploaded`);
    } catch (e) {
      if (!failure) { failure = e; controller.abort(); }
      return;
    }
  }
}

// Same rule as data-pull.mjs: wait for every request to settle and end with exitCode set,
// never process.exit() with requests still open (on Windows that aborts with 0xC0000409).
async function publish() {
  await Promise.allSettled(Array.from({ length: CONCURRENCY }, worker));
  if (failure) {
    console.error(`data:publish failed: ${failure.message}\nNothing was recorded; run it again (uploads already done are skipped).`);
    return 1;
  }
  // The public URL must serve what was uploaded, or every clean checkout fails to build.
  const probe = Object.keys(files).find((p) => p.endsWith("segtiles/index.json")) ?? Object.keys(files)[0];
  const r = await fetch(`${publicUrl}/${version}/${probe}`).catch((e) => ({ ok: false, status: e.message }));
  const sha = r.ok ? createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex") : null;
  if (sha !== files[probe].sha256) {
    console.error(`data:publish: uploaded, but ${publicUrl}/${version}/${probe} is not publicly readable (${r.status ?? "content differs"}).`);
    console.error(`Turn on the bucket's public URL (R2 > bucket > Settings > Public access) and put it in R2_PUBLIC_URL. data.lock.json is unchanged.`);
    return 1;
  }
  await writeLock({ version, origin: publicUrl, publishedAt: new Date().toISOString().slice(0, 10), files });
  console.log(`data: published version ${version}: ${uploaded} uploaded (${mb(upBytes)}), ${skipped} already there, in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
  console.log(`data.lock.json now points at ${publicUrl}/${version}/. Commit it.`);
  return 0;
}
process.exitCode = await publish();
