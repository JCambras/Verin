// The capability-denied network fixture (prompt 2 section 3, extending prompt 1 section 5B): loaded
// with --require around next build (and any probed start-up), it refuses every outbound connection to
// a non-loopback host and names the host. The E9 allowlist is empty until slice 9; telemetry is never
// added to it, so nothing this repository builds may reach any network at build or dev time.
"use strict";
const net = require("node:net");
const tls = require("node:tls");
const dns = require("node:dns");
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", ""]);
function refuse(host, via) {
  if (host == null || LOOPBACK.has(String(host))) return;
  process.stderr.write(`deny-net: refused outbound ${via} to '${host}' (the external-effect allowlist is empty)\n`);
  throw new Error(`deny-net: outbound ${via} to '${host}' is refused`);
}
function hostOfArgs(args) {
  if (typeof args[0] === "object" && args[0] !== null) return args[0].host ?? args[0].hostname ?? null;
  return typeof args[1] === "string" ? args[1] : null;
}
const netConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { refuse(hostOfArgs(args), "socket connect"); return netConnect.apply(this, args); };
const tlsConnect = tls.connect;
tls.connect = (...args) => { refuse(hostOfArgs(args), "tls connect"); return tlsConnect(...args); };
for (const fn of ["lookup", "resolve", "resolve4", "resolve6"]) {
  const orig = dns[fn];
  dns[fn] = (...args) => { refuse(args[0], `dns ${fn}`); return orig(...args); };
}
if (typeof globalThis.fetch === "function") {
  const origFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    try { refuse(new URL(typeof input === "string" || input instanceof URL ? input : input.url, "http://localhost").hostname, "fetch"); }
    catch (e) { if (String(e).includes("deny-net")) throw e; }
    return origFetch(input, init);
  };
}
