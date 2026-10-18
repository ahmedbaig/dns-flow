import { existsSync } from 'node:fs';
import pg from 'pg';

const SCHEMA = `
create table if not exists devices (
  id serial primary key,
  name text not null,
  type text,
  owner text,
  zone text,
  notes text,
  hidden boolean not null default false,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
create table if not exists identifiers (
  id serial primary key,
  device_id int not null references devices(id) on delete cascade,
  kind text not null check (kind in ('mac', 'ip', 'wg_peer')),
  value text not null,
  created_at timestamptz not null default now(),
  unique (kind, value)
);
create table if not exists sightings (
  key text primary key,
  mac text,
  ip text,
  zone text,
  hostname text,
  ap text,
  radio text,
  rssi int,
  online boolean not null default true,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create table if not exists audit (
  id serial primary key,
  at timestamptz not null default now(),
  actor text,
  action text not null,
  detail jsonb
);
`;

const seedFile = () => (existsSync(new URL('../data/clients.js', import.meta.url)) ? '../data/clients.js' : '../data/clients.example.js');

export async function openDb(url) {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  await pool.query(SCHEMA);
  const { rows } = await pool.query('select count(*)::int as n from devices');
  if (!rows[0].n) await seed(pool);
  return pool;
}

async function seed(pool) {
  const { CLIENTS, PEERS } = await import(seedFile());
  const client = await pool.connect();
  try {
    await client.query('begin');
    const devices = [
      ...CLIENTS.filter((c) => !['adguard', 'gs724t'].includes(c.role)).map((c) => ({ name: c.name, type: c.type, zone: c.network, ip: c.ip, wgPeer: c.wgPeer })),
      ...PEERS.map((p) => ({ name: p.name, type: p.type, zone: 'vpn', ip: null, wgPeer: p.wgPeer })),
    ];
    for (const d of devices) {
      const { rows } = await client.query(
        "insert into devices (name, type, zone, source, updated_by) values ($1, $2, $3, 'unifi-seed', 'seed') returning id",
        [d.name, d.type, d.zone],
      );
      if (d.ip) await client.query("insert into identifiers (device_id, kind, value) values ($1, 'ip', $2) on conflict do nothing", [rows[0].id, d.ip]);
      if (d.wgPeer) await client.query("insert into identifiers (device_id, kind, value) values ($1, 'wg_peer', $2) on conflict do nothing", [rows[0].id, d.wgPeer]);
    }
    await client.query("insert into audit (actor, action, detail) values ('seed', 'seed', $1)", [JSON.stringify({ devices: devices.length })]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
