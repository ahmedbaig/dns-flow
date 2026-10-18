import { VLAN_BY_IFACE } from './config.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PRIVATE_UPSTREAM = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

const nanos = (iso) => {
  const [base, frac = ''] = iso.replace('Z', '').split('.');
  return BigInt(Date.parse(`${base}Z`)) * 1000000n + BigInt(frac.padEnd(9, '0').slice(0, 9));
};

const outcomeOf = (e) => {
  if (/^Filtered/.test(e.reason)) return 'blocked';
  if (/^Rewrite/.test(e.reason)) return 'rewrite';
  if (e.cached) return 'cached';
  if (PRIVATE_UPSTREAM.test(e.upstream ?? '')) return 'internal';
  if (e.upstream) return 'forwarded';
  return 'cached';
};

export function pollAdguard({ url, auth, onQuery, intervalMs = 1500 }) {
  let cursor = BigInt(Date.now() - 3000) * 1000000n;
  const run = async () => {
    for (;;) {
      try {
        const res = await fetch(`${url}/control/querylog?limit=300`, { headers: { Authorization: `Basic ${auth}` } });
        if (!res.ok) throw new Error(`querylog ${res.status}`);
        const { data = [] } = await res.json();
        const fresh = data.map((e) => ({ e, t: nanos(e.time) })).filter(({ t }) => t > cursor).sort((a, b) => (a.t < b.t ? -1 : 1));
        for (const { e, t } of fresh) {
          cursor = t;
          onQuery({
            ts: Number(t / 1000000n), client: e.client, qname: e.question?.name ?? '', qtype: e.question?.type ?? '',
            outcome: outcomeOf(e), upstream: e.upstream || null, ms: Number(e.elapsedMs) || 0, reason: e.reason,
            ips: (e.answer ?? []).filter((a) => a.type === 'A' || a.type === 'AAAA').map((a) => a.value),
            cnames: (e.answer ?? []).filter((a) => a.type === 'CNAME').map((a) => String(a.value).replace(/\.$/, '')),
          });
        }
      } catch (err) {
        console.error('adguard poll failed:', err.message);
        await sleep(5000);
      }
      await sleep(intervalMs);
    }
  };
  run();
}

export function tailLoki({ url, query, onLine, name }) {
  const connect = () => {
    const start = `${Date.now()}000000`;
    const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/loki/api/v1/tail?query=${encodeURIComponent(query)}&start=${start}&limit=200`);
    ws.addEventListener('message', (m) => {
      try {
        const data = JSON.parse(m.data);
        (data.streams ?? []).forEach((s) => s.values.forEach(([ts, line]) => onLine(line, s.stream, Number(BigInt(ts) / 1000000n))));
      } catch (err) {
        console.error(`loki ${name} message failed:`, err.message);
      }
    });
    ws.addEventListener('close', () => setTimeout(connect, 3000));
    ws.addEventListener('error', () => ws.close());
  };
  connect();
}

const DHCP = /DHCPACK\((\S+)\) (\S+) (\S+)(?: (\S+))?/;
const ROAM = /STA (\S+) WPA: Receive UBNT_ROAM from (\S+)/;
const recentRoams = new Map();

export const parseUnifi = (line) => {
  const dhcp = line.match(DHCP);
  if (dhcp) {
    const [, iface, ip, mac, hostname] = dhcp;
    return { kind: 'dhcp', mac: mac.toLowerCase(), ip, zone: VLAN_BY_IFACE[iface] ?? null, hostname: hostname && hostname !== '*' ? hostname : null };
  }
  const roam = line.match(ROAM);
  if (roam) {
    const mac = roam[1].toLowerCase();
    if (Date.now() - (recentRoams.get(mac) ?? 0) < 3000) return null;
    recentRoams.set(mac, Date.now());
    return { kind: 'roam', mac, ap: roam[2].toLowerCase() };
  }
  if (line.includes('STA_ASSOC_TRACKER') && !line.includes('STA-TRACKER')) {
    const json = line.match(/\{.*\}/);
    if (!json) return null;
    const e = JSON.parse(json[0]);
    const leaving = /leave|disassoc|disconnect/i.test(e.event_type ?? '');
    return { kind: leaving ? 'leave' : 'join', mac: e.mac?.toLowerCase(), radio: e.vap, ap: 'ux7', rssi: Number(e.avg_rssi) || null, event: e.event_type, reason: e.sta_dc_reason };
  }
  return null;
};

const FIELD = (line, name) => line.match(new RegExp(`(?:^|\\s)${name}=(\\S*)`))?.[1] ?? null;
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fd|fe80)/;

export const parseFirewall = (line) => {
  if (!line.includes(' SRC=') || !line.includes(' DST=')) return null;
  const src = FIELD(line, 'SRC');
  const dst = FIELD(line, 'DST');
  const rule = line.match(/\[([^\]]+)\]/)?.[1] ?? null;
  const descr = line.match(/DESCR="([^"]*)"/)?.[1] ?? null;
  return {
    rule, descr, src, dst, proto: FIELD(line, 'PROTO'), spt: Number(FIELD(line, 'SPT')) || null, dpt: Number(FIELD(line, 'DPT')) || null,
    in: FIELD(line, 'IN'), out: FIELD(line, 'OUT'),
    direction: PRIVATE.test(src) && !PRIVATE.test(dst) ? 'out' : !PRIVATE.test(src) ? 'in' : 'internal',
  };
};

const NGINX = /^(\S+) \S+ \S+ \[[^\]]+\] "(\S+) (\S+)[^"]*" (\d{3})/;

export const parseNginx = (line) => {
  const m = line.match(NGINX);
  return m && { client: m[1], method: m[2], path: m[3], status: Number(m[4]), probe: /Blackbox Exporter/.test(line) };
};

export function pollPrometheus({ url, onPeers, intervalMs = 15000 }) {
  const query = async (q) => {
    const res = await fetch(`${url}/api/v1/query?query=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`prometheus ${res.status}`);
    return (await res.json()).data.result;
  };
  const run = async () => {
    for (;;) {
      try {
        const [ages, geo] = await Promise.all([query('wireguard_peer_handshake_age_seconds'), query('wireguard_peer_geo_info')]);
        const where = Object.fromEntries(geo.map((g) => [g.metric.peer, g.metric]));
        onPeers(ages.map((a) => {
          const age = Number(a.value[1]);
          const g = where[a.metric.peer] ?? {};
          return {
            peer: a.metric.peer, age, up: age >= 0 && age < 180,
            endpoint: g.endpoint_ip ?? null, city: g.city ?? null, country: g.country ?? null, asn: g.asn ?? null,
          };
        }));
      } catch (err) {
        console.error('prometheus poll failed:', err.message);
      }
      await sleep(intervalMs);
    }
  };
  run();
}
