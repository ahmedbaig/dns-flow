import { buildTopology, recordStats, ratePerSecond, TRAFFIC } from './topology.js';
import { createSimulator } from './simulator.js';
import { createHud } from './hud.js';
import { createMap } from './map.js';
import { createDots } from './dots.js';
import { createConversations } from './conversations.js';
import { createView } from './view.js';
import { connectLive, api } from './live.js';
import { createHistory } from './history.js';

const LIVE = !new URLSearchParams(location.search).has('sim');
const PROXY_IP = '10.10.20.3';
document.body.classList.toggle('mode-live', LIVE);

const svg = document.getElementById('map');
const canvas = document.getElementById('dots');
const ctx = canvas.getContext('2d');
const world = { topology: null, map: null, talk: null };

const state = {
  liveMode: LIVE,
  paused: false,
  speed: 1,
  names: 'full',
  hiddenOutcomes: new Set(),
  hiddenZones: new Set(),
  selected: null,
  hovered: null,
  deviceLabels: 'auto',
  simTime: 0,
  follow: false,
  dive: null,
  devices: [],
  stations: [],
  destinations: undefined,
};

const totals = { all: 0, outcomes: {}, zones: {}, recent: [], connections: [] };
const feed = [];
const live = new Map();
let eventId = 0;

const nodeOf = (id) => world.topology?.nodes.get(id);

const flowRate = (list, now, windowMs = 10000) => {
  while (list.length && list[0] < now - windowMs) list.shift();
  return list.length / (windowMs / 1000);
};

const safeSegments = (ev) => {
  try {
    return world.topology.segments(ev);
  } catch {
    return null;
  }
};

let lastObservedFlow = -Infinity;

const launchConnection = (ev) => {
  if (ev.inferred && performance.now() - lastObservedFlow < 300000) return;
  const dest = nodeOf(ev.dest);
  if (!dest || !nodeOf(ev.client.id) || ev.dest === ev.client.id) return;
  const data = {
    id: `c${ev.id}`, kind: 'data', ts: Date.now(), client: ev.client, dest: ev.dest, destName: dest.name, qname: ev.qname,
    color: dest.kind === 'planet' ? dest.color : TRAFFIC.color, observed: ev.observed,
  };
  const segs = safeSegments(data);
  if (!segs) return;
  const now = performance.now();
  totals.outcomes.data = (totals.outcomes.data || 0) + 1;
  totals.connections.push(now);
  world.talk.record(ev.client.id, ev.dest, 'data', now);
  new Set(world.topology.route(data)).forEach((id) => nodeOf(id)?.traffic.push(now));
  if (state.hiddenOutcomes.has('data') || state.hiddenZones.has(ev.client.zone)) return;
  live.set(data.id, dots.spawn(data, segs));
};

const dots = createDots({
  onArrive: () => {},
  onFinish: (p) => {
    live.delete(p.ev.id);
    p.done = true;
    if (p.kind === 'dns' && p.ev.dest) launchConnection({ ...p.ev, inferred: true });
  },
});

const handleDns = (ev) => {
  const now = performance.now();
  totals.all += 1;
  totals.outcomes[ev.outcome] = (totals.outcomes[ev.outcome] || 0) + 1;
  totals.zones[ev.client.zone] = (totals.zones[ev.client.zone] || 0) + 1;
  totals.recent.push(now);
  feed.unshift(ev);
  feed.length = Math.min(feed.length, 14);
  const client = nodeOf(ev.client.id);
  const segs = client && safeSegments(ev);
  if (!segs) return;
  new Set(world.topology.route(ev)).forEach((id) => recordStats(nodeOf(id).stats, ev, now));
  client.lastSeen = state.simTime;
  world.talk.record(ev.client.id, 'adguard', 'dns', now);
  if (ev.outcome === 'forwarded') world.talk.record('unbound', ev.upstream, 'upstream', now);
  if (ev.outcome === 'internal') world.talk.record('adguard', 'ux7', 'local', now);
  if (state.hiddenOutcomes.has(ev.outcome) || state.hiddenZones.has(ev.client.zone)) {
    if (ev.dest) launchConnection({ ...ev, inferred: true });
    return;
  }
  live.set(ev.id, dots.spawn(ev, segs));
};

const simulator = LIVE ? { state: { rate: 0, storm: 0 }, tick: () => {}, storm: () => {} } : createSimulator(handleDns);
const hud = createHud({ state, simulator, world, totals, feed, live, flows: dots });

const trackFor = (key) => {
  const edge = world.topology.edges.get(key);
  if (!edge) return null;
  const [a, b] = [nodeOf(edge.a), nodeOf(edge.b)];
  return { edgeKey: key, edge, name: `${a.name} ↔ ${b.name}`, color: edge.color };
};

