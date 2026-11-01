import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config, zoneForIp } from './config.mjs';
import { openDb } from './db.mjs';
import { createRegistry } from './registry.mjs';
import { createNetworks } from './networks.mjs';
import { loadAsnTable } from './asn.mjs';
import { createHistory } from './history.mjs';
import { pollAdguard, readAdguardSince, tailLoki, parseUnifi, parseNginx, parseFirewall, pollPrometheus } from './sources.mjs';

const HOST_OWN = /(^|\.)(ipify\.org|ifconfig\.me|ip-api\.com|debian\.org|debian\.net)$/;

const viaTunnel = (ip, key) => {
  if (ip !== config.wireguardHost || HOST_OWN.test(key)) return null;
  const active = peers.filter((p) => p.up);
  if (!active.length) return null;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const peer = active[h % active.length];
  return { clientId: `peer:${peer.peer}`, nat: active.length > 1 ? 'shared' : 'single', peers: active.map((p) => p.peer) };
};

const SKIP_CLIENTS = /^(127\.|::1$|10\.10\.20\.2$|10\.10\.\d+\.1$|192\.168\.0\.1$)/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const STATIC = /^\/(index\.html|src\/[\w.-]+\.(js|css)|data\/[\w.-]+\.js)$/;

const streams = new Set();
const broadcast = (event, data) => {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  streams.forEach((res) => res.write(frame));
};

let peers = [];
let lastSignature = '';
let timer = null;

const db = await openDb(config.databaseUrl);
const history = await createHistory(db);
const registry = await createRegistry(db, () => {
  clearTimeout(timer);
  timer = setTimeout(emitStations, 400);
});

const networks = await createNetworks(db);
const loadAsn = () => loadAsnTable(config.dataDir).then((table) => networks.setTable(table)).catch((err) => console.error('ip2asn unavailable:', err.message));
loadAsn();
setInterval(loadAsn, 24 * 60 * 60 * 1000);

let destinations = networks.list();
let destinationSignature = '';
const emitDestinations = () => {
  destinations = networks.list();
  const signature = JSON.stringify(destinations.map((d) => [d.id, d.name, d.color]));
  if (signature === destinationSignature) return;
  destinationSignature = signature;
  broadcast('destinations', destinations);
};
setInterval(emitDestinations, 30000);

const peerStations = () => peers.filter((p) => p.up || /oracle/i.test(p.peer)).map((p) => {
  const deviceId = registry.deviceForPeer(p.peer);
  const device = deviceId && registry.devices.get(deviceId);
  const oracle = /oracle/i.test(p.peer);
  return {
    id: `peer:${p.peer}`, known: true, deviceId, label: device && !oracle ? `${device.name} · VPN` : p.peer,
    type: oracle ? 'cloud' : device?.type ?? 'phone', zone: 'vpn', ip: null, online: p.up, peer: p.peer,
    endpoint: p.endpoint, city: p.city, country: p.country, asn: p.asn, handshakeAge: p.age, cloud: oracle ? 'oracle' : null,
  };
});

const stations = () => [...registry.stations().filter((s) => s.zone !== 'vpn'), ...peerStations()];

function emitStations() {
  const list = stations();
  const signature = JSON.stringify(list.map((s) => [s.id, s.label, s.zone, s.online, s.type, s.known, s.ip]));
  if (signature === lastSignature) return;
  lastSignature = signature;
  broadcast('stations', list);
}
setInterval(emitStations, 30000);

