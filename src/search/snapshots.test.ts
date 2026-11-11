import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnapshotStore, contentHash } from "./snapshots.ts";

const tempDir = () => mkdtemp(join(tmpdir(), "minimi-pages-"));

const copy = (day: string, markdown: string) => ({
  url: "https://basalt.example/pricing",
  finalUrl: "https://basalt.example/pricing",
  day,
  fetchedAt: `${day}T10:00:00Z`,
  status: 200,
  title: "Basalt pricing",
  markdown,
});

test("each day's read is its own dated file, and survives a restart", async () => {
  const dir = await tempDir();
  const { store } = await SnapshotStore.open(dir);
  await store.save(copy("2026-11-03", "Pro: $69 / month"));
  await store.save(copy("2026-11-11", "Pro: $79 / month"));

  const files = await readdir(join(dir, "basalt.example", "pricing"));
  assert.equal(files.length, 2);
  assert.ok(files.every((f) => /^2026-11-(03|11)-[0-9a-f]{8}\.md$/.test(f)), files.join(", "));

  const reopened = (await SnapshotStore.open(dir)).store;
  assert.deepEqual(
    reopened.history("https://basalt.example/pricing").map((s) => s.markdown),
    ["Pro: $69 / month", "Pro: $79 / month"],
  );
});

test("the copy 'as of' a day is the last one read on or before it", async () => {
  const { store } = await SnapshotStore.open(await tempDir());
  await store.save(copy("2026-11-03", "Pro: $69 / month"));
  await store.save(copy("2026-11-11", "Pro: $79 / month"));
  assert.equal(store.on("https://basalt.example/pricing", "2026-11-05")?.markdown, "Pro: $69 / month");
  assert.equal(store.on("https://basalt.example/pricing", "2026-11-11")?.markdown, "Pro: $79 / month");
  assert.equal(store.on("https://basalt.example/pricing", "2026-11-01"), undefined);
});

test("reading the same unchanged page twice in a day saves one file", async () => {
  const dir = await tempDir();
  const { store } = await SnapshotStore.open(dir);
  const first = await store.save(copy("2026-11-03", "Pro: $69 / month"));
  const second = await store.save(copy("2026-11-03", "Pro:  $69 /   month"));
  assert.equal(second.id, first.id);
  assert.equal((await readdir(join(dir, "basalt.example", "pricing"))).length, 1);
});

test("the hash ignores spacing only, not content", () => {
  assert.equal(contentHash("a  b\n c"), contentHash("a b c"));
  assert.notEqual(contentHash("Pro: $69"), contentHash("Pro: $79"));
});