const refreshDive = () => {
  const sel = state.selected;
  if (sel && !sel.ev) {
    state.dive = world.talk.show(sel, performance.now());
    world.map.setFocus(world.talk.focus, sel.id ?? null);
    world.map.setArcs(world.talk.arcs);
    return;
  }
  world.talk.hide();
  state.dive = null;
  world.map.setArcs([]);
  if (sel?.ev) world.map.setFocus({ nodes: new Set(sel.segs.flatMap((s) => [s.from, s.to])), edges: new Set(sel.segs.map((s) => s.edge.key)) }, null);
  else world.map.setFocus(null, null);
};

const view = createView();

const select = (target) => {
  state.selected = target;
  if (target && view.compact()) view.setSheet(null);
  refreshDive();
  hud.renderInspect();
};

const handlers = {
  onClick: ({ world: point, node, edge }) => {
    if (node) return select(nodeOf(node));
    const p = dots.nearest(point.x, point.y, 9 / world.map.transform.s, world.talk.involves);
    if (p) return select(p);
    if (edge) return select(trackFor(edge));
    return select(null);
  },
  padding: () => view.padding(),
  onHover: (id, x, y) => {
    const node = id ? nodeOf(id) : null;
    state.hovered = node;
    hud.tooltip(node, x, y);
  },
};

let pendingSelect = null;

const rebuild = (stations) => {
  const transform = world.map ? { ...world.map.transform } : null;
  world.map?.destroy();
  world.topology = buildTopology(stations, state.destinations);
  dots.retarget(safeSegments);
  [...live.keys()].forEach((id) => { if (!dots.particles.some((p) => p.ev.id === id)) live.delete(id); });
  if (world.talk) world.talk.retarget(world.topology);
  else world.talk = createConversations(world.topology);
  world.map = createMap(svg, world.topology, handlers, transform);
  if (!transform) world.map.fit('home');
  const sel = state.selected;
  const wanted = pendingSelect ?? (sel && !sel.ev && (sel.edgeKey ?? sel.id));
  pendingSelect = null;
  const again = wanted && (world.topology.edges.has(wanted) ? trackFor(wanted)
    : nodeOf(wanted) ?? (sel?.device?.mac && [...world.topology.nodes.values()].find((n) => n.device?.mac === sel.device.mac)));
  select(again || null);
  hud.setUnknown(stations ?? []);
};

let rebuildTimer = null;
let latestStations = null;
const scheduleRebuild = (stations) => {
  latestStations = stations;
  if (rebuildTimer) return;
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    rebuild(latestStations);
  }, 1500);
};

const resolverFor = (qname) => {
  let h = 0;
  for (const ch of qname) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 10 < 7 ? 'cloudflare' : 'quad9';
};

const setStatus = (text) => {
  const el = document.querySelector('.sim');
  if (el) el.textContent = text;
};

if (LIVE) {
  connectLive({
    snapshot: ({ stations, devices, destinations }) => {
      state.devices = devices;
      state.destinations = destinations;
      state.stations = stations;
      rebuild(stations);
    },
    stations: (stations) => {
      state.stations = stations;
      api('GET', 'api/devices').then((d) => { state.devices = d; }).catch(() => {});
      scheduleRebuild(stations);
    },
    destinations: (list) => {
      state.destinations = list;
      scheduleRebuild(state.stations);
    },
    dns: (q) => {
      const node = nodeOf(q.clientId);
      const ev = {
        id: ++eventId, ts: q.ts, kind: 'dns', qname: q.qname, qtype: q.qtype, outcome: q.outcome, ms: q.ms, live: true,
        client: { id: q.clientId, ip: q.client, name: node?.name ?? q.client, zone: node?.zone ?? null },
        upstream: q.outcome === 'forwarded' ? resolverFor(q.qname) : q.outcome === 'internal' ? '10.10.20.1:53' : null,
      };
      ev.dest = q.dest;
      ev.tunnel = q.tunnel;
      ev.net = q.net;
      ev.ips = q.ips;
      if (!state.paused) handleDns(ev);
    },
    conn: (c) => {
      const proxy = [...world.topology.nodes.values()].find((n) => n.device?.ip === PROXY_IP);
      const node = nodeOf(c.clientId);
      if (state.paused || !proxy || !node || node === proxy) return;
      launchConnection({
        id: `n${++eventId}`, observed: true, dest: proxy.id, qname: `${c.method} ${c.path} · ${c.status}`,
        client: { id: c.clientId, ip: c.client, name: node.name, zone: node.zone },
      });
    },
    flow: (f) => {
      lastObservedFlow = performance.now();
      if (state.paused) return;
      const label = `${f.proto ?? ''} ${f.direction === 'out' ? f.dst : f.src}:${f.dpt ?? ''}${f.descr ? ` · ${f.descr}` : ''}`;
      if (f.direction === 'out') {
        const node = nodeOf(f.clientId);
        if (!node) return;
        launchConnection({ id: `f${++eventId}`, observed: true, dest: f.dest, qname: label, client: { id: f.clientId, ip: f.src, name: node.name, zone: node.zone } });
      } else {
        const from = nodeOf(f.dest);
        if (!from) return;
        launchConnection({ id: `f${++eventId}`, observed: true, inbound: true, dest: 'ux7', qname: label, client: { id: from.id, ip: f.src, name: from.name, zone: 'internet' } });
      }
    },
    status: (s) => setStatus(s === 'live' ? 'Live · AdGuard · UniFi · nginx · WireGuard' : 'Reconnecting to bridge…'),
  });
  createHistory();
} else {
  setStatus('Simulated traffic · example household');
  rebuild(undefined);
}

