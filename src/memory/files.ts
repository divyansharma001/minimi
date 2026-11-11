// How records become files on disk.
//
// Each file has two parts:
// 1. A JSON block between --- lines. This is the data, and the only part read back.
// 2. A Markdown body below it, written from the data, for people to read.
//
// JSON, not YAML, because Node reads it with no extra package and it holds
// lists of claims without guesswork. The body is never parsed, so a chat
// message that happens to contain "## " or "---" cannot break anything.
// (A JSON block cannot contain a line that is exactly "---": strings keep
// their newlines escaped.)

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const FENCE = "---";

export function toFile(data: unknown, body: string): string {
  return `${FENCE}\n${JSON.stringify(data, null, 2)}\n${FENCE}\n\n${body.trimEnd()}\n`;
}

export function fromFile<T>(content: string): T {
  const lines = content.split("\n");
  if (lines[0] !== FENCE) throw new Error("the file does not start with ---");
  const end = lines.indexOf(FENCE, 1);
  if (end === -1) throw new Error("no closing --- after the data block");
  return JSON.parse(lines.slice(1, end).join("\n")) as T;
}

// Writes to the same file run one after another. Two requests saving the same
// chat at once would otherwise race, and the later write could drop a turn.
const queues = new Map<string, Promise<void>>();

/**
 * Writes the whole file or nothing. The content goes to a temporary file
 * first and is then renamed over the old one, so a crash mid-write never
 * leaves half a file behind.
 */
export function writeFileSafely(path: string, content: string): Promise<void> {
  const previous = queues.get(path) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(path), { recursive: true });
      const temp = join(dirname(path), `.${randomUUID()}.tmp`);
      await writeFile(temp, content, "utf8");
      await rename(temp, path);
    });
  queues.set(path, next);
  void next.finally(() => {
    if (queues.get(path) === next) queues.delete(path);
  });
  return next;
}

/** Deletes a file once any write already queued for it has finished. */
export function removeFileSafely(path: string): Promise<void> {
  const previous = queues.get(path) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => rm(path, { force: true }));
  queues.set(path, next);
  void next.finally(() => {
    if (queues.get(path) === next) queues.delete(path);
  });
  return next;
}

/** A short, readable piece of text for a file name. */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "chat"
  );
}
