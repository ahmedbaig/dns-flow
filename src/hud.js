import { OUTCOMES, ZONES, DEVICE_TYPES, CLIENT_ENTRIES, TRAFFIC, ratePerSecond } from './topology.js';
import { KIND } from './conversations.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const fmt = new Intl.NumberFormat('en-AU');
const SECOND_LEVEL = new Set(['com', 'net', 'org', 'co', 'gov', 'edu']);

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const maskName = (qname, mode) => {
  if (mode === 'full') return qname;
  if (mode === 'hidden') return '••••••••';
  if (qname.endsWith('.in-addr.arpa')) return '•.in-addr.arpa';
  const parts = qname.split('.');
  const keep = parts.length > 2 && SECOND_LEVEL.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2 ? 3 : 2;
  return parts.length > keep ? `•.${parts.slice(-keep).join('.')}` : qname;
};

const formatMs = (ms) => (ms < 1 ? `${ms.toFixed(2)} ms` : `${ms.toFixed(ms < 10 ? 1 : 0)} ms`);

const upstreamLabel = (ev) => {
  if (ev.outcome === 'forwarded') return ev.upstream === 'cloudflare' ? 'tls://1.1.1.1 via Unbound' : 'tls://dns.quad9.net via Unbound';
  if (ev.outcome === 'internal') return '10.10.20.1:53 (UX7)';
  return '—';
};

const clock = (ts) => new Date(ts).toLocaleTimeString('en-AU', { hour12: false });

const ipToInt = (ip) => ip.split('.').reduce((a, b) => a * 256 + Number(b), 0);
const inSubnet = (ip, cidr) => {
  const [base, bits] = cidr.split('/');
  const size = 2 ** (32 - Number(bits));
  return Math.floor(ipToInt(ip) / size) === Math.floor(ipToInt(base) / size);
};

const ago = (seconds) => (seconds < 90 ? `${Math.round(seconds)} s ago` : `${Math.round(seconds / 60)} min ago`);

const rows = (pairs) => pairs.filter(Boolean).map(([k, v, cls]) => `<dt>${k}</dt><dd${cls ? ` class="${cls}"` : ''}>${v}</dd>`).join('');

