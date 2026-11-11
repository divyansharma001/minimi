// Decides which links the agent may open.
//
// The agent runs on the user's machine, so a page it fetches can reach things
// a website never could: the user's router, other apps on localhost, or a
// cloud metadata address. A page can also try to trick the model into
// "opening" a link that carries the user's data to someone else. Three rules
// stop both:
//
// 1. Only public web addresses: http or https, ports 80 and 443, no
//    localhost, no private or reserved IP ranges. The safe fetcher checks the
//    address again after DNS lookup, so a public name pointing at a private
//    address is caught too.
// 2. A link the agent already knows is fine: it came from search results, the
//    user's own message, a page already read, or an old answer's sources.
// 3. A link the model made up itself must have no query string, so it cannot
//    carry data out in "?q=...".

import { BlockList, isIP } from "node:net";

// Private, loopback, link-local and other non-public ranges.
const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["64:ff9b::", 96], // IPv6-to-IPv4 translation: can reach private IPv4 behind it
  ["100::", 64],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, "ipv6");
}

const PRIVATE_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa)$/i;

/** True only for addresses on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  // An IPv6 address that wraps an IPv4 one, like ::ffff:127.0.0.1.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) return !NOT_PUBLIC.check(mapped[1], "ipv4");
  return !NOT_PUBLIC.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** Why a URL may not be opened at all, or null if it may. */
export function urlProblem(url: URL): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return `${url.protocol} links are not allowed`;
  if (url.username || url.password) return "links with a user name or password are not allowed";
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return `port ${url.port} is not allowed`;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) return isPublicAddress(host) ? null : `${host} is not a public address`;
  if (!host.includes(".")) return `${host} is not a public web address`;
  if (PRIVATE_NAMES.test(host)) return `${host} is a private network name`;
  return null;
}

/** The same page written two ways counts as one link. */
export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_|^(gclid|fbclid|mc_eid|ref)$/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

export type GateDecision = { ok: true; url: string } | { ok: false; reason: string };

export class LinkGate {
  private readonly known = new Set<string>();

  /** Marks links that came from search results, the user, pages read, or old sources. */
  remember(urls: Iterable<string>): void {
    for (const raw of urls) {
      try {
        this.known.add(normalizeUrl(raw));
      } catch {
        // Not a valid URL: nothing to remember.
      }
    }
  }

  isKnown(raw: string): boolean {
    try {
      return this.known.has(normalizeUrl(raw));
    } catch {
      return false;
    }
  }

  /** May the agent open this link? `fromModel` means the model wrote it itself. */
  check(raw: string, fromModel: boolean): GateDecision {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      return { ok: false, reason: "not a valid link" };
    }
    const problem = urlProblem(url);
    if (problem) return { ok: false, reason: problem };
    const normal = normalizeUrl(url.toString());
    if (fromModel && !this.known.has(normal) && url.search !== "") {
      return { ok: false, reason: "a new link with a query string could carry data out, so it was not opened" };
    }
    return { ok: true, url: normal };
  }
}
