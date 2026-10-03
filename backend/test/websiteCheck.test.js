import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

/**
 * The website probe may only reach the public internet.
 *
 * It runs inside the server, on a URL a stranger typed into a registration
 * form, so anything it can reach, that stranger can make the server reach.
 * A real server is started on this machine below, and the probe must never
 * get a request through to it — by IP, by name, or any other spelling.
 */

const { isPublicAddress, checkWebsiteReachable } = await import("../src/websiteCheck.js");

let server;
let hits = 0;
let port;

before(async () => {
  server = http.createServer((_req, res) => {
    hits++;
    res.end("internal");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(() => server.close());

test("private, loopback, link-local and reserved addresses are not public", () => {
  for (const ip of [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1",
  ]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test("ordinary public addresses are public", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});

test("a non-address is not public", () => {
  assert.equal(isPublicAddress("localhost"), false);
  assert.equal(isPublicAddress(""), false);
});

test("the probe never reaches a server on this machine by its IP", async () => {
  assert.equal(await checkWebsiteReachable(`http://127.0.0.1:${port}/`), false);
  assert.equal(hits, 0, "the probe reached a loopback server");
});

test("nor by a name that resolves to it", async () => {
  // Refused inside the connection's own lookup, so a name can't launder it.
  assert.equal(await checkWebsiteReachable(`http://localhost:${port}/`), false);
  assert.equal(hits, 0, "the probe reached a loopback server through 'localhost'");
});

test("nor by an IPv4 address written as IPv6", async () => {
  assert.equal(await checkWebsiteReachable(`http://[::ffff:127.0.0.1]:${port}/`), false);
  assert.equal(hits, 0);
});

test("the cloud metadata address is refused outright", async () => {
  assert.equal(await checkWebsiteReachable("http://169.254.169.254/latest/meta-data/"), false);
});

test("no website means nothing to check", async () => {
  assert.equal(await checkWebsiteReachable(""), null);
});
