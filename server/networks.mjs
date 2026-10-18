const BRANDS = {
  15169: ['google', 'Google', 0x4285f4], 396982: ['google', 'Google', 0x4285f4], 36040: ['google', 'Google', 0x4285f4],
  16509: ['aws', 'AWS', 0xff9900], 14618: ['aws', 'AWS', 0xff9900],
  8075: ['microsoft', 'Microsoft', 0x00a4ef], 8068: ['microsoft', 'Microsoft', 0x00a4ef],
  714: ['apple', 'Apple', 0x8e8e93], 6185: ['apple', 'Apple', 0x8e8e93],
  13335: ['cloudflare', 'Cloudflare', 0xf38020],
  20940: ['akamai', 'Akamai', 0x0096d6], 16625: ['akamai', 'Akamai', 0x0096d6],
  54113: ['fastly', 'Fastly', 0xff282d],
  2906: ['netflix', 'Netflix', 0xe50914],
  32934: ['meta', 'Meta', 0x0866ff],
  36459: ['github', 'GitHub', 0x24292f],
  31898: ['oracle', 'Oracle Cloud', 0xc74634],
  19281: ['quad9', 'Quad9', 0xd6336c],
  1221: ['telstra', 'Telstra', 0x0099f8],
};

const PINNED = {
  cloudflare: { name: 'Cloudflare', color: 0xf38020, sub: '1.1.1.1 · DoT resolver' },
  quad9: { name: 'Quad9', color: 0xd6336c, sub: '9.9.9.9 · DoT resolver' },
  oracle: { name: 'Oracle Cloud', color: 0xc74634, sub: 'Sydney · Gatus VM' },
};

const PALETTE = [0x0098d4, 0x9364cc, 0x00a166, 0xb36305, 0xe32017, 0x003688, 0xee7c0e, 0x84b817, 0x6950a1, 0xa0a5a9, 0xf3a9bb, 0x95cdba];
const WINDOW_MS = 10 * 60 * 1000;
const TOP = 12;

const clean = (description) => {
  const word = description.replace(/^AS-?/i, '').split(/[-_,\s]/)[0].replace(/(NET|ASN|AS)$/i, '');
  return word ? word[0] + word.slice(1).toLowerCase() : description;
};

