import { test } from "node:test";
import assert from "node:assert/strict";
import { LinkGate, isPublicAddress, normalizeUrl, urlProblem } from "./link-gate.ts";

const problem = (raw: string) => urlProblem(new URL(raw));

test("public web pages are allowed", () => {
  assert.equal(problem("https://neon.com/pricing"), null);
  assert.equal(problem("http://example.com:80/"), null);
  assert.equal(problem("https://93.184.216.34/"), null);
});

test("anything on the user's own machine or network is blocked", () => {
  for (const raw of [
    "http://localhost:3000/",
    "http://127.0.0.1/",
    "http://127.10.0.1/",
    "http://0.0.0.0/",
    "http://10.0.0.5/",
    "http://172.16.4.2/",
    "http://192.168.1.1/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://router/",
    "http://printer.local/",
    "http://wiki.internal/",
  ]) {
    assert.ok(problem(raw), `should block ${raw}`);
  }
});

test("other schemes, odd ports and embedded passwords are blocked", () => {
  assert.match(problem("file:///etc/passwd") ?? "", /not allowed/);
  assert.match(problem("ftp://example.com/") ?? "", /not allowed/);
  assert.match(problem("https://example.com:8443/") ?? "", /port 8443/);
  assert.match(problem("https://user:pass@example.com/") ?? "", /password/);
});

test("address checks cover IPv4, IPv6 and IPv4 wrapped in IPv6", () => {
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicAddress("10.1.2.3"), false);
  assert.equal(isPublicAddress("::ffff:192.168.0.1"), false);
  assert.equal(isPublicAddress("fe80::1"), false);
  assert.equal(isPublicAddress("::ffff:7f00:1"), false, "127.0.0.1 written in hex inside IPv6");
  assert.equal(isPublicAddress("64:ff9b::7f00:1"), false, "127.0.0.1 behind IPv6-to-IPv4 translation");
  assert.equal(isPublicAddress("not-an-ip"), false);
});

test("the same page written two ways is one link", () => {
  assert.equal(
    normalizeUrl("https://Neon.com/pricing?utm_source=x&plan=pro#faq"),
    "https://neon.com/pricing?plan=pro",
  );
});

test("a link the model made up may not carry a query string", () => {
  const gate = new LinkGate();
  assert.equal(gate.check("https://basalt.example/pricing", true).ok, true);
  const leak = gate.check("https://attacker.example/collect?data=user-secret", true);
  assert.equal(leak.ok, false);
  assert.match(leak.ok ? "" : leak.reason, /query string/);
});

test("a known link may have a query string, whoever asks to open it", () => {
  const gate = new LinkGate();
  gate.remember(["https://shop.example/item?id=42&utm_source=search"]);
  assert.equal(gate.check("https://shop.example/item?id=42", true).ok, true);
  assert.equal(gate.check("https://shop.example/item?id=43", true).ok, false);
});

test("a known link is still blocked if it points somewhere private", () => {
  const gate = new LinkGate();
  gate.remember(["http://192.168.1.1/?page=admin"]);
  assert.equal(gate.check("http://192.168.1.1/?page=admin", false).ok, false);
});
