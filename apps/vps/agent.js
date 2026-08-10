#!/usr/bin/env node
/**
 * wg-agent — minimal WireGuard provisioning agent
 * Zero dependencies. Node >= 18.
 *
 * Trust model: exactly ONE caller (your Cloudflare Worker), authenticated
 * with a static bearer token over TLS (Caddy terminates TLS in front).
 * Private keys are generated, returned once, and never stored.
 *
 * Endpoints:
 *   GET    /health              → { ok, interface, publicKey, peers }
 *   GET    /peers               → live peer list from `wg show dump`
 *   POST   /peers               → create peer, returns { publicKey, address, conf }
 *   PATCH  /peers/:pubkey       → { "enabled": true|false }
 *   DELETE /peers/:pubkey       → remove peer permanently
 *
 * State file (/var/lib/wg-agent/state.json) holds only public keys and
 * assigned IPs — enough to re-enable a disabled peer or survive a reboot.
 */

const http = require("node:http");
const { execFileSync } = require("node:child_process");
const { timingSafeEqual, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// ---------- configuration (env) ----------
const CFG = {
  token: mustEnv("AGENT_TOKEN"),                       // issued by the Worker, unique to this endpoint
  iface: process.env.WG_INTERFACE || "wg0",
  endpoint: mustEnv("WG_ENDPOINT"),                    // e.g. "paris.yourvpn.com:51820"
  subnet: process.env.WG_SUBNET || "10.8.0.0/24",      // client IP pool
  dns: process.env.WG_DNS || "1.1.1.1, 1.0.0.1",
  listenHost: process.env.LISTEN_HOST || "127.0.0.1",  // Caddy proxies to this
  listenPort: parseInt(process.env.LISTEN_PORT || "8100", 10),
  stateFile: process.env.STATE_FILE || "/var/lib/wg-agent/state.json",
};

function mustEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing required env var ${name}`); process.exit(1); }
  return v;
}

// ---------- tiny helpers ----------
function wg(...args) {
  return execFileSync("wg", args, { encoding: "utf8" }).trim();
}

function persistInterface() {
  // Write kernel state back to /etc/wireguard/<iface>.conf so peers survive reboot.
  execFileSync("wg-quick", ["save", CFG.iface], { encoding: "utf8" });
}

function authOk(req) {
  const h = req.headers["authorization"] || "";
  const got = Buffer.from(h.replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(CFG.token);
  return got.length === want.length && timingSafeEqual(got, want);
}

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
  res.end(s);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

// ---------- state (public keys + IP allocation only) ----------
function loadState() {
  try { return JSON.parse(fs.readFileSync(CFG.stateFile, "utf8")); }
  catch { return { peers: {} }; } // peers: { [publicKey]: { address, enabled, label, createdAt } }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(CFG.stateFile), { recursive: true });
  const tmp = CFG.stateFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, CFG.stateFile); // atomic-ish
}

// ---------- IP allocation ----------
function subnetInfo(cidr) {
  const [base, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  const ipToInt = (ip) => ip.split(".").reduce((a, o) => (a << 8) | parseInt(o, 10), 0) >>> 0;
  const intToIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
  const baseInt = ipToInt(base) & (~0 << (32 - bits)) >>> 0;
  const size = 2 ** (32 - bits);
  return { baseInt, size, intToIp };
}

function nextFreeIp(state) {
  const { baseInt, size, intToIp } = subnetInfo(CFG.subnet);
  const used = new Set(Object.values(state.peers).map((p) => p.address));
  // .0 network, .1 server, last = broadcast → start at base+2
  for (let i = 2; i < size - 1; i++) {
    const ip = intToIp(baseInt + i);
    if (!used.has(ip)) return ip;
  }
  return null;
}

// ---------- WireGuard ops ----------
function serverPublicKey() {
  return wg("show", CFG.iface, "public-key");
}

function addPeerToKernel(publicKey, address) {
  wg("set", CFG.iface, "peer", publicKey, "allowed-ips", `${address}/32`);
  persistInterface();
}

function removePeerFromKernel(publicKey) {
  try { wg("set", CFG.iface, "peer", publicKey, "remove"); } catch { /* already gone */ }
  persistInterface();
}

function livePeers() {
  // wg show <iface> dump: first line = interface, rest = peers (tab-separated)
  const lines = wg("show", CFG.iface, "dump").split("\n").slice(1).filter(Boolean);
  return lines.map((l) => {
    const [publicKey, , endpoint, allowedIps, latestHandshake, rx, tx] = l.split("\t");
    return {
      publicKey,
      endpoint: endpoint === "(none)" ? null : endpoint,
      allowedIps,
      latestHandshake: parseInt(latestHandshake, 10) || 0,
      rxBytes: parseInt(rx, 10) || 0,
      txBytes: parseInt(tx, 10) || 0,
    };
  });
}

function buildClientConf(privateKey, address) {
  return [
    "[Interface]",
    `PrivateKey = ${privateKey}`,
    `Address = ${address}/32`,
    `DNS = ${CFG.dns}`,
    "",
    "[Peer]",
    `PublicKey = ${serverPublicKey()}`,
    `Endpoint = ${CFG.endpoint}`,
    "AllowedIPs = 0.0.0.0/0, ::/0",
    "PersistentKeepalive = 25",
    "",
  ].join("\n");
}

// ---------- request handling ----------
const server = http.createServer(async (req, res) => {
  const reqId = randomUUID().slice(0, 8);
  try {
    if (!authOk(req)) return json(res, 401, { error: "unauthorized" });

    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean); // ["peers", ":pubkey"?]

    // GET /health
    if (req.method === "GET" && url.pathname === "/health") {
      const state = loadState();
      return json(res, 200, {
        ok: true,
        interface: CFG.iface,
        publicKey: serverPublicKey(),
        endpoint: CFG.endpoint,
        peers: Object.keys(state.peers).length,
      });
    }

    // GET /peers  (merge live kernel data with state metadata)
    if (req.method === "GET" && url.pathname === "/peers") {
      const state = loadState();
      const live = Object.fromEntries(livePeers().map((p) => [p.publicKey, p]));
      const out = Object.entries(state.peers).map(([publicKey, meta]) => ({
        publicKey,
        ...meta,
        live: live[publicKey] || null,
      }));
      return json(res, 200, { peers: out });
    }

    // POST /peers  { label? }
    if (req.method === "POST" && url.pathname === "/peers") {
      const body = await readBody(req);
      const state = loadState();

      const address = nextFreeIp(state);
      if (!address) return json(res, 507, { error: "ip_pool_exhausted" });

      const privateKey = wg("genkey");
      const publicKey = execFileSync("wg", ["pubkey"], { input: privateKey, encoding: "utf8" }).trim();

      addPeerToKernel(publicKey, address);
      state.peers[publicKey] = {
        address,
        enabled: true,
        label: String(body.label || "").slice(0, 64),
        createdAt: new Date().toISOString(),
      };
      saveState(state);

      const conf = buildClientConf(privateKey, address);
      // privateKey leaves scope here and is never written to disk.
      console.log(`[${reqId}] peer created ${publicKey} ${address} label=${state.peers[publicKey].label}`);
      return json(res, 201, { publicKey, address, conf });
    }

    // PATCH /peers/:pubkey  { enabled: bool }
    if (req.method === "PATCH" && parts[0] === "peers" && parts[1]) {
      const publicKey = decodeURIComponent(parts[1]);
      const body = await readBody(req);
      const state = loadState();
      const meta = state.peers[publicKey];
      if (!meta) return json(res, 404, { error: "not_found" });

      if (body.enabled === false && meta.enabled) {
        removePeerFromKernel(publicKey);
        meta.enabled = false;
      } else if (body.enabled === true && !meta.enabled) {
        addPeerToKernel(publicKey, meta.address);
        meta.enabled = true;
      }
      saveState(state);
      console.log(`[${reqId}] peer ${publicKey} enabled=${meta.enabled}`);
      return json(res, 200, { publicKey, enabled: meta.enabled });
    }

    // DELETE /peers/:pubkey
    if (req.method === "DELETE" && parts[0] === "peers" && parts[1]) {
      const publicKey = decodeURIComponent(parts[1]);
      const state = loadState();
      if (!state.peers[publicKey]) return json(res, 404, { error: "not_found" });
      removePeerFromKernel(publicKey);
      delete state.peers[publicKey];
      saveState(state);
      console.log(`[${reqId}] peer deleted ${publicKey}`);
      return json(res, 200, { deleted: publicKey });
    }

    return json(res, 404, { error: "no_such_route" });
  } catch (err) {
    console.error(`[${reqId}] error:`, err.message);
    return json(res, 500, { error: "internal", detail: err.message });
  }
});

server.listen(CFG.listenPort, CFG.listenHost, () => {
  console.log(`wg-agent listening on ${CFG.listenHost}:${CFG.listenPort} for ${CFG.iface} (${CFG.endpoint})`);
});
