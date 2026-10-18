import { pointAt } from './geometry.js';
import { OUTCOMES } from './topology.js';

const TRAIL = 3;
const TRAIL_GAP = 0.045;
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export function createDots({ onArrive, onFinish, max = 2500 }) {
  const particles = [];
  const bursts = [];
  const at = {};

  const place = (p, time, out) => {
    const t = Math.min(Math.max(time, 0), p.total);
    let i = 0;
    while (i < p.segs.length - 1 && t > p.ends[i]) i += 1;
    const seg = p.segs[i];
    const u = (t - (p.ends[i] - seg.dur)) / seg.dur;
    pointAt(seg.edge.path, seg.reverse ? 1 - u : u, out);
    if (seg.reverse) out.angle += Math.PI;
    return out;
  };

  const spawn = (ev, segs) => {
    if (particles.length >= max) particles.shift();
    let acc = 0;
    const ends = segs.map((s) => (acc += s.dur));
    const color = hex(ev.kind === 'data' ? ev.color : OUTCOMES[ev.outcome].color);
    const p = { ev, kind: ev.kind, segs, ends, total: acc, elapsed: 0, seg: 0, color, pos: { x: 0, y: 0, angle: 0 } };
    place(p, 0, p.pos);
    particles.push(p);
    return p;
  };

  const update = (dt) => {
    for (let k = particles.length - 1; k >= 0; k -= 1) {
      const p = particles[k];
      p.elapsed += dt;
      while (p.seg < p.segs.length && p.elapsed >= p.ends[p.seg]) {
        p.segs[p.seg].edge.heat += 1;
        onArrive(p.segs[p.seg].to, p);
        p.seg += 1;
      }
      place(p, p.elapsed, p.pos);
      if (p.elapsed >= p.total) {
        particles.splice(k, 1);
        if (p.kind === 'dns' && p.ev.outcome === 'blocked') bursts.push({ x: p.pos.x, y: p.pos.y, t: 0 });
        onFinish(p);
      }
    }
    for (let k = bursts.length - 1; k >= 0; k -= 1) {
      bursts[k].t += dt / 0.6;
      if (bursts[k].t >= 1) bursts.splice(k, 1);
    }
  };

  const drawDot = (ctx, p, x, y, angle, scale, alpha) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    if (p.kind === 'data') {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.roundRect(-8 * scale, -3.2 * scale, 16 * scale, 6.4 * scale, 3.2 * scale);
      ctx.restore();
    } else ctx.arc(x, y, 5 * scale, 0, Math.PI * 2);
    ctx.fill();
    if (alpha === 1) ctx.stroke();
  };

  const draw = (ctx, { selected, involves, pulses }) => {
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#ffffff';
    particles.forEach((p) => {
      if (involves && !involves(p)) return;
      const scale = p === selected ? 1.7 : 1;
      for (let j = TRAIL; j >= 1; j -= 1) {
        place(p, p.elapsed - j * TRAIL_GAP, at);
        drawDot(ctx, p, at.x, at.y, at.angle, scale * (1 - j * 0.18), 0.18 * (TRAIL + 1 - j));
      }
      drawDot(ctx, p, p.pos.x, p.pos.y, p.pos.angle, scale, 1);
      if (p === selected) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#1d2433';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.pos.x, p.pos.y, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.6;
      }
    });
    bursts.forEach((b) => {
      ctx.globalAlpha = 1 - b.t;
      ctx.strokeStyle = hex(OUTCOMES.blocked.color);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 6 + b.t * 18, 0, Math.PI * 2);
      ctx.stroke();
    });
    pulses.forEach((pulse) => {
      pointAt(pulse.path, pulse.t, at);
      ctx.globalAlpha = Math.sin(pulse.t * Math.PI) * 0.9 + 0.1;
      ctx.fillStyle = hex(pulse.color);
      ctx.beginPath();
      ctx.arc(at.x, at.y, 6, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  };

  const nearest = (x, y, radius, involves) => {
    let best = null;
    let bestDist = radius;
    particles.forEach((p) => {
      if (involves && !involves(p)) return;
      const d = Math.hypot(p.pos.x - x, p.pos.y - y);
      if (d < bestDist) [best, bestDist] = [p, d];
    });
    return best;
  };

  const retarget = (route) => {
    for (let k = particles.length - 1; k >= 0; k -= 1) {
      const p = particles[k];
      const segs = route(p.ev);
      if (!segs) {
        particles.splice(k, 1);
        continue;
      }
      let acc = 0;
      p.segs = segs;
      p.ends = segs.map((s) => (acc += s.dur));
      p.total = acc;
      p.elapsed = Math.min(p.elapsed, acc * 0.999);
      p.seg = p.ends.findIndex((end) => end > p.elapsed);
      place(p, p.elapsed, p.pos);
    }
    bursts.length = 0;
  };

  return { particles, spawn, update, draw, nearest, retarget, clear: () => { particles.length = 0; bursts.length = 0; } };
}