export function createHud({ state, simulator, world, totals, feed, live, flows }) {
  const handlers = {};
  const emit = (name, arg) => handlers[name]?.(arg);
  const inspect = $('inspect');
  const tip = $('tooltip');
  const nodeName = (id) => world.topology.nodes.get(id)?.name ?? id;

  const toggleList = (el, items, hidden) => {
    el.innerHTML = items.map(({ id, label, color }) => `
      <li data-id="${id}"><span class="tick" style="background:${hex(color)}"></span>${escapeHtml(label)}<span class="count">0</span></li>`).join('');
    el.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => {
      const { id } = li.dataset;
      hidden.has(id) ? hidden.delete(id) : hidden.add(id);
      li.classList.toggle('off', hidden.has(id));
    }));
  };

  const mountLists = () => {
    toggleList($('legend'), [...Object.entries(OUTCOMES).map(([id, o]) => ({ id, label: o.label, color: o.color })), TRAFFIC], state.hiddenOutcomes);
    toggleList($('zones'), ZONES.map((z) => ({ id: z.id, label: z.name, color: z.color })), state.hiddenZones);
  };

  const togglePause = () => {
    state.paused = !state.paused;
    $('pause').textContent = state.paused ? 'Resume' : 'Pause';
    document.body.classList.toggle('paused', state.paused);
  };

  $('rate').addEventListener('input', (e) => {
    simulator.state.rate = Number(e.target.value);
    $('rate-out').textContent = e.target.value;
  });
  $('speed').addEventListener('input', (e) => {
    state.speed = Number(e.target.value);
    $('speed-out').textContent = `${state.speed.toFixed(1)}×`;
  });
  document.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    state[seg.dataset.key] = button.dataset.v;
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === button));
    renderInspect();
  }));
  $('pause').addEventListener('click', togglePause);
  $('storm').addEventListener('click', () => simulator.storm(10));
  $('reset-view').addEventListener('click', () => emit('reset-view'));
  $('feed-list').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    const p = li && live.get(Number(li.dataset.id));
    if (p) emit('select-particle', p);
  });
  inspect.addEventListener('click', (e) => {
    if (e.target.closest('.close')) emit('close');
  });

  const head = (title, kind, color) => `
    <div class="head"><span class="tick" style="background:${hex(color)}"></span><h3>${escapeHtml(title)}</h3><span class="kind">${escapeHtml(kind)}</span><button class="close">CLOSE</button></div>`;

  const connectionHtml = (p) => {
    const { ev } = p;
    const hops = [p.segs[0].from, ...p.segs.map((s) => s.to)];
    const at = p.done ? hops.length - 1 : p.seg;
    const path = hops.map((id, i) => (i === at ? `<b>${escapeHtml(nodeName(id))}</b>` : escapeHtml(nodeName(id)))).join(' → ');
    return `
      ${head(ev.destName, 'CONNECTION', ev.color)}
      <dl>${rows([
        ['CLIENT', `${escapeHtml(ev.client.name)} · ${ev.client.ip}`],
        ['RESOLVED', escapeHtml(maskName(ev.qname, state.names))],
        ['DESTINATION', escapeHtml(ev.destName)],
        ['TIME', clock(ev.ts)],
      ])}</dl>
      <div class="path">${path}</div>
      <div class="status">${p.done ? 'COMPLETE' : `IN FLIGHT · HOP ${p.seg + 1}/${p.segs.length}${state.follow ? ' · FOLLOWING' : ''}`}</div>`;
  };

  const particleHtml = (p) => {
    const { ev } = p;
    if (ev.kind === 'data') return connectionHtml(p);
    const zone = ZONES.find((z) => z.id === ev.client.zone);
    const hops = [p.segs[0].from, ...p.segs.map((s) => s.to)];
    const at = p.done ? hops.length - 1 : p.seg;
    const path = hops.map((id, i) => (i === at ? `<b>${escapeHtml(nodeName(id))}</b>` : escapeHtml(nodeName(id)))).join(' → ');
    const status = p.done
      ? (ev.outcome === 'blocked' ? 'BLOCKED · 0.0.0.0 RETURNED' : 'ANSWERED')
      : `IN FLIGHT · HOP ${p.seg + 1}/${p.segs.length}${state.follow ? ' · FOLLOWING' : ''}`;
    return `
      ${head(maskName(ev.qname, state.names), ev.qtype, OUTCOMES[ev.outcome].color)}
      <dl>${rows([
        ['CLIENT', `${escapeHtml(ev.client.name)} · ${ev.client.ip}`],
        ['NETWORK', escapeHtml(zone.name)],
        ['OUTCOME', `<span style="color:${hex(OUTCOMES[ev.outcome].color)}">${OUTCOMES[ev.outcome].label}</span>`],
        ['UPSTREAM', upstreamLabel(ev)],
        ev.tunnel && ['VIA', ev.tunnel.nat === 'shared'
          ? `WireGuard tunnel · <span class="warn">NAT shared by ${escapeHtml(ev.tunnel.peers.join(', '))}, best guess</span>`
          : 'WireGuard tunnel · only active peer'],
        ev.ips?.length && ['ANSWER', escapeHtml(ev.ips.join(', '))],
        ev.net && ['NETWORK', `${escapeHtml(ev.net.org)} · AS${ev.net.asn} · registered ${escapeHtml(ev.net.country)}`],
        ['LATENCY', formatMs(ev.ms)],
        ['TIME', clock(ev.ts)],
      ])}</dl>
      <div class="path">${path}</div>
      <div class="status">${status}</div>`;
  };

  const statsBlock = (node, now) => {
    const { stats } = node;
    const bars = Object.entries(OUTCOMES)
      .map(([id, o]) => `<span style="width:${((stats.outcomes[id] || 0) / Math.max(stats.total, 1)) * 100}%;background:${hex(o.color)}"></span>`)
      .join('');
    const top = [...stats.domains].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, n]) => `<li><span>${escapeHtml(maskName(name, state.names))}</span><span>${fmt.format(n)}</span></li>`).join('');
    const blocked = stats.total ? ((stats.outcomes.blocked || 0) / stats.total) * 100 : 0;
    return `
      <h2>DNS</h2>
      <dl>${rows([
        ['QUERIES', fmt.format(stats.total)],
        ['RATE', `${ratePerSecond(stats, now).toFixed(1)} q/s`],
        ['BLOCKED', `${blocked.toFixed(1)}%`],
      ])}</dl>
      <div class="bars">${bars}</div>
      <h2>TOP NAMES</h2>
      <ul class="top">${top || '<li><span>none yet</span></li>'}</ul>`;
  };

  const attachment = (node) => (node.device.zone === 'vpn' ? 'WireGuard tunnel → Wireguard VPN CT (VLAN 50)' : null);

  const talkHtml = () => {
    const list = state.dive ?? [];
    if (!list.length) return '<h2>TALKING TO</h2><ul class="top"><li><span>no traffic yet</span></li></ul>';
    const items = list.slice(0, 24).map((r) => {
      const who = r.role === 'out' ? `→ ${r.dst}` : r.role === 'in' ? `← ${r.src}` : `${r.src} → ${r.dst}`;
      return `<li><span class="tick" style="background:${hex(KIND[r.kind].color)}"></span><span>${escapeHtml(who)}</span><span>${r.rate.toFixed(1)}/min</span></li>`;
    }).join('');
    return `<h2>TALKING TO · ${list.length}</h2><ul class="talk">${items}</ul>`;
  };

  const trackHtml = (sel) => `
    ${head(sel.name, 'TRACK', sel.color)}
    <dl>${rows([['LINK', sel.edge.kind], ['CONVERSATIONS', String((state.dive ?? []).length)]])}</dl>
    ${talkHtml()}`;

  const typeOptions = (current) => Object.entries(DEVICE_TYPES)
    .map(([k, v]) => `<option value="${k}"${k === current ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');

  const nameForm = (d) => {
    if (!state.liveMode) return '';
    if (!d.known) {
      const others = (state.devices ?? []).filter((x) => !x.hidden).sort((a, b) => a.name.localeCompare(b.name))
        .map((x) => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');
      return `
        <form class="device-form" data-action="name" data-station="${escapeHtml(d.id)}">
          <h2>NAME THIS DEVICE</h2>
          <input name="name" placeholder="e.g. Living room TV" value="" autocomplete="off" required>
          <div class="form-row"><select name="type">${typeOptions(d.hostname && /iphone|android|pixel|galaxy/i.test(d.hostname) ? 'phone' : 'laptop')}</select>
          <input name="owner" placeholder="Owner (optional)" autocomplete="off"></div>
          <button type="submit">Save name</button>
        </form>
        <form class="device-form" data-action="assign" data-station="${escapeHtml(d.id)}">
          <h2>OR SAME DEVICE AS</h2>
          <div class="form-row"><select name="deviceId">${others}</select><button type="submit">Link</button></div>
        </form>`;
    }
    if (!d.deviceId) return '';
    return `
      <form class="device-form" data-action="update" data-device="${d.deviceId}">
        <h2>EDIT DEVICE</h2>
        <input name="name" value="${escapeHtml(d.label)}" autocomplete="off" required>
        <div class="form-row"><select name="type">${typeOptions(d.type)}</select>
        <input name="owner" value="${escapeHtml(d.owner ?? '')}" placeholder="Owner" autocomplete="off"></div>
        <input name="notes" value="${escapeHtml(d.notes ?? '')}" placeholder="Notes" autocomplete="off">
        <label class="check"><input type="checkbox" name="hidden"> Hide from map</label>
        <button type="submit">Save</button>
      </form>`;
  };

  const since = (ms) => {
    if (!ms) return 'never';
    const s = (Date.now() - ms) / 1000;
    return s < 90 ? `${Math.round(s)} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
  };

  const deviceHtml = (node, now) => {
    const d = node.device;
    const zone = ZONES.find((z) => z.id === d.zone);
    const outside = d.ip && zone && !inSubnet(d.ip, zone.subnet);
    const age = state.simTime - (node.lastSeen ?? -Infinity);
    const arp = d.zone === 'vpn' ? 'n/a · layer 3 peer, never in ARP'
      : !d.online ? 'absent · not seen recently'
        : state.liveMode ? `seen ${since(d.lastSeen)}`
          : Number.isFinite(age) && age < 30 ? `REACHABLE · ${ago(age)}` : 'STALE';
    const mac = d.mac ? `${d.mac}${d.privateMac ? ' <span class="warn">(private)</span>' : ''}` : d.macTail ? `…:${d.macTail}` : '<span class="warn">not seen yet</span>';
    return `
      ${head(d.label, d.known === false ? 'UNKNOWN' : DEVICE_TYPES[d.type] ?? d.type, node.color)}
      ${nameForm(d)}
      <dl>${rows([
        d.ip && ['IP', d.ip],
        d.zone !== 'vpn' && ['MAC', mac],
        d.hostname && ['DHCP NAME', escapeHtml(d.hostname)],
        d.owner && ['OWNER', escapeHtml(d.owner)],
        d.ap && ['WI-FI', `${escapeHtml(d.ap === 'ux7' ? 'UniFi Express 7' : `AP ${d.ap}`)}${d.radio ? ` · ${escapeHtml(d.radio)}` : ''}${d.rssi ? ` · ${d.rssi} dBm` : ''}`],
        d.peer && ['VPN PEER', escapeHtml(d.peer)],
        d.endpoint && ['CONNECTING FROM', `${escapeHtml(d.endpoint)}${d.city ? ` · ${escapeHtml(d.city)}` : ''}${d.asn ? ` · ${escapeHtml(d.asn)}` : ''}`],
        d.handshakeAge != null && ['HANDSHAKE', `${Math.round(d.handshakeAge)} s ago`],
        d.vendor && ['VENDOR', escapeHtml(d.vendor)],
        zone && ['NETWORK', `${escapeHtml(zone.name)} · ${zone.iface}`],
        outside && ['', `IP outside ${zone.subnet}`, 'warn'],
        d.ssid && ['WI-FI', `${escapeHtml(d.via)} · ${escapeHtml(d.ssid)}`],
        d.channel && ['RADIO', `${escapeHtml(d.tech)} · ch ${escapeHtml(d.channel)}`],
        d.experience && ['EXPERIENCE', escapeHtml(d.experience)],
        attachment(node) && ['WIRED TO', attachment(node)],
        d.online && d.activity && ['ACTIVITY', `${d.activity} · ↓ ${d.down} · ↑ ${d.up}`],
        d.usage && ['24H USAGE', d.usage],
        d.online ? d.uptime && ['UPTIME', d.uptime] : d.lastSeen && ['LAST SEEN', `<span class="warn">${escapeHtml(typeof d.lastSeen === 'number' ? since(d.lastSeen) : d.lastSeen)}</span>`],
        d.note && ['NOTE', escapeHtml(d.note)],
        ['ARP', arp],
      ])}</dl>
      ${talkHtml()}
      ${statsBlock(node, now)}`;
  };

  const childrenHtml = (node) => {
    const children = [...world.topology.edges.values()].filter((e) => e.b === node.id && !e.decor);
    if (!children.length) return '';
    const items = children
      .sort((x, y) => (x.bPort ?? 99) - (y.bPort ?? 99))
      .map((e) => `<li><span>${escapeHtml(nodeName(e.a))}</span><span>${e.kind.toUpperCase()}</span></li>`)
      .join('');
    return `<h2>CONNECTED · ${children.length}</h2><ul class="top">${items}</ul>`;
  };

  const networkHtml = (node, now) => {
    const n = node.network;
    const others = (state.destinations ?? []).filter((d) => d.id !== n.id && d.id !== 'other')
      .map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`).join('');
    const form = state.liveMode && n.id !== 'other' ? `
      <form class="device-form" data-action="network-update" data-network="${escapeHtml(n.id)}">
        <h2>EDIT NETWORK</h2>
        <input name="name" value="${escapeHtml(n.name)}" autocomplete="off" required>
        <label class="check"><input type="checkbox" name="pinned"${n.pinned ? ' checked' : ''}> Always show on the map</label>
        <label class="check"><input type="checkbox" name="hidden"${n.hidden ? ' checked' : ''}> Hide from the map</label>
        <button type="submit">Save</button>
      </form>
      <form class="device-form" data-action="network-merge" data-network="${escapeHtml(n.id)}">
        <h2>MERGE INTO</h2>
        <div class="form-row"><select name="into">${others}</select><button type="submit">Merge</button></div>
      </form>` : '';
    const domains = (n.domains ?? []).map(({ d, n: count }) => `<li><span>${escapeHtml(maskName(d, state.names))}</span><span>${fmt.format(count)}</span></li>`).join('');
    return `
      ${head(n.name, 'INTERNET', node.color)}
      ${form}
      <dl>${rows([
        n.sub && ['DETAIL', escapeHtml(n.sub)],
        ...(n.asns ?? []).slice(0, 4).map((a, i) => [i ? '' : 'OWNER', `AS${a.asn} · ${escapeHtml(a.org)}`]),
        n.recent != null && ['LAST 10 MIN', `${fmt.format(n.recent)} lookups`],
        n.total != null && ['SINCE START', `${fmt.format(n.total)} lookups · ${fmt.format(n.ips ?? 0)} IPs`],
      ])}</dl>
      ${domains ? `<h2>TOP DOMAINS</h2><ul class="top">${domains}</ul>` : ''}
      ${talkHtml()}`;
  };

  const nodeHtml = (node, now) => {
    if (node.device) return deviceHtml(node, now);
    if (node.network?.asns) return networkHtml(node, now);
    const entry = node.id === 'adguard' ? CLIENT_ENTRIES.adguard : CLIENT_ENTRIES[node.id];
    const zone = node.kind === 'vlan' && ZONES.find((z) => z.id === node.zone);
    const kind = { vlan: 'NETWORK', network: 'EDGE / WAN', planet: 'INTERNET', service: 'SERVICE' }[node.kind] ?? node.kind;
    return `
      ${head(node.name, kind, node.color)}
      <dl>${rows([
        ['DETAIL', escapeHtml(node.sub)],
        zone && ['INTERFACE', zone.iface],
        zone && ['CLIENTS', String(node.members)],
        entry && ['UNIFI ENTRY', `${escapeHtml(entry.name)} · ${entry.ip}`],
        entry && ['UPLINK', escapeHtml(entry.via === 'wired' ? 'wired' : entry.via)],
        entry?.usage && ['24H USAGE', entry.usage],
        entry && ['UPTIME', entry.uptime],
      ])}</dl>
      ${talkHtml()}
      ${childrenHtml(node)}
      ${statsBlock(node, now)}`;
  };

  function renderInspect(now = performance.now()) {
    const sel = state.selected;
    inspect.classList.toggle('hidden', !sel);
    if (!sel) return;
    inspect.innerHTML = sel.ev ? particleHtml(sel) : sel.edgeKey ? trackHtml(sel) : nodeHtml(sel, now);
  }

  const renderFeed = () => {
    $('feed-list').innerHTML = feed.map((ev) => `
      <li data-id="${ev.id}" class="${live.has(ev.id) ? '' : 'gone'}">
        <span style="background:${hex(OUTCOMES[ev.outcome].color)}"></span>
        <span class="t">${clock(ev.ts)}</span>
        <span>${escapeHtml(ev.client.name)}</span>
        <span>${escapeHtml(maskName(ev.qname, state.names))}</span>
        <span class="o" style="color:${hex(OUTCOMES[ev.outcome].color)}">${ev.outcome}</span>
      </li>`).join('');
  };

  const refresh = (now, connectionRate = 0) => {
    while (totals.recent.length && totals.recent[0] < now - 5000) totals.recent.shift();
    $('kpi-qps').textContent = (totals.recent.length / 5).toFixed(1);
    $('kpi-total').textContent = fmt.format(totals.all);
    $('kpi-block').textContent = `${totals.all ? (((totals.outcomes.blocked || 0) / totals.all) * 100).toFixed(1) : 0}%`;
    $('kpi-live').textContent = fmt.format(flows.particles.length);
    $('kpi-conn').textContent = connectionRate.toFixed(1);
    $('legend').querySelectorAll('li').forEach((li) => { li.querySelector('.count').textContent = fmt.format(totals.outcomes[li.dataset.id] || 0); });
    $('zones').querySelectorAll('li').forEach((li) => { li.querySelector('.count').textContent = fmt.format(totals.zones[li.dataset.id] || 0); });
    $('storm').classList.toggle('on', simulator.state.storm > 0);
    world.topology.nodes.forEach((node) => {
      const rate = ratePerSecond(node.stats, now) + (node.traffic ? node.traffic.filter((t) => t > now - 10000).length / 10 : 0);
      if (node.rateEl && (node.kind === 'service' || node.kind === 'planet')) node.rateEl.textContent = `${rate.toFixed(1)} / s`;
    });
    if (!$('feed').matches(':hover')) renderFeed();
    if (!inspect.matches(':hover') && !inspect.contains(document.activeElement)) renderInspect(now);
  };

  inspect.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form));
    if (form.dataset.action === 'update') data.hidden = form.querySelector('[name="hidden"]').checked;
    if (form.dataset.action === 'network-update') {
      data.pinned = form.querySelector('[name="pinned"]').checked;
      data.hidden = form.querySelector('[name="hidden"]').checked;
    }
    emit('device-form', { action: form.dataset.action, station: form.dataset.station, device: form.dataset.device, network: form.dataset.network, data });
  });

  const setUnknown = (stations) => {
    const list = $('unknown');
    if (!list) return;
    const unknown = stations.filter((s) => !s.known).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
    $('unknown-count').textContent = unknown.length ? `· ${unknown.length}` : '';
    list.innerHTML = unknown.slice(0, 12).map((s) => `
      <li data-node="${escapeHtml(s.id)}"><span class="tick" style="background:#e8a317"></span>${escapeHtml(s.hostname ?? s.mac ?? s.ip)}<span class="count">${escapeHtml(s.ip ?? '')}</span></li>`).join('')
      || '<li class="empty">none — every device is named</li>';
  };
  $('unknown')?.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-node]');
    if (li) emit('select-node', li.dataset.node);
  });

  const tooltip = (node, x, y) => {
    tip.classList.toggle('hidden', !node);
    if (!node) return;
    const what = node.device ? `${DEVICE_TYPES[node.device.type] ?? node.device.type} · ${node.sub}` : node.sub;
    tip.textContent = `${node.name} · ${what} · ${ratePerSecond(node.stats, performance.now()).toFixed(1)} q/s`;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };

  return {
    on: (name, fn) => { handlers[name] = fn; },
    mountLists,
    setUnknown,
    togglePause,
    renderInspect,
    refresh,
    tooltip,
  };
}
