// scripts/data/s3.test.mjs
// The SigV4 signer against AWS's published examples, and what the S3 client puts on the wire.
// (Also cross-checked once against aws4fetch, the client Cloudflare documents for R2: the
// Authorization headers for the same PUT and HEAD were byte-identical.)
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { signV4, s3Client, encodeRfc3986, EMPTY_SHA256 } from "./s3.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");

describe("signV4 reproduces AWS's published signatures", () => {
  it("SigV4 test suite: get-vanilla", () => {
    const { signature } = signV4({
      method: "GET", path: "/", headers: { Host: "example.amazonaws.com", "X-Amz-Date": "20150830T123600Z" },
      payloadHash: EMPTY_SHA256, region: "us-east-1", service: "service",
      accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    });
    expect(signature).toBe("5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
  });

  const S3_KEYS = { region: "us-east-1", service: "s3", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };

  it("S3 developer guide: GET Object with a Range header", () => {
    const { signature } = signV4({
      method: "GET", path: "/test.txt", payloadHash: EMPTY_SHA256, ...S3_KEYS,
      headers: { Host: "examplebucket.s3.amazonaws.com", Range: "bytes=0-9", "x-amz-content-sha256": EMPTY_SHA256, "x-amz-date": "20130524T000000Z" },
    });
    expect(signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });

  it("S3 developer guide: PUT Object, key with a $ in it", () => {
    const ph = sha("Welcome to Amazon S3.");
    const { signature } = signV4({
      method: "PUT", path: "/" + encodeRfc3986("test$file.text"), payloadHash: ph, ...S3_KEYS,
      headers: { Host: "examplebucket.s3.amazonaws.com", Date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-date": "20130524T000000Z", "x-amz-storage-class": "REDUCED_REDUNDANCY", "x-amz-content-sha256": ph },
    });
    expect(signature).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });
});

describe("s3Client", () => {
  function capture() {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return new Response(null, { status: 200, headers: { "content-length": "7", "x-amz-meta-sha256": "ab" } }); };
    const client = s3Client({ endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "cph-wind-data", accessKeyId: "AK", secretAccessKey: "SK", fetchImpl });
    return { client, calls };
  }

  it("PUT: path-style URL, payload hash, metadata and cache headers signed, content-type sent unsigned", async () => {
    const { client, calls } = capture();
    const body = Buffer.from("[1,2,3]");
    await client.put("v1/public/data/segtiles/10_1.json", body, { contentType: "application/json", cacheControl: "public, max-age=31536000, immutable", sha256: "f".repeat(64) });
    const { url, init } = calls[0];
    expect(url).toBe("https://acct.r2.cloudflarestorage.com/cph-wind-data/v1/public/data/segtiles/10_1.json");
    expect(init.method).toBe("PUT");
    expect(init.headers["x-amz-content-sha256"]).toBe(sha(body));
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=cache-control;host;x-amz-content-sha256;x-amz-date;x-amz-meta-sha256, Signature=[0-9a-f]{64}$/);
  });

  it("keys are encoded once per segment, slashes kept", async () => {
    const { client, calls } = capture();
    await client.head("v1/a b(1)!.json");
    expect(calls[0].url).toBe("https://acct.r2.cloudflarestorage.com/cph-wind-data/v1/a%20b%281%29%21.json");
    expect(calls[0].init.headers["x-amz-content-sha256"]).toBe(EMPTY_SHA256);
  });

  it("HEAD reads size and the sha256 metadata; 404 is null", async () => {
    const { client } = capture();
    expect(await client.head("k")).toEqual({ bytes: 7, sha256: "ab" });
    const missing = s3Client({ endpoint: "https://x", bucket: "b", accessKeyId: "a", secretAccessKey: "s", fetchImpl: async () => new Response(null, { status: 404 }) });
    expect(await missing.head("k")).toBeNull();
  });
});
