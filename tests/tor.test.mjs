import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import http from "node:http";
import { loadTs } from "./helpers/load-ts.mjs";
import { projectRoot } from "./helpers/search-fixture.mjs";

const ONION = `${"a".repeat(56)}.onion`;
/** v2 addresses were 16 characters and stopped resolving in 2021. */
const ONION_V2 = `${"b".repeat(16)}.onion`;

function load(path) { return loadTs(projectRoot)(path); }

function withEnv(values, run) {
  const prior = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value == null) delete process.env[key]; else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(prior)) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  };
  const result = run();
  return result instanceof Promise ? result.finally(restore) : (restore(), result);
}

/** A SOCKS5 proxy that records what it was asked to reach and then bridges to
 * a local origin, so the whole handshake is exercised without a Tor daemon. */
async function fakeTor(originPort) {
  const seen = [];
  const server = net.createServer((socket) => {
    socket.once("data", () => {
      socket.write(Buffer.from([0x05, 0x00]));
      socket.once("data", (request) => {
        const length = request[4];
        seen.push({
          host: request.subarray(5, 5 + length).toString("utf8"),
          port: request.readUInt16BE(5 + length),
        });
        const upstream = net.connect({ host: "127.0.0.1", port: originPort });
        upstream.once("connect", () => {
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          socket.pipe(upstream);
          upstream.pipe(socket);
        });
        upstream.on("error", () => socket.destroy());
      });
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { seen, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

async function origin(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

test("onion addresses are recognised, and only v3 ones are accepted", () => {
  const { isOnionHost, isValidOnionHost } = load("lib/core/tor.ts");
  assert.equal(isOnionHost(ONION), true);
  assert.equal(isOnionHost(`${ONION}.`), true);
  assert.equal(isOnionHost("example.com"), false);
  assert.equal(isValidOnionHost(ONION), true);
  // Virtual hosts prefix labels onto the address; the address itself decides.
  assert.equal(isValidOnionHost(`www.${ONION}`), true);
  assert.equal(isValidOnionHost(ONION.toUpperCase()), true);
  assert.equal(isValidOnionHost(ONION_V2), false);
  assert.equal(isValidOnionHost("notbase32-address1.onion"), false);
});

test("the proxy is read from TOR_SOCKS_PROXY and nothing else turns Tor on", () => {
  const tor = load("lib/core/tor.ts");
  withEnv({ TOR_SOCKS_PROXY: undefined, TOR_ALL_TRAFFIC: "1" }, () => {
    assert.equal(tor.torAvailable(), false);
    assert.equal(tor.torForAllTraffic(), false, "the flag alone must not route traffic anywhere");
    assert.equal(tor.shouldUseTor(ONION), false);
  });
  withEnv({ TOR_SOCKS_PROXY: "127.0.0.1:9050" }, () => {
    assert.deepEqual(tor.torProxy(), { host: "127.0.0.1", port: 9050, username: undefined, password: undefined });
  });
  withEnv({ TOR_SOCKS_PROXY: "socks5h://user:pa%3Ass@10.0.0.5:9150" }, () => {
    assert.deepEqual(tor.torProxy(), { host: "10.0.0.5", port: 9150, username: "user", password: "pa:ss" });
  });
  withEnv({ TOR_SOCKS_PROXY: "http://127.0.0.1:8118" }, () => assert.equal(tor.torProxy(), null));
  withEnv({ TOR_SOCKS_PROXY: "socks5://127.0.0.1:0" }, () => assert.equal(tor.torProxy(), null));
});

test("only .onion is routed over Tor unless the operator asks for everything", () => {
  const tor = load("lib/core/tor.ts");
  withEnv({ TOR_SOCKS_PROXY: "127.0.0.1:9050", TOR_ALL_TRAFFIC: undefined }, () => {
    assert.equal(tor.shouldUseTor(ONION), true);
    assert.equal(tor.shouldUseTor("example.com"), false);
  });
  withEnv({ TOR_SOCKS_PROXY: "127.0.0.1:9050", TOR_ALL_TRAFFIC: "true" }, () => {
    assert.equal(tor.shouldUseTor("example.com"), true);
  });
});

test("a .onion URL is refused unless Tor is configured, and the rest of the policy still holds", () => {
  const { assertUrlAllowed, isUrlAllowed } = load("lib/core/security.ts");
  withEnv({ TOR_SOCKS_PROXY: undefined }, () => {
    assert.throws(() => assertUrlAllowed(`http://${ONION}/`), (e) => e.code === "blocked_url");
  });
  withEnv({ TOR_SOCKS_PROXY: "127.0.0.1:9050" }, () => {
    assert.equal(assertUrlAllowed(`http://${ONION}/x`).hostname, ONION);
    assert.throws(() => assertUrlAllowed(`http://${ONION_V2}/`), (e) => e.code === "blocked_url");
    // Enabling Tor must not open anything else up.
    assert.equal(isUrlAllowed("http://127.0.0.1/"), false);
    assert.equal(isUrlAllowed("http://localhost/"), false);
    assert.equal(isUrlAllowed("http://169.254.169.254/"), false);
    assert.equal(isUrlAllowed("ftp://example.com/"), false);
    // And the per-key domain policy applies to onion addresses like any other.
    assert.equal(isUrlAllowed(`http://${ONION}/`, { blockedDomains: [ONION] }), false);
    assert.equal(isUrlAllowed(`http://${ONION}/`, { allowedDomains: ["example.com"] }), false);
  });
});

test("an onion fetch reaches the origin through the proxy, resolved by the proxy", async () => {
  const site = await origin((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<h1>hidden</h1><p>${req.headers.host}</p>`);
  });
  const proxy = await fakeTor(site.port);
  try {
    await withEnv({ TOR_SOCKS_PROXY: `socks5://127.0.0.1:${proxy.port}` }, async () => {
      const { safeFetch } = load("lib/core/http.ts");
      const result = await safeFetch(`http://${ONION}/page`, { timeoutMs: 5000 });
      assert.equal(result.status, 200);
      assert.match(result.body, /hidden/);
      // The name went to the proxy verbatim: a .onion must never be resolved
      // locally, and this is what proves it was not.
      assert.deepEqual(proxy.seen, [{ host: ONION, port: 80 }]);
      // The Host header is the onion address, not the bridged origin.
      assert.match(result.body, new RegExp(ONION));
    });
  } finally {
    await proxy.close();
    await site.close();
  }
});

test("the body cap and status handling apply over Tor as well", async () => {
  const site = await origin((_req, res) => { res.writeHead(200); res.end("x".repeat(10_000)); });
  const proxy = await fakeTor(site.port);
  try {
    await withEnv({ TOR_SOCKS_PROXY: `127.0.0.1:${proxy.port}` }, async () => {
      const { safeFetch } = load("lib/core/http.ts");
      const result = await safeFetch(`http://${ONION}/big`, { timeoutMs: 5000, maxBytes: 64 });
      assert.equal(result.bytes, 64);
      assert.equal(result.body, "x".repeat(64));
    });
  } finally {
    await proxy.close();
    await site.close();
  }
});

test("redirects over Tor stay inside one deadline and are still policy-checked", async () => {
  const site = await origin((req, res) => {
    if (req.url === "/start") { res.writeHead(302, { location: "http://127.0.0.1/next" }); res.end(); return; }
    res.writeHead(200); res.end("ok");
  });
  const proxy = await fakeTor(site.port);
  try {
    await withEnv({ TOR_SOCKS_PROXY: `127.0.0.1:${proxy.port}` }, async () => {
      const { safeFetch } = load("lib/core/http.ts");
      // A hidden service redirecting to the deployment's own network is exactly
      // the SSRF this refuses; the redirect target is validated, not followed.
      await assert.rejects(safeFetch(`http://${ONION}/start`, { timeoutMs: 5000 }),
        (error) => error.code === "blocked_url");
    });
  } finally {
    await proxy.close();
    await site.close();
  }
});

test("TOR_ALL_TRAFFIC sends an ordinary host through the proxy too", async () => {
  const site = await origin((_req, res) => { res.writeHead(200); res.end("direct-or-not"); });
  const proxy = await fakeTor(site.port);
  try {
    await withEnv({ TOR_SOCKS_PROXY: `127.0.0.1:${proxy.port}`, TOR_ALL_TRAFFIC: "1" }, async () => {
      const { safeFetch } = load("lib/core/http.ts");
      const result = await safeFetch("http://example.com/x", { timeoutMs: 5000 });
      assert.equal(result.body, "direct-or-not");
      assert.deepEqual(proxy.seen, [{ host: "example.com", port: 80 }]);
    });
  } finally {
    await proxy.close();
    await site.close();
  }
});

test("a refused circuit is a typed failure, not a hang", async () => {
  const dead = net.createServer((socket) => socket.destroy());
  await new Promise((resolve) => dead.listen(0, "127.0.0.1", resolve));
  try {
    await withEnv({ TOR_SOCKS_PROXY: `127.0.0.1:${dead.address().port}` }, async () => {
      const { safeFetch } = load("lib/core/http.ts");
      await assert.rejects(safeFetch(`http://${ONION}/`, { timeoutMs: 3000 }),
        (error) => error.code === "fetch_failed");
    });
  } finally {
    await new Promise((r) => dead.close(r));
  }
});
