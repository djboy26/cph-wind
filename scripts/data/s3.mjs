// scripts/data/s3.mjs
// The two S3 calls data:publish needs (HEAD and PUT an object), signed with AWS Signature
// Version 4 using node:crypto only. Cloudflare R2 speaks the S3 API at
// https://<account id>.r2.cloudflarestorage.com with region "auto".
//
// signV4 is the general algorithm and is checked against AWS's published test vectors
// (src/data/s3.test.ts); the S3 specifics are the path-style URL, the payload hash header
// and keys encoded once per path segment.
import { createHash, createHmac } from "node:crypto";

const sha256hex = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
export const EMPTY_SHA256 = sha256hex("");

/** RFC 3986 percent-encoding, as SigV4 requires (encodeURIComponent leaves !'()* alone). */
export function encodeRfc3986(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** 20130524T000000Z */
export function amzDate(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Sign a request. `headers` must include host and x-amz-date; every header given is signed.
 * `path` is the already-encoded canonical URI. Returns the Authorization header value and
 * the intermediate strings (for tests).
 */
export function signV4({ method, path, query = "", headers, payloadHash, region, service, accessKeyId, secretAccessKey }) {
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const datetime = lower["x-amz-date"];
  const date = datetime.slice(0, 8);
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", datetime, scope, sha256hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, date), region), service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    signature, canonicalRequest, stringToSign,
  };
}

/** A client for one bucket. endpoint: https://<account id>.r2.cloudflarestorage.com */
export function s3Client({ endpoint, bucket, accessKeyId, secretAccessKey, region = "auto", fetchImpl = fetch }) {
  const base = new URL(endpoint);
  const objectPath = (key) => `/${encodeRfc3986(bucket)}/${key.split("/").map(encodeRfc3986).join("/")}`;

  // `headers` are signed; `unsigned` are sent as they are. Content-Type goes unsigned, as in
  // aws4fetch (the client Cloudflare documents for R2), so the two produce identical requests.
  async function send(method, key, { body, headers = {}, unsigned = {}, signal } = {}) {
    const path = objectPath(key);
    const payloadHash = body ? sha256hex(body) : EMPTY_SHA256;
    const signed = { host: base.host, "x-amz-date": amzDate(), "x-amz-content-sha256": payloadHash, ...headers };
    const { authorization } = signV4({ method, path, headers: signed, payloadHash, region, service: "s3", accessKeyId, secretAccessKey });
    const { host: _host, ...sent } = signed; // fetch sets Host itself
    return fetchImpl(new URL(path, base), { method, body, headers: { ...unsigned, ...sent, authorization }, signal });
  }

  return {
    /** The object's size and metadata, or null when it does not exist. */
    async head(key, { signal } = {}) {
      const r = await send("HEAD", key, { signal });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HEAD ${key}: ${r.status} ${r.statusText}`);
      return { bytes: Number(r.headers.get("content-length")), sha256: r.headers.get("x-amz-meta-sha256") };
    },
    async put(key, body, { contentType, cacheControl, sha256, signal }) {
      const headers = { "x-amz-meta-sha256": sha256 };
      if (cacheControl) headers["cache-control"] = cacheControl;
      const r = await send("PUT", key, { body, headers, unsigned: { "content-type": contentType }, signal });
      if (!r.ok) throw new Error(`PUT ${key}: ${r.status} ${r.statusText} ${(await r.text()).slice(0, 300)}`);
    },
  };
}
