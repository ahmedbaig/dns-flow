import { CLIENTS, PEERS } from '../data/clients.example.js';
import { pt, octilinear, smooth, measure } from './geometry.js';

export const OUTCOMES = {
  forwarded: { label: 'Forwarded · DoT', color: 0x2e9e5b },
  cached: { label: 'Cached', color: 0x1f8fd6 },
  blocked: { label: 'Blocked', color: 0xdc241f },
  rewrite: { label: 'Rewrite', color: 0x8e5ad9 },
  internal: { label: 'Internal · UX7', color: 0xe8a317 },
};

export const TRAFFIC = { id: 'data', label: 'Connections', color: 0x5d6b7e };

export const ZONES = [
  { id: 'servers', name: 'VLAN 20 Servers', subnet: '10.10.20.0/24', iface: 'br20', color: 0x00782a, y: 230 },
  { id: 'lab', name: 'VLAN 50 Lab', subnet: '10.10.50.0/24', iface: 'br50', color: 0xb36305, y: 420 },
  { id: 'trusted', name: 'VLAN 10 Trusted', subnet: '10.10.10.0/24', iface: 'br10', color: 0x0019a8, y: 610 },
  { id: 'iot', name: 'VLAN 30 IoT', subnet: '10.10.30.0/24', iface: 'br30', color: 0xd799af, y: 800 },
  { id: 'main', name: 'VLAN 1 Main Net', subnet: '192.168.0.0/25', iface: 'br0', color: 0x868f98, y: 990 },
  { id: 'guest', name: 'VLAN 40 Guest', subnet: '10.10.40.0/24', iface: 'br40', color: 0xee7c0e, y: 1180 },
  { id: 'unassigned', name: 'Seen on Wi-Fi · no IP yet', subnet: 'no DHCP lease', iface: 'wifi', color: 0xb0b6be, y: 1370 },
  { id: 'vpn', name: 'WireGuard VPN', subnet: '10.9.0.0/24', iface: 'wg0', color: 0x00a4a7, tunnel: true },
];

export const DEVICE_TYPES = {
  laptop: 'Laptop', phone: 'Phone', tablet: 'Tablet', desktop: 'Desktop', server: 'Proxmox host', container: 'LXC container',
  camera: 'IP camera', vacuum: 'Robot vacuum', pi: 'Raspberry Pi', console: 'Game console', handheld: 'Handheld',
  tv: 'Smart TV', watch: 'Watch', cloud: 'Cloud VM', unknown: 'Unknown',
};

export const DESTINATIONS = [
  { id: 'other', name: 'Other sites', sub: 'everything else', color: 0x7b8794 },
  { id: 'oracle', name: 'Oracle Cloud', sub: 'Sydney · 158.178.143.215', color: 0xc74634 },
  { id: 'quad9', name: 'Quad9', sub: '9.9.9.9 · DNS over TLS', color: 0xd6336c },
  { id: 'cloudflare', name: 'Cloudflare', sub: '1.1.1.1 · DNS + CDN', color: 0xf38020 },
  { id: 'microsoft', name: 'Microsoft', sub: 'M365 · Teams · LinkedIn', color: 0x00a4ef },
  { id: 'google', name: 'Google', sub: 'Search · YouTube · GCP', color: 0x4285f4 },
  { id: 'github', name: 'GitHub', sub: 'git · objects', color: 0x24292f },
  { id: 'apple', name: 'Apple', sub: 'iCloud · push · updates', color: 0x8e8e93 },
  { id: 'aws', name: 'AWS', sub: 'Docker Hub · S3', color: 0xff9900 },
  { id: 'netflix', name: 'Netflix', sub: 'Open Connect · Sydney IX', color: 0xe50914 },
];

const MAIN_Y = 705;
const IC_X = 700;
const TRUNK_X = 1060;
const UX7_X = 1310;
const HUB_X = 2270;
const DEST_X = 2570;
const VM_X = 2900;
const STATION_GAP = 135;
const FIRST_STATION = 170;
const TOP_LANE = 30;
const SPEED = 300;

export const REGIONS = [
  { name: 'Home network · LAN', from: -6000, to: UX7_X + 150, label: -700, color: '#eef3fb' },
  { name: 'WAN side · eero · ONT · Leaptel', from: UX7_X + 150, to: HUB_X - 80, color: '#f7f2ea' },
  { name: 'Internet', from: HUB_X - 80, to: 9000, color: '#f2f1f8' },
];

