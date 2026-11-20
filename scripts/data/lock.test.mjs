// scripts/data/lock.test.mjs
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanLocal, versionOf, isAppFile } from "./lock.mjs";

const f = (sha256, bytes = 1) => ({ bytes, sha256 });

describe("versionOf", () => {
  it("depends on the files, not on their order", () => {
    const a = { "public/data/a.json": f("1"), "public/data/b.json": f("2") };
    const b = { "public/data/b.json": f("2"), "public/data/a.json": f("1") };
    expect(versionOf(a)).toBe(versionOf(b));
    expect(versionOf(a)).toMatch(/^[0-9a-f]{12}$/);
  });
  it("changes when any file's content does", () => {
    const a = { "public/data/a.json": f("1"), "public/data/b.json": f("2") };
    expect(versionOf({ ...a, "public/data/b.json": f("3") })).not.toBe(versionOf(a));
  });
});

describe("scanLocal", () => {
  it("hashes public/data and the pipeline inputs, skipping dotfiles and the stale intermediate", async () => {
    const root = mkdtempSync(join(tmpdir(), "lock-"));
    mkdirSync(join(root, "public/data/segtiles"), { recursive: true });
    mkdirSync(join(root, "data/raw"), { recursive: true });
    writeFileSync(join(root, "public/data/segtiles/10_1.json"), "[]");
    writeFileSync(join(root, "public/data/cph-roads.json"), "{}");
    writeFileSync(join(root, "public/data/.DS_Store"), "x");
    writeFileSync(join(root, "public/data/cph-segments.json"), "[]");
    writeFileSync(join(root, "data/raw/cph-buildings.json"), "{}");
    const files = await scanLocal({ root });
    expect(Object.keys(files)).toEqual(["data/raw/cph-buildings.json", "public/data/cph-roads.json", "public/data/segtiles/10_1.json"]);
    expect(files["public/data/segtiles/10_1.json"]).toEqual({ bytes: 2, sha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945" });
    expect(Object.keys(files).filter(isAppFile)).toHaveLength(2);
  });
});
