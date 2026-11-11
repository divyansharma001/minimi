// Tests against a real local HTTP server. The fetcher's safety checks are
// swapped for ones that allow 127.0.0.1, so the mechanics can be tested; the
// last tests prove the real checks block that same server.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { HttpFetcher } from "./http-fetcher.ts";
import { urlProblem } from "./link-gate.ts";
import { FetchError } from "./types.ts";

let server: http.Server;
let base: string;

before(async () => {
  server = http.createServer((req, res) => {
    switch (req.url) {
      case "/page":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<h1>Pricing</h1><p>Pro: $69 / month</p>");
        break;
      case "/gzip":
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        res.end(gzipSync("<p>compressed page</p>"));
        break;
      case "/latin1":
        res.writeHead(200, { "content-type": "text/plain; charset=iso-8859-1" });
        res.end(Buffer.from([0x43, 0x61, 0x66, 0xe9])); // "Café" in Latin-1
        break;
      case "/redirect":
        res.writeHead(302, { location: "/page" });
        res.end();
        break;
      case "/redirect-to-metadata":
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
        break;
      case "/loop":
        res.writeHead(302, { location: "/loop" });
        res.end();
        break;
      case "/pdf":
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end("%PDF-1.7");
        break;
      case "/huge":
        res.writeHead(200, { "content-type": "text/html" });
        res.end("x".repeat(50_000));
        break;
      case "/slow":
        setTimeout(() => res.end("late"), 2_000);
        break;
      default:
        res.writeHead(404, { "content-type": "text/html" });
        res.end("<h1>Not found</h1>");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

// Allows only our local server; everything else gets the real URL rules.
const localOnly = new HttpFetcher({
  checkUrl: (url) => (url.hostname === "127.0.0.1" ? null : urlProblem(url)),
  checkAddress: () => true,
  maxBytes: 10_000,
  timeoutMs: 300,
});

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof FetchError, `expected a FetchError, got ${String(error)}`);
    return error.reason;
  }
  assert.fail("expected the fetch to fail");
}

test("reads a page", async () => {
  const page = await localOnly.fetch(`${base}/page`);
  assert.equal(page.status, 200);
  assert.match(page.body, /Pro: \$69/);
});

test("follows a redirect and reports where the page really came from", async () => {
  const page = await localOnly.fetch(`${base}/redirect`);
  assert.equal(page.url, `${base}/redirect`);
  assert.equal(page.finalUrl, `${base}/page`);
});

test("unpacks compressed pages and reads the declared character set", async () => {
  assert.match((await localOnly.fetch(`${base}/gzip`)).body, /compressed page/);
  assert.equal((await localOnly.fetch(`${base}/latin1`)).body, "Café");
});

test("a redirect to a private address is blocked, even from an allowed page", async () => {
  assert.equal(await failure(localOnly.fetch(`${base}/redirect-to-metadata`)), "blocked");
});

test("redirect loops, non-text files, huge pages and slow servers all fail cleanly", async () => {
  assert.equal(await failure(localOnly.fetch(`${base}/loop`)), "http-error");
  assert.equal(await failure(localOnly.fetch(`${base}/pdf`)), "not-text");
  assert.equal(await failure(localOnly.fetch(`${base}/huge`)), "too-large");
  assert.equal(await failure(localOnly.fetch(`${base}/slow`)), "timeout");
});

test("a missing page comes back with its status, for the caller to judge", async () => {
  assert.equal((await localOnly.fetch(`${base}/nothing-here`)).status, 404);
});

test("with the real safety checks, the same local server is blocked", async () => {
  const real = new HttpFetcher();
  assert.equal(await failure(real.fetch(`${base}/page`)), "blocked");
  assert.equal(await failure(real.fetch("http://localhost/")), "blocked");
});

test("a public-looking name that resolves to a private address is blocked at connect time", async () => {
  // The URL rules pass (it is a normal name), but DNS says 127.0.0.1.
  const fetcher = new HttpFetcher({ checkUrl: () => null });
  assert.equal(await failure(fetcher.fetch(`http://localhost.:${new URL(base).port}/page`)), "blocked");
});
