export const pt = (x, y) => ({ x, y });

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const toward = (from, to, t) => pt(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
const quad = (a, c, b, t) => pt(
  (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t ** 2 * b.x,
  (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t ** 2 * b.y,
);

export const octilinear = (a, b, xFirst = true) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const [adx, ady] = [Math.abs(dx), Math.abs(dy)];
  const [sx, sy] = [Math.sign(dx), Math.sign(dy)];
  if (xFirst ? adx >= ady : adx > ady) {
    const h = (adx - ady) / 2;
    return [a, pt(a.x + sx * h, a.y), pt(a.x + sx * (h + ady), b.y), b];
  }
  const v = (ady - adx) / 2;
  return [a, pt(a.x, a.y + sy * v), pt(b.x, a.y + sy * (v + adx)), b];
};

export const smooth = (points, radius = 22) => {
  const clean = points.filter((p, i) => i === 0 || dist(p, points[i - 1]) > 0.5);
  if (clean.length < 3) return clean;
  const out = [clean[0]];
  for (let i = 1; i < clean.length - 1; i += 1) {
    const [p0, p1, p2] = [clean[i - 1], clean[i], clean[i + 1]];
    const r = Math.min(radius, dist(p0, p1) / 2, dist(p1, p2) / 2);
    const enter = toward(p1, p0, r / dist(p0, p1));
    const exit = toward(p1, p2, r / dist(p1, p2));
    for (let k = 0; k <= 8; k += 1) out.push(quad(enter, p1, exit, k / 8));
  }
  out.push(clean[clean.length - 1]);
  return out;
};

export const measure = (points) => {
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1] + dist(points[i - 1], points[i]));
  return { points, lengths, total: lengths[lengths.length - 1] };
};

export const pointAt = (path, u, out = {}) => {
  const d = Math.min(Math.max(u, 0), 1) * path.total;
  let lo = 0;
  let hi = path.lengths.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.lengths[mid] < d) lo = mid;
    else hi = mid;
  }
  const a = path.points[lo];
  const b = path.points[hi];
  const span = path.lengths[hi] - path.lengths[lo] || 1;
  const t = (d - path.lengths[lo]) / span;
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.angle = Math.atan2(b.y - a.y, b.x - a.x);
  return out;
};

export const pathD = (points) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

export const curveBetween = (a, b, lift) => {
  const c = pt((a.x + b.x) / 2, Math.min(a.y, b.y) - lift);
  return Array.from({ length: 33 }, (_, i) => quad(a, c, b, i / 32));
};
