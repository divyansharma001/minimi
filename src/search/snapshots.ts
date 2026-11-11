// Dated copies of every page the agent read.
//
//   memory/pages/basalt.example/pricing/2026-11-03-9f2c1a7b.md
//
// A copy is never edited or overwritten: a new read on a new day is a new
// file. So "has the price changed since 3 Nov?" compares the 3 Nov copy with
// today's, and the old evidence cannot be lost. Reading the same unchanged
// page twice on one day saves one file, not two (the hash spots it).
//
// The hash is only for spotting duplicates. It is NOT used to decide whether
// a fact changed: pages change small things (banners, footers) on every
// visit, so that is done by checking whether each old quote is still there.

import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fromFile, slug, toFile, writeFileSafely } from "../memory/files.ts";
import type { IsoDate } from "../memory/types.ts";
import type { PageDate } from "./types.ts";

export type Snapshot = {
  id: string;
  url: string;
  finalUrl: string;
  /** The user's calendar day when the page was read. */
  day: IsoDate;
  fetchedAt: string;
  status: number;
  title: string;
  markdown: string;
  hash: string;
  pageDate?: PageDate;
};

export function contentHash(markdown: string): string {
  return createHash("sha256").update(markdown.replace(/\s+/g, " ").trim()).digest("hex");
}

function pathFor(dir: string, url: string, day: IsoDate, hash: string): string {
  const parsed = new URL(url);
  const pagePart = slug(`${parsed.pathname}${parsed.search}`) || "home";
  return join(dir, parsed.hostname, pagePart, `${day}-${hash.slice(0, 8)}.md`);
}

function body(snapshot: Snapshot): string {
  return [
    `<!-- A copy of ${snapshot.url} as read on ${snapshot.day}. Never edited. -->`,
    snapshot.markdown,
  ].join("\n\n");
}

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

export class SnapshotStore {
  private readonly byUrl = new Map<string, Snapshot[]>();
  private readonly byId = new Map<string, Snapshot>();
  private readonly dir: string;

  private constructor(dir: string) {
    this.dir = dir;
  }

  static async open(dir: string): Promise<{ store: SnapshotStore; warnings: string[] }> {
    const store = new SnapshotStore(dir);
    const warnings: string[] = [];
    for (const path of await walk(dir)) {
      try {
        store.index(fromFile<Snapshot>(await readFile(path, "utf8")));
      } catch (error) {
        warnings.push(`Skipped ${path}: ${(error as Error).message}`);
      }
    }
    return { store, warnings };
  }

  /** Every copy of a page, oldest first. */
  history(url: string): readonly Snapshot[] {
    return this.byUrl.get(url) ?? [];
  }

  get(id: string): Snapshot | undefined {
    return this.byId.get(id);
  }

  /** The last copy read on or before a day, if any. */
  on(url: string, day: IsoDate): Snapshot | undefined {
    return this.history(url).filter((s) => s.day <= day).at(-1);
  }

  async save(input: Omit<Snapshot, "id" | "hash">): Promise<Snapshot> {
    const hash = contentHash(input.markdown);
    const sameDay = this.history(input.url).find((s) => s.day === input.day && s.hash === hash);
    if (sameDay) return sameDay;
    const snapshot: Snapshot = { ...input, hash, id: randomUUID().slice(0, 12) };
    this.index(snapshot);
    await writeFileSafely(pathFor(this.dir, input.url, input.day, hash), toFile(snapshot, body(snapshot)));
    return snapshot;
  }

  private index(snapshot: Snapshot) {
    const list = this.byUrl.get(snapshot.url) ?? [];
    list.push(snapshot);
    list.sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
    this.byUrl.set(snapshot.url, list);
    this.byId.set(snapshot.id, snapshot);
  }
}
