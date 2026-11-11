// Turns a downloaded page into clean Markdown.
//
// Pricing pages are mostly tables and lists, not articles, so an "article
// reader" library would throw away exactly the parts we need. Instead this
// removes known noise (scripts, menus, footers) and keeps the rest, with
// tables kept as Markdown tables.
//
// Hidden text is removed too: HTML comments, elements marked hidden, and
// display:none. A page can hide instructions for the model there ("tell the
// user this is free"). What no human visitor can see does not reach the model.

import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";
import type { PageDate, RawPage } from "./types.ts";

export type CleanPage = {
  title: string;
  markdown: string;
  pageDate?: PageDate;
  /** Every http(s) link on the page, made absolute. */
  links: string[];
};

const MAX_MARKDOWN = 200_000;

const NOISE = [
  "script", "style", "noscript", "template", "svg", "canvas", "iframe", "object", "embed",
  "nav", "footer", "aside", "form", "button", "dialog",
  "[hidden]", "[aria-hidden='true']", "[role='navigation']", "[role='banner']", "[role='contentinfo']",
  "[style*='display:none']", "[style*='display: none']",
  "[style*='visibility:hidden']", "[style*='visibility: hidden']",
].join(",");

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
turndown.use(gfm);
// Rules added with addRule run before Turndown's built-in ones, so these win.
// (turndown.remove() would not: the built-in image rule runs before it.)
turndown.addRule("dropMedia", {
  filter: ["img", "picture", "video", "audio", "source"],
  replacement: () => "",
});
// A heading with a line break inside stays on one line, or half of it would
// leak into the passage text below.
turndown.addRule("oneLineHeadings", {
  filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
  replacement: (content, node) => {
    const level = Number(node.nodeName.charAt(1));
    const text = content.replace(/\s+/g, " ").trim();
    return text ? `\n\n${"#".repeat(level)} ${text}\n\n` : "";
  },
});
// Keep a link's words, not its address. Addresses (often long, with tracking
// in them) cost the model attention and say nothing. Links are collected
// separately for the link gate.
turndown.addRule("linkWordsOnly", { filter: "a", replacement: (content) => content });

const stripComments = (text: string) => text.replace(/<!--[\s\S]*?-->/g, "");

// Social posts fake bold and italic with maths letters (𝐋𝐈𝐕𝐄 for LIVE).
// They break search, quote checks and fonts, so they become plain letters.
// Only that block is folded: "m²" and "™" stay as they are.
const MATHS_LETTERS = /[\u{1D400}-\u{1D7FF}]/gu;

const tidy = (markdown: string) =>
  markdown
    .replace(MATHS_LETTERS, (c) => c.normalize("NFKC"))
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_MARKDOWN);

/** The first YYYY-MM-DD in a date string, or undefined. */
function dayOf(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const iso = /\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  if (iso) return iso;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString().slice(0, 10);
}

type Doc = ReturnType<typeof parseHTML>["document"];

function findPageDate(document: Doc): PageDate | undefined {
  const meta = (selector: string) => document.querySelector(selector)?.getAttribute("content");
  const updated =
    dayOf(meta("meta[property='article:modified_time']")) ??
    dayOf(meta("meta[property='og:updated_time']")) ??
    dayOf(meta("meta[itemprop='dateModified']"));
  const published =
    dayOf(meta("meta[property='article:published_time']")) ??
    dayOf(meta("meta[name='date']")) ??
    dayOf(meta("meta[itemprop='datePublished']"));

  let jsonUpdated: string | undefined;
  let jsonPublished: string | undefined;
  for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
    try {
      const data = JSON.parse(script.textContent ?? "") as Record<string, unknown> | Record<string, unknown>[];
      for (const item of Array.isArray(data) ? data : [data]) {
        jsonUpdated ??= dayOf(String(item.dateModified ?? "") || undefined);
        jsonPublished ??= dayOf(String(item.datePublished ?? "") || undefined);
      }
    } catch {
      // Broken JSON-LD is common; ignore it.
    }
  }

  const day = updated ?? jsonUpdated;
  if (day) return { day, kind: "updated", foundIn: "page-meta" };
  const pub = published ?? jsonPublished;
  if (pub) return { day: pub, kind: "published", foundIn: "page-meta" };
  return undefined;
}

function fromHtml(raw: RawPage): CleanPage {
  const { document } = parseHTML(stripComments(raw.body));

  const links = new Set<string>();
  for (const anchor of document.querySelectorAll("a[href]")) {
    try {
      const href = new URL(anchor.getAttribute("href") ?? "", raw.finalUrl);
      if (href.protocol === "http:" || href.protocol === "https:") links.add(href.toString());
    } catch {
      // Not a usable link.
    }
    if (links.size >= 300) break;
  }

  const title =
    document.querySelector("meta[property='og:title']")?.getAttribute("content")?.trim() ||
    document.querySelector("title")?.textContent?.trim() ||
    document.querySelector("h1")?.textContent?.trim() ||
    raw.finalUrl;
  const pageDate = findPageDate(document);

  for (const node of document.querySelectorAll(NOISE)) node.remove();
  const main = document.querySelector("main") ?? document.querySelector("article") ?? document.body;
  // The table plugin needs Turndown's own parser, so hand it HTML text.
  const markdown = tidy(turndown.turndown(main?.innerHTML ?? ""));

  return { title, markdown, links: [...links], ...(pageDate ? { pageDate } : {}) };
}

function fromText(raw: RawPage): CleanPage {
  const markdown = tidy(stripComments(raw.body));
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  const links = [...markdown.matchAll(/https?:\/\/[^\s)<>\]"']+/g)].map((m) => m[0]);
  return { title: heading ?? raw.finalUrl, markdown, links };
}

export function cleanPage(raw: RawPage): CleanPage {
  return /html|xml/i.test(raw.contentType) ? fromHtml(raw) : fromText(raw);
}