pollAdguard({
  url: config.adguardUrl,
  auth: config.adguardAuth,
  onQuery: async (q) => {
    if (SKIP_CLIENTS.test(q.client)) return;
    const external = (q.outcome === 'forwarded' || q.outcome === 'cached') && !q.qname.endsWith('.baig.network') && q.qtype !== 'PTR';
    const net = external ? networks.classify(q) : null;
    const dest = net ? (destinations.some((d) => d.id === net.key) ? net.key : 'other') : null;
    if (net && !destinationSignature) emitDestinations();
    const tunnel = viaTunnel(q.client, q.qname);
    const clientId = await registry.resolveClient(q.client);
    history.record({ ts: q.ts, zone: tunnel ? 'vpn' : zoneForIp(q.client) ?? 'other', station: tunnel?.clientId ?? clientId, blocked: q.outcome === 'blocked' });
    broadcast('dns', { ...q, ips: q.ips.slice(0, 4), clientId: tunnel?.clientId ?? clientId, tunnel, dest, net });
  },
});

// Fill the history panel from AdGuard's own log when the ring buffer is
// mostly empty (first start, or Postgres was restarted after a crash).
const backfill = async () => {
  if ((await history.coverage()) > 20 * 60) return;
  const started = Date.now();
  const load = history.bulk();
  const pages = await readAdguardSince({
    url: config.adguardUrl,
    auth: config.adguardAuth,
    since: started - 24 * 60 * 60 * 1000,
    onQuery: (q) => {
      if (SKIP_CLIENTS.test(q.client)) return;
      const vpn = q.client === config.wireguardHost && !HOST_OWN.test(q.qname);
      load.add({ ts: q.ts, zone: vpn ? 'vpn' : zoneForIp(q.client) ?? 'other', station: vpn ? null : registry.stationForIp(q.client) ?? `ip:${q.client}`, blocked: q.outcome === 'blocked' });
    },
  });
  const minutes = await load.finish();
  console.log(`history backfill: ${minutes} minutes from ${pages} AdGuard pages in ${Math.round((Date.now() - started) / 1000)} s`);
};
backfill().catch((err) => console.error('history backfill failed:', err.message));

tailLoki({
  url: config.lokiUrl,
  name: 'unifi',
  query: '{job="unifi"} |~ "DHCPACK|UBNT_ROAM|STA_ASSOC_TRACKER"',
  onLine: async (line, _stream, ts) => {
    const ev = parseUnifi(line);
    if (!ev?.mac) return;
    if (ev.kind === 'dhcp') await registry.observe({ mac: ev.mac, ip: ev.ip, zone: ev.zone, hostname: ev.hostname });
    else if (ev.kind === 'roam') await registry.observe({ mac: ev.mac, ap: ev.ap });
    else await registry.observe({ mac: ev.mac, ap: ev.ap, radio: ev.radio, rssi: ev.rssi, online: ev.kind === 'join' });
    broadcast('wifi', { ...ev, ts });
  },
});

tailLoki({
  url: config.lokiUrl,
  name: 'firewall',
  query: '{job="unifi"} |= " SRC=" |= " DPT="',
  onLine: async (line, _stream, ts) => {
    const f = parseFirewall(line);
    if (!f || f.direction === 'internal') return;
    const remote = f.direction === 'out' ? f.dst : f.src;
    const net = networks.classify({ ips: [remote], qname: `${remote}:${f.direction === 'out' ? f.dpt : f.dpt}` });
    const dest = net ? (destinations.some((d) => d.id === net.key) ? net.key : 'other') : 'other';
    const clientId = f.direction === 'out' ? await registry.resolveClient(f.src) : null;
    broadcast('flow', { ...f, ts, clientId, dest, net });
  },
});

tailLoki({
  url: config.lokiUrl,
  name: 'nginx',
  query: '{job="nginx", log_type="access"}',
  onLine: async (line, _stream, ts) => {
    const r = parseNginx(line);
    if (!r || SKIP_CLIENTS.test(r.client)) return;
    const tunnel = viaTunnel(r.client, r.path);
    const clientId = await registry.resolveClient(r.client);
    broadcast('conn', { ...r, ts, clientId: tunnel?.clientId ?? clientId, tunnel });
  },
});

pollPrometheus({
  url: config.promUrl,
  onPeers: (list) => {
    const shape = (l) => JSON.stringify(l.map((p) => [p.peer, p.up, p.endpoint]));
    const changed = shape(list) !== shape(peers);
    peers = list;
    if (changed) {
      broadcast('peers', peers);
      emitStations();
    }
  },
});

