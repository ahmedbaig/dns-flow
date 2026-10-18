import { curveBetween, measure } from './geometry.js';

export const KIND = {
  dns: { label: 'DNS lookups', color: 0x1f8fd6 },
  data: { label: 'Connections', color: 0x6950a1 },
  upstream: { label: 'DoT upstream', color: 0x2e9e5b },
  local: { label: 'Local DNS', color: 0xe8a317 },
};

const WINDOW_MS = 60000;
const MAX_ARCS = 14;

export function createConversations(initialTopology) {
  let topology = initialTopology;
  const conversations = new Map();
  const started = performance.now();
  const pulses = [];
  let arcs = new Map();
  let focus = null;
  let selection = null;
  let token = 0;

  const name = (id) => topology.nodes.get(id)?.name ?? id;
  const edgeKey = (a, b) => (topology.edges.has(`${a}|${b}`) ? `${a}|${b}` : `${b}|${a}`);

  const retarget = (next) => {
    topology = next;
    arcs = new Map();
    pulses.length = 0;
    focus = null;
    selection = null;
    conversations.forEach((c, key) => {
      if (!topology.nodes.has(c.src) || !topology.nodes.has(c.dst)) return conversations.delete(key);
      try {
        const hops = topology.path(c.src, c.dst);
        c.nodes = new Set(hops);
        c.edges = new Set(hops.slice(1).map((to, i) => edgeKey(hops[i], to)));
      } catch {
        conversations.delete(key);
      }
    });
  };

  const record = (src, dst, kind, now) => {
    const key = `${src}>${dst}`;
    let c = conversations.get(key);
    if (!c) {
      const hops = topology.path(src, dst);
      c = { key, src, dst, kind, times: [], total: 0, nodes: new Set(hops), edges: new Set(hops.slice(1).map((to, i) => edgeKey(hops[i], to))) };
      conversations.set(key, c);
    }
    c.total += 1;
    c.times.push(now);
    const arc = arcs.get(key);
    if (arc && pulses.length < 300) pulses.push({ path: arc.path, t: 0, color: KIND[kind].color });
  };

  const perMinute = (c, now) => {
    while (c.times.length && c.times[0] < now - WINDOW_MS) c.times.shift();
    return c.times.length / Math.max(Math.min(WINDOW_MS, now - started) / 60000, 1 / 6);
  };

  const involves = (p) => {
    if (p.diveToken !== token) {
      p.diveToken = token;
      p.diveHit = selection.edgeKey
        ? p.segs.some((s) => s.edge.key === selection.edgeKey)
        : p.segs.some((s) => s.from === selection.id || s.to === selection.id);
    }
    return p.diveHit;
  };

  const show = (sel, now) => {
    if (sel !== selection) {
      token += 1;
      pulses.length = 0;
    }
    selection = sel;
    const rows = [...conversations.values()]
      .filter((c) => (sel.edgeKey ? c.edges.has(sel.edgeKey) : c.src === sel.id || c.dst === sel.id || c.nodes.has(sel.id)))
      .map((c) => ({ c, rate: perMinute(c, now), role: sel.edgeKey ? 'through' : c.src === sel.id ? 'out' : c.dst === sel.id ? 'in' : 'through' }))
      .sort((x, y) => y.rate - x.rate || y.c.total - x.c.total);
    focus = { nodes: new Set(sel.id ? [sel.id] : [sel.edge.a, sel.edge.b]), edges: new Set(sel.edgeKey ? [sel.edgeKey] : []) };
    rows.forEach(({ c }) => {
      c.nodes.forEach((id) => focus.nodes.add(id));
      c.edges.forEach((k) => focus.edges.add(k));
    });
    arcs = new Map(rows.slice(0, MAX_ARCS).map(({ c, rate, role }) => {
      const [a, b] = [topology.nodes.get(c.src), topology.nodes.get(c.dst)];
      const points = curveBetween(a, b, 60 + Math.hypot(b.x - a.x, b.y - a.y) * 0.18);
      const text = role === 'out' ? name(c.dst) : role === 'in' ? name(c.src) : `${name(c.src)} → ${name(c.dst)}`;
      return [c.key, { key: c.key, kind: c.kind, rate, text, points, path: measure(points) }];
    }));
    return rows.map(({ c, rate, role }) => ({ src: name(c.src), dst: name(c.dst), kind: c.kind, rate, total: c.total, role }));
  };

  const hide = () => {
    focus = null;
    selection = null;
    arcs = new Map();
    pulses.length = 0;
  };

  const update = (dt) => {
    for (let i = pulses.length - 1; i >= 0; i -= 1) {
      pulses[i].t += dt / 1.4;
      if (pulses[i].t >= 1) pulses.splice(i, 1);
    }
  };

  return {
    retarget,
    record,
    show,
    hide,
    update,
    pulses,
    get arcs() { return [...arcs.values()]; },
    get focus() { return focus; },
    get involves() { return focus && selection ? involves : null; },
  };
}
