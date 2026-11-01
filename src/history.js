import { ZONES } from './topology.js';
import { api } from './live.js';

// The last 12 or 24 hours of lookups, stacked by VLAN in each line's colour,
// with blocked lookups as a red line on top. Data from /api/history (a ring
// buffer in the bridge, one bucket a minute), shown as 144 bins: ten minutes
// each over 24 h, five over 12 h, so the stack reads instead of bristling.

const BINS = 144;
const W = 236;
const H = 80;
const BLOCKED = '#dc241f';
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const ORDER = [...ZONES.filter((z) => z.id !== 'unassigned').map((z) => ({ id: z.id, name: z.name, color: hex(z.color) })),
  { id: 'other', name: 'Other', color: '#b0b6be' }];

const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmt = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

export function createHistory() {
  const panel = document.getElementById('history');
  const svg = document.getElementById('history-chart');
  const time = document.getElementById('history-time');
  const value = document.getElementById('history-value');
  let hours = 24;
  let bins = [];
  const bin = () => (hours * 60 * 60 * 1000) / BINS;

  const toBins = ({ buckets }) => {
    const step = bin();
    const end = Math.floor(Date.now() / step) * step + step;
    const start = end - BINS * step;
    const out = [];
    for (let t = start; t < end; t += step) out.push({ at: t, zones: {}, blocked: 0, total: 0, seen: false });
    buckets.forEach((b) => {
      const into = out[Math.floor((b.at - start) / step)];
      if (!into) return;
      into.seen = true;
      into.blocked += b.blocked;
      Object.entries(b.zones).forEach(([zone, n]) => {
        const id = ORDER.some((z) => z.id === zone) ? zone : 'other';
        into.zones[id] = (into.zones[id] ?? 0) + n;
        into.total += n;
      });
    });
    return out;
  };

  const draw = () => {
    const peak = Math.max(1, ...bins.map((b) => b.total));
    const x = (i) => (i / (bins.length - 1)) * W;
    const y = (n) => H - (n / peak) * (H - 4);
    const base = bins.map(() => 0);
    const paths = ORDER.map((z) => {
      const top = bins.map((b, i) => base[i] + (b.zones[z.id] ?? 0));
      const upper = top.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      const lower = base.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse();
      top.forEach((v, i) => { base[i] = v; });
      return bins.some((b) => b.zones[z.id])
        ?`<path d="M${upper.join('L')}L${lower.join('L')}Z" fill="${z.color}" fill-opacity="0.85"><title>${z.name}</title></path>`
        : '';
    });
    const gaps = bins.map((b, i) => (b.seen ? '' : `<rect x="${x(i) - W / bins.length / 2}" y="0" width="${W / bins.length}" height="${H}" fill="#f1f3f6"/>`));
    const blocked = bins.map((b, i) => `${x(i).toFixed(1)},${y(b.blocked).toFixed(1)}`).join('L');
    svg.innerHTML = `${gaps.join('')}${paths.join('')}<path d="M${blocked}" fill="none" stroke="${BLOCKED}" stroke-width="1.2"/>
      <line id="history-cursor" x1="0" x2="0" y1="0" y2="${H}" stroke="#11161f" stroke-width="1" visibility="hidden"/>`;
    readout(null);
  };

  const readout = (b) => {
    if (!b) {
      const total = bins.reduce((n, x) => n + x.total, 0);
      const blocked = bins.reduce((n, x) => n + x.blocked, 0);
      time.textContent = `${fmt(total)} lookups`;
      value.textContent = `${total ? Math.round((blocked / total) * 100) : 0}% blocked`;
      return;
    }
    const busiest = ORDER.filter((z) => b.zones[z.id]).sort((x, y) => b.zones[y.id] - b.zones[x.id])[0];
    time.textContent = `${clock(b.at)}–${clock(b.at + bin())}`;
    value.textContent = b.seen ? `${fmt(b.total)}${busiest ? ` · ${busiest.name.replace(/^VLAN \d+ /, '')}` : ''}` : 'no data';
    value.title = b.seen ? ORDER.filter((z) => b.zones[z.id]).map((z) => `${z.name}: ${b.zones[z.id]}`).concat(`Blocked: ${b.blocked}`).join('\n') : '';
  };

  const hover = (e) => {
    if (!bins.length) return;
    const r = svg.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (bins.length - 1));
    const at = Math.max(0, Math.min(bins.length - 1, i));
    const cursor = svg.querySelector('#history-cursor');
    const cx = (at / (bins.length - 1)) * W;
    cursor?.setAttribute('x1', cx);
    cursor?.setAttribute('x2', cx);
    cursor?.setAttribute('visibility', 'visible');
    readout(bins[at]);
  };
  const leave = () => {
    svg.querySelector('#history-cursor')?.setAttribute('visibility', 'hidden');
    readout(null);
  };

  const load = async () => {
    try {
      bins = toBins(await api('GET', `api/history?hours=${hours}`));
      draw();
    } catch {
      time.textContent = 'History unavailable';
      value.textContent = '';
    }
  };

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.addEventListener('pointermove', hover);
  svg.addEventListener('pointerleave', leave);
  panel.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b || Number(b.dataset.v) === hours) return;
    hours = Number(b.dataset.v);
    load();
  });
  load();
  setInterval(load, 60000);
}