const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

const body = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 100000) req.destroy();
  });
  req.on('end', () => {
    try {
      resolve(raw ? JSON.parse(raw) : {});
    } catch (err) {
      reject(err);
    }
  });
});

const actorOf = (req) => req.headers['x-auth-request-email'] ?? req.headers['x-forwarded-email'] ?? 'local';

const cleanName = (v) => String(v ?? '').trim().slice(0, 80);

const routes = [
  ['GET', /^\/api\/stream$/, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`event: snapshot\ndata: ${JSON.stringify({ stations: stations(), peers, devices: registry.deviceList(), destinations })}\n\n`);
    streams.add(res);
    const beat = setInterval(() => res.write(': keepalive\n\n'), 20000);
    req.on('close', () => {
      clearInterval(beat);
      streams.delete(res);
    });
  }],
  ['GET', /^\/api\/history$/, async (req, res) => json(res, 200, await history.series(new URL(req.url, 'http://local').searchParams.get('hours')))],
  ['GET', /^\/api\/stations$/, (_req, res) => json(res, 200, stations())],
  ['GET', /^\/api\/devices$/, (_req, res) => json(res, 200, registry.deviceList())],
  ['POST', /^\/api\/stations\/([^/]+)\/name$/, async (req, res, [id]) => {
    const fields = await body(req);
    const name = cleanName(fields.name);
    if (!name) return json(res, 400, { error: 'name required' });
    const device = await registry.nameStation(decodeURIComponent(id), { ...fields, name }, actorOf(req));
    json(res, 200, { id: `dev:${device.id}` });
  }],
  ['POST', /^\/api\/stations\/([^/]+)\/assign$/, async (req, res, [id]) => {
    const { deviceId } = await body(req);
    await registry.assignStation(decodeURIComponent(id), Number(deviceId), actorOf(req));
    json(res, 200, { id: `dev:${deviceId}` });
  }],
  ['PATCH', /^\/api\/devices\/(\d+)$/, async (req, res, [id]) => {
    const fields = await body(req);
    if ('name' in fields) fields.name = cleanName(fields.name);
    if ('name' in fields && !fields.name) return json(res, 400, { error: 'name required' });
    json(res, 200, await registry.updateDevice(Number(id), fields, actorOf(req)));
  }],
  ['GET', /^\/api\/networks$/, (_req, res) => json(res, 200, networks.list())],
  ['PATCH', /^\/api\/networks\/([\w-]+)$/, async (req, res, [key]) => {
    const updated = await networks.update(key, await body(req), actorOf(req));
    destinationSignature = '';
    emitDestinations();
    json(res, 200, updated);
  }],
  ['POST', /^\/api\/networks\/([\w-]+)\/merge$/, async (req, res, [key]) => {
    const { into } = await body(req);
    await networks.merge(key, String(into), actorOf(req));
    destinationSignature = '';
    emitDestinations();
    json(res, 200, { id: into });
  }],
  ['GET', /^\/healthz$/, (_req, res) => json(res, 200, { ok: true, streams: streams.size })],
];

const serveStatic = async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!STATIC.test(file)) return json(res, 404, { error: 'not found' });
  try {
    const content = await readFile(path.join(config.staticDir, file));
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(content);
  } catch {
    json(res, 404, { error: 'not found' });
  }
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const route = routes.find(([method, pattern]) => method === req.method && pattern.test(url.pathname));
  try {
    if (route) await route[2](req, res, url.pathname.match(route[1]).slice(1));
    else if (req.method === 'GET') await serveStatic(req, res);
    else json(res, 405, { error: 'method not allowed' });
  } catch (err) {
    console.error(req.method, url.pathname, err.message);
    if (!res.headersSent) json(res, 400, { error: err.message });
  }
}).listen(config.port, () => console.log(`dns-flow bridge on :${config.port}`));