const LAN_ZONES = ZONES.filter((z) => !z.tunnel);
const trunkPort = (order) => MAIN_Y + (order - (LAN_ZONES.length - 1) / 2) * 40;

const NODES = [
  { id: 'trunk', kind: 'network', shape: 'bar', name: '802.1Q trunk', sub: 'all VLANs · GS105 → GS724T', x: TRUNK_X, y: MAIN_Y, h: trunkPort(LAN_ZONES.length - 1) - trunkPort(0) + 40 },
  { id: 'ux7', kind: 'network', shape: 'card', name: 'UX7', sub: 'edge · routing · NAT · firewall', color: 0x1d2433, x: UX7_X, y: MAIN_Y, w: 250, h: 70, live: 'flows' },
  { id: 'eero', kind: 'network', shape: 'interchange', name: 'eero', sub: 'Leaptel test router · double NAT', x: UX7_X + 260, y: MAIN_Y },
  { id: 'ont', kind: 'network', shape: 'interchange', name: 'ONT', sub: 'Opticomm NTD · FTTP', x: UX7_X + 490, y: MAIN_Y },
  { id: 'isp', kind: 'network', shape: 'interchange', name: 'Leaptel', sub: 'ISP · 1000/100', x: UX7_X + 720, y: MAIN_Y },
  { id: 'hub', kind: 'network', shape: 'bar', name: 'Internet', sub: 'transit · peering', x: HUB_X, y: MAIN_Y, h: 0 },
  { id: 'adguard', kind: 'service', shape: 'card', name: 'AdGuard Home', sub: 'CT 110 · DNS 1 · 10.10.20.2', color: 0x6950a1, x: 1050, y: 90, w: 250, h: 70, vlan: 'servers', live: 'dns' },
  { id: 'unbound', kind: 'service', shape: 'card', name: 'Unbound', sub: '127.0.0.1:5335 · DoT out', color: 0x6950a1, x: 1330, y: 90, w: 230, h: 70, vlan: 'servers', live: 'dns' },
  { id: 'cache', kind: 'service', shape: 'module', name: 'Cache', sub: 'in-memory', color: OUTCOMES.cached.color, x: 980, y: 230, w: 96, h: 30 },
  { id: 'rewrite', kind: 'service', shape: 'module', name: 'Rewrites', sub: 'checked first', color: OUTCOMES.rewrite.color, x: 1090, y: 230, w: 96, h: 30 },
  { id: 'blocklist', kind: 'service', shape: 'module', name: 'Blocklists', sub: '102 lists', color: OUTCOMES.blocked.color, x: 1200, y: 230, w: 96, h: 30 },
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const toMB = (usage) => {
  if (!usage) return 0;
  const [n, unit] = usage.split(' ');
  return Number(n) * ({ KB: 1 / 1024, MB: 1, GB: 1024 }[unit] ?? 0);
};

export const DEVICES = [
  ...CLIENTS.filter((c) => !c.role || c.role === 'host' || c.role === 'wireguard').map((c) => ({
    ...c,
    id: `dev:${slug(c.name)}`,
    label: c.name,
    zone: c.network,
    online: !c.lastSeen,
    weight: c.lastSeen ? 0 : 0.4 + Math.log10(1 + toMB(c.usage)),
  })),
  ...PEERS.map((p) => ({ ...p, id: `dev:${slug(p.name)}`, label: p.name, zone: 'vpn', vendor: 'Oracle', via: 'tunnel', online: true, weight: 1.2 })),
];

export const CLIENT_ENTRIES = Object.fromEntries(CLIENTS.filter((c) => c.role === 'adguard' || c.role === 'gs724t').map((c) => [c.role, c]));

const WG_IP = '10.10.50.20';

export function buildTopology(devices = DEVICES, destinations = DESTINATIONS) {
  const hubPort = (i) => MAIN_Y + (i - (destinations.length - 1) / 2) * 40;
  const destY = (i) => MAIN_Y + (i - (destinations.length - 1) / 2) * 140;
  const nodes = new Map();
  const edges = new Map();
  const add = (node) => nodes.set(node.id, { flash: 0, stats: createStats(), traffic: [], vlan: '*', ...node });
  const link = (a, b, kind, points, extra = {}) => edges.set(`${a}|${b}`, { key: `${a}|${b}`, a, b, kind, path: measure(smooth(points, extra.radius ?? 22)), heat: 0, ...extra });

  NODES.forEach(add);
  nodes.get('hub').h = hubPort(destinations.length - 1) - hubPort(0) + 40;
  destinations.forEach((d, i) => add({ ...d, kind: 'planet', shape: 'roundel', x: DEST_X, y: destY(i), vlan: 'internet', network: d }));

  LAN_ZONES.forEach((zone, order) => {
    const members = devices.filter((d) => d.zone === zone.id);
    const vlanId = `vlan:${zone.id}`;
    add({
      id: vlanId, kind: 'vlan', shape: 'interchange', name: zone.name, sub: `${zone.subnet} · ${zone.iface}`, color: zone.color,
      zone: zone.id, vlan: zone.id, x: IC_X, y: zone.y, members: members.length,
    });
    link(vlanId, 'trunk', 'vlan', octilinear(pt(IC_X + 12, zone.y), pt(TRUNK_X - 11, trunkPort(order))), { color: zone.color });
    members.forEach((d, i) => {
      const x = IC_X - FIRST_STATION - i * STATION_GAP;
      add({
        id: d.id, kind: 'device', shape: 'station', name: d.label, sub: d.ip, color: zone.color, zone: zone.id, vlan: zone.id,
        device: { ...d, zoneName: zone.name, iface: zone.iface }, online: d.online, x, y: zone.y,
      });
      link(d.id, vlanId, 'device', [pt(x, zone.y), pt(IC_X - 12, zone.y)], { color: zone.color });
    });
  });

  const oracleY = destY(Math.max(0, destinations.findIndex((d) => d.id === 'oracle')));
  const vpn = ZONES.find((z) => z.tunnel);
  const wg = [...nodes.values()].find((n) => n.device?.ip === WG_IP);
  const oracleFirst = (d) => (d.type === 'cloud' ? 0 : 1);
  devices.filter((d) => d.zone === 'vpn').sort((a, b) => oracleFirst(a) - oracleFirst(b)).forEach((d, i) => {
    const y = oracleY + i * 120;
    add({
      id: d.id, kind: 'device', shape: 'vm', name: d.label, sub: d.ip ?? d.endpoint ?? '', color: vpn.color, zone: 'vpn', vlan: 'vpn',
      device: { ...d, zoneName: vpn.name, iface: vpn.iface }, online: d.online !== false, x: VM_X, y,
    });
    if (!wg) return;
    const shift = i * 14;
    const top = TOP_LANE - shift;
    const lane = MAIN_Y - 28 - shift;
    const under = wg.y + 26 + shift;
    const descent = HUB_X + 70 + shift;
    link(d.id, wg.id, 'tunnel', [
      pt(VM_X + shift, y - 16), pt(VM_X + shift, top), pt(descent, top), pt(descent, lane - 40), pt(descent - 40, lane),
      pt(TRUNK_X + 40, lane),
      ...octilinear(pt(TRUNK_X + 40, lane), pt(IC_X + 60, under)).slice(1),
      pt(wg.x, under), pt(wg.x, wg.y + 10),
    ], { color: vpn.color, radius: 30 });
    if (d.type === 'cloud' && nodes.has('oracle')) link(d.id, 'oracle', 'cloud', [pt(VM_X - 20, y), pt(DEST_X + 230, y)], { color: 0xc74634, decor: true });
  });

  const chain = ['trunk', 'ux7', 'eero', 'ont', 'isp', 'hub'];
  const right = (id) => nodes.get(id).x + (nodes.get(id).w ? nodes.get(id).w / 2 : 9);
  const left = (id) => nodes.get(id).x - (nodes.get(id).w ? nodes.get(id).w / 2 : 9);
  chain.slice(1).forEach((id, i) => link(chain[i], id, i === 0 ? 'trunk' : 'wan', [pt(right(chain[i]), MAIN_Y), pt(left(id), MAIN_Y)], { color: 0x1d2433 }));

  destinations.forEach((d, i) => {
    link(d.id, 'hub', 'transit', octilinear(pt(HUB_X + 9, hubPort(i)), pt(DEST_X - 24, destY(i))).reverse(), { color: d.color });
  });

  const servers = nodes.get('vlan:servers');
  const adguard = nodes.get('adguard');
  const unbound = nodes.get('unbound');
  link('adguard', 'vlan:servers', 'service', [
    pt(adguard.x - adguard.w / 2, adguard.y), pt(servers.x + 60, adguard.y), pt(servers.x, adguard.y + 60), pt(servers.x, servers.y - 12),
  ], { color: 0x6950a1 });
  link('unbound', 'adguard', 'internal', [pt(unbound.x - unbound.w / 2, unbound.y), pt(adguard.x + adguard.w / 2, adguard.y)], { color: 0x6950a1 });
  ['cache', 'rewrite', 'blocklist'].forEach((m) => {
    const target = nodes.get(m);
    const startX = Math.min(Math.max(target.x, adguard.x - 70), adguard.x + 70);
    link('adguard', m, 'module', octilinear(pt(startX, adguard.y + adguard.h / 2), pt(target.x, target.y - target.h / 2), false), { color: target.color });
  });

  const parentOf = new Map([...edges.values()].filter((e) => !e.decor && e.kind !== 'module').map((e) => [e.a, e.b]));

  const chainOf = (id) => {
    const out = [id];
    while (parentOf.has(out[out.length - 1])) out.push(parentOf.get(out[out.length - 1]));
    return out;
  };

  const treePath = (a, b) => {
    const ca = chainOf(a);
    const cb = chainOf(b);
    const lca = ca.find((x) => cb.includes(x));
    return [...ca.slice(0, ca.indexOf(lca) + 1), ...cb.slice(0, cb.indexOf(lca)).reverse()];
  };

  const l3Path = (a, b) => {
    const [va, vb] = [nodes.get(a).vlan, nodes.get(b).vlan];
    if (va === vb || va === '*' || vb === '*') return treePath(a, b);
    return [...treePath(a, 'ux7'), ...treePath('ux7', b).slice(1)];
  };

  const reverse = (path) => [...path].reverse();

  const routeDns = (ev) => {
    const out = l3Path(ev.client.id, 'adguard');
    const back = reverse(out);
    switch (ev.outcome) {
      case 'blocked': return [...out, 'blocklist'];
      case 'cached': return [...out, 'cache', ...back];
      case 'rewrite': return [...out, 'rewrite', ...back];
      case 'internal': {
        const gw = treePath('adguard', 'ux7');
        return [...out, ...gw.slice(1), ...reverse(gw).slice(1), ...back.slice(1)];
      }
      default: {
        const up = l3Path('unbound', ev.upstream);
        return [...out, ...up, ...reverse(up).slice(1), ...back];
      }
    }
  };

  const routeData = (ev) => {
    const out = l3Path(ev.client.id, ev.dest);
    return [...out, ...reverse(out).slice(1)];
  };

  const route = (ev) => (ev.kind === 'data' ? routeData(ev) : routeDns(ev));

  const edgeBetween = (from, to) => {
    const forward = edges.get(`${from}|${to}`);
    return forward ? { edge: forward, reverse: false } : { edge: edges.get(`${to}|${from}`), reverse: true };
  };

  const segments = (ev) => {
    const hops = route(ev);
    return hops.slice(1).map((to, i) => {
      const from = hops[i];
      const linkInfo = edgeBetween(from, to);
      const extra = linkInfo.edge.kind === 'transit' && ev.kind === 'dns' ? ev.ms * 0.004 : 0;
      const travel = Math.max(0.12, linkInfo.edge.path.total / SPEED);
      return { ...linkInfo, from, to, dur: (linkInfo.edge.kind === 'tunnel' ? Math.min(travel, 3.5) : travel) + extra };
    });
  };

  return { nodes, edges, route, segments, path: l3Path };
}

function createStats() {
  return { total: 0, outcomes: {}, recent: [], domains: new Map() };
}

export function recordStats(stats, ev, now) {
  stats.total += 1;
  stats.outcomes[ev.outcome] = (stats.outcomes[ev.outcome] || 0) + 1;
  stats.recent.push(now);
  stats.domains.set(ev.qname, (stats.domains.get(ev.qname) || 0) + 1);
  if (stats.domains.size > 400) {
    const smallest = [...stats.domains].sort((x, y) => x[1] - y[1]).slice(0, 100);
    smallest.forEach(([k]) => stats.domains.delete(k));
  }
}

export function ratePerSecond(stats, now, windowMs = 10000) {
  while (stats.recent.length && stats.recent[0] < now - windowMs) stats.recent.shift();
  return stats.recent.length / (windowMs / 1000);
}