const hashColor = (key) => {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

export async function createNetworks(db) {
  await db.query(`
    create table if not exists networks (
      key text primary key, name text not null, color int, pinned boolean not null default false,
      hidden boolean not null default false, updated_by text, updated_at timestamptz not null default now());
    create table if not exists network_asns (asn int primary key, network_key text not null references networks(key) on delete cascade);
  `);
  for (const [key, p] of Object.entries(PINNED)) {
    await db.query('insert into networks (key, name, color, pinned, updated_by) values ($1, $2, $3, true, $4) on conflict do nothing', [key, p.name, p.color, 'seed']);
  }
  const meta = new Map((await db.query('select * from networks')).rows.map((r) => [r.key, r]));
  const overrides = new Map((await db.query('select * from network_asns')).rows.map((r) => [r.asn, r.network_key]));
  const stats = new Map();
  let asnTable = null;

  const keyFor = (row) => overrides.get(row.asn) ?? BRANDS[row.asn]?.[0] ?? `as${row.asn}`;

  const statsFor = (key, row) => {
    if (!stats.has(key)) stats.set(key, { times: [], total: 0, domains: new Map(), asns: new Map(), countries: new Set(), ips: new Set(), fallbackName: BRANDS[row.asn]?.[1] ?? clean(row.description) });
    return stats.get(key);
  };

  const classify = ({ ips = [], qname }) => {
    if (!asnTable) return null;
    const ip = ips.find((x) => asnTable.lookup(x));
    const row = ip && asnTable.lookup(ip);
    if (!row) return null;
    const key = keyFor(row);
    const s = statsFor(key, row);
    s.times.push(Date.now());
    s.total += 1;
    s.domains.set(qname, (s.domains.get(qname) ?? 0) + 1);
    s.asns.set(row.asn, row.description);
    s.countries.add(row.country);
    if (s.ips.size < 200) s.ips.add(ip);
    if (s.domains.size > 300) [...s.domains].sort((a, b) => a[1] - b[1]).slice(0, 100).forEach(([d]) => s.domains.delete(d));
    return { key, asn: row.asn, org: row.description, country: row.country, ip };
  };

  const describe = (key) => {
    const s = stats.get(key);
    const m = meta.get(key);
    const brand = Object.values(BRANDS).find(([k]) => k === key);
    const asns = s ? [...s.asns.keys()] : [];
    const recent = s ? s.times.length : 0;
    return {
      id: key,
      name: m?.name ?? brand?.[1] ?? s?.fallbackName ?? key,
      color: m?.color ?? brand?.[2] ?? hashColor(key),
      sub: PINNED[key]?.sub ?? [asns.length ? `AS${asns.slice(0, 3).join(', AS')}` : null, s?.countries.size ? `registered ${[...s.countries].join('/')}` : null].filter(Boolean).join(' · '),
      pinned: Boolean(m?.pinned),
      hidden: Boolean(m?.hidden),
      recent,
      total: s?.total ?? 0,
      asns: s ? [...s.asns].map(([asn, org]) => ({ asn, org })) : [],
      domains: s ? [...s.domains].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([d, n]) => ({ d, n })) : [],
      ips: s ? s.ips.size : 0,
    };
  };

  const list = () => {
    const now = Date.now();
    stats.forEach((s) => { while (s.times.length && s.times[0] < now - WINDOW_MS) s.times.shift(); });
    const pinned = [...meta.values()].filter((m) => m.pinned && !m.hidden).map((m) => m.key);
    const busy = [...stats.entries()]
      .filter(([key, s]) => s.times.length && !pinned.includes(key) && !meta.get(key)?.hidden)
      .sort((a, b) => b[1].times.length - a[1].times.length)
      .slice(0, Math.max(0, TOP - pinned.length))
      .map(([key]) => key);
    return [...pinned, ...busy].map(describe)
      .sort((a, b) => a.name.localeCompare(b.name))
      .concat([{ id: 'other', name: 'Other networks', color: 0x7b8794, sub: 'everything below the top 12', pinned: false, recent: 0, asns: [], domains: [] }]);
  };

  const update = async (key, fields, actor) => {
    const current = describe(key);
    const next = {
      name: String(fields.name ?? current.name).trim().slice(0, 60) || current.name,
      color: fields.color != null ? Number(fields.color) : current.color,
      pinned: fields.pinned != null ? Boolean(fields.pinned) : current.pinned,
      hidden: fields.hidden != null ? Boolean(fields.hidden) : current.hidden,
    };
    const { rows } = await db.query(
      `insert into networks (key, name, color, pinned, hidden, updated_by) values ($1, $2, $3, $4, $5, $6)
       on conflict (key) do update set name = excluded.name, color = excluded.color, pinned = excluded.pinned, hidden = excluded.hidden,
         updated_by = excluded.updated_by, updated_at = now() returning *`,
      [key, next.name, next.color, next.pinned, next.hidden, actor],
    );
    meta.set(key, rows[0]);
    return describe(key);
  };

  const merge = async (fromKey, intoKey, actor) => {
    const from = stats.get(fromKey);
    if (!from || fromKey === intoKey) throw new Error('nothing to merge');
    if (!meta.has(intoKey)) await update(intoKey, {}, actor);
    for (const asn of from.asns.keys()) {
      await db.query('insert into network_asns (asn, network_key) values ($1, $2) on conflict (asn) do update set network_key = excluded.network_key', [asn, intoKey]);
      overrides.set(asn, intoKey);
    }
    const into = stats.get(intoKey) ?? stats.set(intoKey, { ...from, times: [], domains: new Map(), asns: new Map(), countries: new Set(), ips: new Set() }).get(intoKey);
    into.times.push(...from.times);
    into.times.sort((a, b) => a - b);
    into.total += from.total;
    from.domains.forEach((n, d) => into.domains.set(d, (into.domains.get(d) ?? 0) + n));
    from.asns.forEach((org, asn) => into.asns.set(asn, org));
    from.countries.forEach((c) => into.countries.add(c));
    stats.delete(fromKey);
    await db.query("insert into audit (actor, action, detail) values ($1, 'merge-network', $2)", [actor, JSON.stringify({ fromKey, intoKey })]);
  };

  const setTable = (table) => { asnTable = table; };

  return { classify, list, describe, update, merge, setTable };
}
