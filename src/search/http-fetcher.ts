// Downloads web pages safely.
//
// Uses Node's own http/https client rather than fetch(), for one reason: the
// address check runs inside the DNS lookup of the real connection. So the
// address that was checked is the one connected to. Checking first and
// connecting later would let a site switch its DNS in between ("DNS
// rebinding") and reach the user's own network.
//
// Every redirect is checked again, pages are size-capped and time-limited,
// and only text pages are read.

import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import { isPublicAddress, urlProblem } from "./link-gate.ts";
import { FetchError, type PageFetcher, type RawPage } from "./types.ts";

const TEXT_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain|text\/markdown)\b/i;

export type HttpFetcherOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
  /** Tests replace these to talk to a local server. The app never does. */
  checkUrl?: (url: URL) => string | null;
  checkAddress?: (address: string) => boolean;
};

export class HttpFetcher implements PageFetcher {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;
  private readonly userAgent: string;
  private readonly checkUrl: (url: URL) => string | null;
  private readonly checkAddress: (address: string) => boolean;

  constructor(options: HttpFetcherOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxBytes = options.maxBytes ?? 3_000_000;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.userAgent = options.userAgent ?? "minimi/0.1 (chat agent; reads pages to cite them)";
    this.checkUrl = options.checkUrl ?? urlProblem;
    this.checkAddress = options.checkAddress ?? isPublicAddress;
  }

  async fetch(rawUrl: string): Promise<RawPage> {
    let url = new URL(rawUrl);
    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      const problem = this.checkUrl(url);
      if (problem) throw new FetchError("blocked", problem);
      const response = await this.request(url);
      if (response.location === undefined) return { ...response.page, url: rawUrl };
      url = new URL(response.location, url);
    }
    throw new FetchError("http-error", `more than ${this.maxRedirects} redirects`);
  }

  private request(url: URL): Promise<{ location?: string; page: RawPage }> {
    const client = url.protocol === "https:" ? https : http;
    const checkAddress = this.checkAddress;

    // Runs for the real connection. Refuses if any address for the name is
    // not public, so a name with one public and one private address fails.
    const safeLookup = (
      hostname: string,
      options: { all?: boolean; family?: number | string },
      callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void,
    ) => {
      const family = options.family === 6 || options.family === "IPv6" ? 6 : options.family === 4 || options.family === "IPv4" ? 4 : 0;
      dnsLookup(hostname, { all: true, family }, (error: NodeJS.ErrnoException | null, list: LookupAddress[]) => {
        if (error) return callback(error, []);
        const bad = list.find((a) => !checkAddress(a.address));
        if (bad || list.length === 0) {
          return callback(new FetchError("blocked", `${hostname} points to a non-public address`), []);
        }
        if (options.all) return callback(null, list);
        const first = list[0] as LookupAddress;
        return callback(null, first.address, first.family);
      });
    };

    return new Promise((resolve, reject) => {
      const request = client.request(
        url,
        {
          method: "GET",
          lookup: safeLookup as unknown as http.RequestOptions["lookup"],
          headers: {
            "user-agent": this.userAgent,
            accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
            "accept-encoding": "gzip, deflate, br",
            "accept-language": "en",
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const location = response.headers.location;
          if (status >= 300 && status < 400 && location) {
            response.resume();
            resolve({ location, page: emptyPage(url, status) });
            return;
          }
          const contentType = String(response.headers["content-type"] ?? "");
          if (!TEXT_TYPES.test(contentType)) {
            response.resume();
            reject(new FetchError("not-text", `the page is ${contentType || "of an unknown type"}, not text`));
            return;
          }
          readBody(response, String(response.headers["content-encoding"] ?? ""), this.maxBytes)
            .then((bytes) => {
              const body = decode(bytes, contentType);
              resolve({ page: { url: url.toString(), finalUrl: url.toString(), status, contentType, body } });
            })
            .catch(reject);
        },
      );
      request.setTimeout(this.timeoutMs, () => {
        request.destroy(new FetchError("timeout", `no answer within ${this.timeoutMs / 1000} seconds`));
      });
      request.on("error", (error) => {
        reject(error instanceof FetchError ? error : new FetchError("network", error.message));
      });
      request.end();
    });
  }
}

function emptyPage(url: URL, status: number): RawPage {
  return { url: url.toString(), finalUrl: url.toString(), status, contentType: "", body: "" };
}

function readBody(stream: Readable, encoding: string, maxBytes: number): Promise<Buffer> {
  const decoded =
    encoding === "gzip"
      ? stream.pipe(createGunzip())
      : encoding === "deflate"
        ? stream.pipe(createInflate())
        : encoding === "br"
          ? stream.pipe(createBrotliDecompress())
          : stream;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    decoded.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        stream.destroy();
        decoded.destroy();
        reject(new FetchError("too-large", `the page is over ${Math.round(maxBytes / 1_000_000)} MB`));
        return;
      }
      chunks.push(chunk);
    });
    decoded.on("end", () => resolve(Buffer.concat(chunks)));
    decoded.on("error", (error) => reject(new FetchError("network", error.message)));
  });
}

function decode(bytes: Buffer, contentType: string): string {
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/"/g, "") ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
