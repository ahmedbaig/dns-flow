import { pathD } from './geometry.js';
import { REGIONS, OUTCOMES } from './topology.js';
import { KIND } from './conversations.js';

const NS = 'http://www.w3.org/2000/svg';
const INK = '#1d2433';
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const WIDTH = { device: 7, vlan: 7, trunk: 12, wan: 12, transit: 6, service: 6, internal: 6, module: 4, tunnel: 7, cloud: 3 };

const el = (tag, attrs = {}, parent = null, text = null) => {
  const node = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => v != null && node.setAttribute(k, v));
  if (text != null) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
};

const nodeBounds = (nodes) => {
  const xs = [];
  const ys = [];
  nodes.forEach((n) => {
    xs.push(n.x - (n.w ?? 30) / 2, n.x + (n.w ?? 30) / 2 + (n.shape === 'roundel' ? 190 : 0));
    ys.push(n.y - (n.h ?? 30) / 2 - (n.shape === 'station' ? 90 : 30), n.y + (n.h ?? 30) / 2 + 30);
  });
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

export function createMap(svg, topology, handlers, initial = null) {
  const abort = new AbortController();
  const listen = (type, fn, options = {}) => svg.addEventListener(type, fn, { ...options, signal: abort.signal });
  const view = el('g', { class: 'view' }, svg);
  const layers = Object.fromEntries(['regions', 'edges', 'hits', 'arcs', 'nodes'].map((k) => [k, el('g', { class: k }, view)]));
  const nodeEls = new Map();
  const edgeEls = new Map();
  const live = new Map();
  const transform = { s: 1, x: 0, y: 0 };
  const bounds = nodeBounds(topology.nodes);

  REGIONS.forEach((r, i) => {
    el('rect', { x: r.from, y: -6000, width: r.to - r.from, height: 12000, fill: r.color }, layers.regions);
    el('text', { x: Math.max(r.from, bounds.minX) + 24, y: bounds.minY - 40, class: 'region-label' }, layers.regions, r.name.toUpperCase());
    if (i) el('line', { x1: r.from, x2: r.from, y1: -6000, y2: 6000, class: 'boundary' }, layers.regions);
  });

  topology.edges.forEach((edge) => {
    const d = pathD(edge.path.points);
    const g = el('g', { class: `edge ${edge.kind}`, 'data-edge': edge.key }, layers.edges);
    el('path', { d, stroke: hex(edge.color), 'stroke-width': WIDTH[edge.kind] }, g);
    if (edge.kind === 'tunnel') el('path', { d, class: 'tunnel-core' }, g);
    edgeEls.set(edge.key, g);
    el('path', { d, class: 'hit', 'data-edge': edge.key }, layers.hits);
  });

  const label = (g, x, y, lines, anchor = 'middle', cls = 'node-label') => {
    const t = el('text', { x, y, 'text-anchor': anchor, class: cls }, g);
    lines.forEach(([text, kind], i) => el('tspan', { x, dy: i ? '1.25em' : 0, class: kind }, t, text));
    return t;
  };

  const DRAW = {
    station: (g, n) => {
      el('circle', { r: 7.5, class: 'station-dot', stroke: hex(n.color) }, g);
      const t = el('text', { x: 8, y: -16, transform: 'rotate(-40)', class: 'station-label' }, g);
      el('tspan', { class: 'name' }, t, n.name);
      el('tspan', { class: 'sub', dx: 6 }, t, n.sub);
    },
    vm: (g, n) => {
      el('rect', { x: -18, y: -14, width: 36, height: 28, rx: 5, fill: hex(n.color) }, g);
      el('text', { y: 4, 'text-anchor': 'middle', class: 'vm-text' }, g, n.device?.type === 'cloud' ? 'VM' : 'VPN');
      label(g, 0, 40, [[n.name, 'name'], [[n.sub, n.device?.city, 'WireGuard peer'].filter(Boolean).join(' · '), 'sub']]);
    },
    interchange: (g, n) => {
      el('circle', { r: 11, class: 'ix' }, g);
      if (n.kind === 'vlan') {
        const t = label(g, -20, 36, [[n.name, 'name'], [n.sub, 'sub']], 'end');
        t.querySelector('.name').setAttribute('fill', hex(n.color));
      } else label(g, 0, 38, [[n.name, 'name'], [n.sub, 'sub']]);
    },
    bar: (g, n) => {
      el('rect', { x: -10, y: -n.h / 2, width: 20, height: n.h, rx: 10, class: 'ix' }, g);
      if (n.id === 'trunk') label(g, 22, -n.h / 2 + 8, [[n.name, 'name'], [n.sub, 'sub']], 'start');
      else label(g, 0, n.h / 2 + 30, [[n.name, 'name'], [n.sub, 'sub']]);
    },
    card: (g, n) => {
      el('rect', { x: -n.w / 2, y: -n.h / 2, width: n.w, height: n.h, class: 'card-box' }, g);
      el('rect', { x: -n.w / 2, y: -n.h / 2, width: 6, height: n.h, fill: hex(n.color) }, g);
      el('text', { x: -n.w / 2 + 16, y: -8, class: 'card-name' }, g, n.name);
      el('text', { x: -n.w / 2 + 16, y: 9, class: 'card-sub' }, g, n.sub);
      const value = el('text', { x: n.w / 2 - 12, y: 2, 'text-anchor': 'end', class: 'card-value' }, g, '0.0');
      el('text', { x: n.w / 2 - 12, y: 16, 'text-anchor': 'end', class: 'card-caption' }, g, n.live === 'flows' ? 'flows / s' : 'queries / s');
      const bar = n.id === 'adguard' ? el('g', { transform: `translate(${-n.w / 2 + 16}, ${n.h / 2 - 12})` }, g) : null;
      live.set(n.id, { value, bar, width: n.w * 0.45 });
    },
    module: (g, n) => {
      el('rect', { x: -n.w / 2, y: -n.h / 2, width: n.w, height: n.h, class: 'module-box', stroke: hex(n.color) }, g);
      el('text', { y: 4, 'text-anchor': 'middle', class: 'module-text' }, g, n.name);
    },
    roundel: (g, n) => {
      el('circle', { r: 24, fill: hex(n.color) }, g);
      el('circle', { r: 24, class: 'roundel-ring' }, g);
      el('text', { y: 6, 'text-anchor': 'middle', class: 'roundel-letter' }, g, n.name[0]);
      const t = label(g, 38, -8, [[n.name, 'name'], [n.sub, 'sub']], 'start');
      const rate = el('tspan', { x: 38, dy: '1.3em', class: 'rate' }, t, '');
      live.set(n.id, { rate });
    },
  };

  topology.nodes.forEach((n) => {
    const unknown = n.device?.known === false ? ' unknown' : '';
    const g = el('g', { class: `node ${n.shape} ${n.kind}${n.online === false ? ' offline' : ''}${unknown}`, 'data-node': n.id, transform: `translate(${n.x}, ${n.y})` }, layers.nodes);
    DRAW[n.shape](g, n);
    nodeEls.set(n.id, g);
  });

  let minScale = 0.2;
  const priority = (text) => {
    if (text.classList.contains('region-label')) return 0;
    const g = text.closest('.node');
    if (g.matches('.planet, .network, .service')) return 1;
    if (g.matches('.vlan, .vm')) return 2;
    return g.matches('.offline') ? 4 : 3;
  };

  const footprint = (text) => {
    const r = text.getBoundingClientRect();
    if (!text.classList.contains('station-label')) return [r];
    const size = parseFloat(getComputedStyle(text.querySelector('.name')).fontSize) * transform.s * 1.1;
    const steps = Math.max(2, Math.ceil(Math.hypot(r.width, r.height) / size));
    return Array.from({ length: steps }, (_, i) => {
      const x = r.left + (r.width * i) / (steps - 1);
      const y = r.bottom - (r.height * i) / (steps - 1);
      return { left: x - size / 2, right: x + size / 2, top: y - size / 2, bottom: y + size / 2 };
    });
  };

  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  const cull = () => {
    const texts = [...view.querySelectorAll('.region-label, .node-label, .station-label')];
    texts.forEach((t) => { t.style.visibility = ''; });
    const placed = [];
    texts.sort((a, b) => priority(a) - priority(b)).forEach((t) => {
      if (getComputedStyle(t).display === 'none') return;
      const boxes = footprint(t);
      const forced = t.closest('.node')?.matches('.selected, :hover');
      if (!forced && boxes.some((b) => placed.some((p) => overlaps(b, p)))) {
        t.style.visibility = 'hidden';
        return;
      }
      placed.push(...boxes);
    });
  };

  let cullTimer = null;
  const apply = () => {
    view.setAttribute('transform', `translate(${transform.x}, ${transform.y}) scale(${transform.s})`);
    svg.style.setProperty('--k', Math.min(3.2, Math.max(1, (0.9 / transform.s) ** 0.75)).toFixed(3));
    svg.classList.toggle('far', transform.s < 0.5);
    svg.classList.toggle('farther', transform.s < 0.3);
    clearTimeout(cullTimer);
    cullTimer = setTimeout(cull, 120);
    handlers.onView?.(transform);
  };

  const fit = (mode = 'all') => {
    const { width, height } = svg.getBoundingClientRect();
    const pad = { left: 270, right: 40, top: 70, bottom: 40 };
    const sx = (width - pad.left - pad.right) / (bounds.maxX - bounds.minX);
    const sy = (height - pad.top - pad.bottom) / (bounds.maxY - bounds.minY);
    const s = mode === 'home' ? sy : Math.min(sx, sy);
    minScale = Math.min(sx, sy) * 0.8;
    transform.s = s;
    transform.x = mode === 'home' ? pad.left - bounds.minX * s : pad.left + (width - pad.left - pad.right - (bounds.maxX - bounds.minX) * s) / 2 - bounds.minX * s;
    transform.y = pad.top + (height - pad.top - pad.bottom - (bounds.maxY - bounds.minY) * s) / 2 - bounds.minY * s;
    apply();
  };

  const toWorld = (cx, cy) => {
    const r = svg.getBoundingClientRect();
    return { x: (cx - r.left - transform.x) / transform.s, y: (cy - r.top - transform.y) / transform.s };
  };

  let drag = null;
  listen('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, ox: transform.x, oy: transform.y, moved: false };
    handlers.onHover?.(null);
    svg.setPointerCapture(e.pointerId);
  });
  listen('pointermove', (e) => {
    if (drag) {
      const [dx, dy] = [e.clientX - drag.x, e.clientY - drag.y];
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) {
        transform.x = drag.ox + dx;
        transform.y = drag.oy + dy;
        apply();
      }
      return;
    }
    const target = e.target.closest('[data-node]');
    handlers.onHover?.(target ? target.dataset.node : null, e.clientX, e.clientY);
  });
  listen('pointerup', (e) => {
    const wasDrag = drag?.moved;
    drag = null;
    if (wasDrag) return;
    const world = toWorld(e.clientX, e.clientY);
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const nodeTarget = hit?.closest('[data-node]');
    const edgeTarget = hit?.closest('[data-edge]');
    handlers.onClick?.({ world, node: nodeTarget?.dataset.node, edge: edgeTarget?.dataset.edge });
  });
  listen('pointerleave', () => handlers.onHover?.(null));
  listen('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const [mx, my] = [e.clientX - r.left, e.clientY - r.top];
    handlers.onHover?.(null);
    const s = Math.min(3, Math.max(minScale, transform.s * Math.exp(-e.deltaY * 0.0015)));
    transform.x = mx - ((mx - transform.x) * s) / transform.s;
    transform.y = my - ((my - transform.y) * s) / transform.s;
    transform.s = s;
    apply();
  }, { passive: false });

  const setFocus = (focus, selectedId) => {
    svg.classList.toggle('diving', Boolean(focus));
    nodeEls.forEach((g, id) => {
      g.classList.toggle('on', Boolean(focus?.nodes.has(id)));
      g.classList.toggle('selected', id === selectedId);
    });
    edgeEls.forEach((g, key) => g.classList.toggle('on', Boolean(focus?.edges.has(key))));
  };

  const setArcs = (arcs) => {
    layers.arcs.replaceChildren();
    arcs.forEach((arc, i) => {
      const color = hex(KIND[arc.kind].color);
      el('path', { d: pathD(arc.points), class: 'arc', stroke: color, 'stroke-width': 1.5 + Math.log2(1 + arc.rate) * 1.1 }, layers.arcs);
      if (i >= 5) return;
      const p = arc.points[8 + i * 4];
      const g = el('g', { class: 'arc-label', transform: `translate(${p.x}, ${p.y})` }, layers.arcs);
      const text = `${arc.text} · ${arc.rate.toFixed(1)}/min`;
      const k = parseFloat(svg.style.getPropertyValue('--k')) || 1;
      el('rect', { x: -4 * k, y: -13 * k, width: (text.length * 6.6 + 8) * k, height: 18 * k, stroke: color }, g);
      el('text', { x: 0, y: 0 }, g, text);
    });
  };

  const setLive = (id, { rate, outcomes }) => {
    const entry = live.get(id);
    if (!entry) return;
    if (entry.value) entry.value.textContent = rate.toFixed(1);
    if (entry.rate) entry.rate.textContent = rate > 0 ? `${rate.toFixed(1)} / s` : '';
    if (entry.bar && outcomes) {
      entry.bar.replaceChildren();
      const total = Object.values(outcomes).reduce((a, b) => a + b, 0) || 1;
      let x = 0;
      Object.entries(OUTCOMES).forEach(([k, o]) => {
        const w = ((outcomes[k] || 0) / total) * entry.width;
        el('rect', { x, y: 0, width: w, height: 4, fill: hex(o.color) }, entry.bar);
        x += w;
      });
    }
  };

  const setLabels = (mode) => {
    svg.classList.toggle('labels-all', mode === 'always');
    svg.classList.toggle('labels-off', mode === 'off');
  };

  if (initial) {
    Object.assign(transform, initial);
    apply();
  }

  const destroy = () => {
    abort.abort();
    svg.replaceChildren();
  };

  const centerOn = (x, y) => {
    const { width, height } = svg.getBoundingClientRect();
    transform.s = Math.max(transform.s, 0.8);
    transform.x = width / 2 - x * transform.s;
    transform.y = height / 2 - y * transform.s;
    apply();
  };

  return { fit, setFocus, setArcs, setLive, setLabels, centerOn, transform, toWorld, destroy };
}