hud.on('select-particle', (p) => select(p));
hud.on('select-node', (id) => {
  const node = nodeOf(id);
  if (!node) return;
  select(node);
  world.map.centerOn(node.x, node.y);
});
hud.on('close', () => select(null));
hud.on('reset-view', () => world.map.fit());
document.getElementById('m-fit').addEventListener('click', () => world.map?.fit());
hud.on('device-form', async ({ action, station, device, network, data }) => {
  try {
    if (action === 'network-update') {
      await api('PATCH', `api/networks/${network}`, data);
      pendingSelect = network;
      document.activeElement?.blur();
      return;
    }
    if (action === 'network-merge') {
      pendingSelect = (await api('POST', `api/networks/${network}/merge`, data)).id;
      document.activeElement?.blur();
      return;
    }
    if (action === 'name') pendingSelect = (await api('POST', `api/stations/${encodeURIComponent(station)}/name`, data)).id;
    else if (action === 'assign') pendingSelect = (await api('POST', `api/stations/${encodeURIComponent(station)}/assign`, { deviceId: Number(data.deviceId) })).id;
    else await api('PATCH', `api/devices/${device}`, data);
    document.activeElement?.blur();
  } catch (err) {
    alert(`Could not save: ${err.message}`);
  }
});

const resize = () => {
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
};
window.addEventListener('resize', resize);
resize();

window.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  if (e.code === 'Space') {
    e.preventDefault();
    hud.togglePause();
  } else if (e.code === 'Escape') select(null);
  else if (e.code === 'KeyF') world.map?.fit();
  else if (e.code === 'KeyH') view.toggleHud();
});

const refreshLive = (now) => {
  world.topology.nodes.forEach((node) => {
    if (node.live === 'dns') world.map.setLive(node.id, { rate: ratePerSecond(node.stats, now), outcomes: node.id === 'adguard' ? node.stats.outcomes : null });
    else if (node.live === 'flows' || node.kind === 'planet') world.map.setLive(node.id, { rate: ratePerSecond(node.stats, now) + flowRate(node.traffic, now) });
  });
};

let last = performance.now();
let hudTimer = 0;
let liveTimer = 0;
let diveTimer = 0;
let labels = null;

const frame = (now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const simDt = state.paused ? 0 : dt * state.speed;
  state.simTime += simDt;
  requestAnimationFrame(frame);
  if (!world.map) return;

  simulator.tick(simDt);
  dots.update(simDt);
  world.talk.update(dt);

  if (labels !== state.deviceLabels) {
    labels = state.deviceLabels;
    world.map.setLabels(labels);
  }

  const dpr = Math.min(window.devicePixelRatio, 2);
  const { s, x, y } = world.map.transform;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * x, dpr * y);
  dots.draw(ctx, { selected: state.selected?.ev ? state.selected : null, involves: world.talk.involves, pulses: world.talk.pulses });

  hudTimer += dt;
  liveTimer += dt;
  diveTimer += dt;
  if (hudTimer > 0.25) {
    hudTimer = 0;
    hud.refresh(now, flowRate(totals.connections, now, 5000));
  }
  if (liveTimer > 0.5) {
    liveTimer = 0;
    refreshLive(now);
  }
  if (diveTimer > 2) {
    diveTimer = 0;
    if (state.selected && !state.selected.ev) refreshDive();
  }
};
requestAnimationFrame(frame);

hud.mountLists();
window.__dnsFlow = { world, dots, simulator, state, select };
