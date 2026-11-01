// Rolling 24 h of traffic for the history panel, in fixed-size ring buffers.
// One slot per minute (per zone) and per five minutes (per station); each slot
// is rewritten when its time comes round again, so the tables never grow.
// Unlogged: no WAL, and Postgres empties them after a crash. That is fine for
// a graph, and the AdGuard backfill fills the DNS side straight back in.

const MINUTE = 60 * 1000;
const FIVE = 5 * MINUTE;
const DAY = 24 * 60 * MINUTE;
const MINUTE_SLOTS = DAY / MINUTE;
const FIVE_SLOTS = DAY / FIVE;
// Marks a minute as recorded even when it saw no traffic, so the chart can
// tell "quiet" from "the bridge was down".
const HEARTBEAT = '_';

const SCHEMA = `
create unlogged table if not exists history_minute (
  slot smallint not null,
  zone text not null,
  at timestamptz not null,
  lookups int not null,
  blocked int not null,
  primary key (slot, zone)
);
create unlogged table if not exists history_station (
  slot smallint not null,
  station text not null,
  at timestamptz not null,
  lookups int not null,
  primary key (slot, station)
);
`;

const floor = (ts, step) => Math.floor(ts / step) * step;
const slotOf = (ts, step, slots) => Math.floor(ts / step) % slots;

export async function createHistory(db) {
  await db.query(SCHEMA);

  let minute = floor(Date.now(), MINUTE);
  let five = floor(Date.now(), FIVE);
  let zones = new Map();
  let stations = new Map();

  const writeSlot = async (table, key, at, step, slots, rows) => {
    const slot = slotOf(at, step, slots);
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(`delete from ${table} where slot = $1`, [slot]);
      for (const row of rows) {
        await client.query(
          table === 'history_minute'
            ? 'insert into history_minute (slot, zone, at, lookups, blocked) values ($1, $2, to_timestamp($3 / 1000.0), $4, $5)'
            : 'insert into history_station (slot, station, at, lookups) values ($1, $2, to_timestamp($3 / 1000.0), $4)',
          [slot, row[key], at, ...(table === 'history_minute' ? [row.lookups, row.blocked] : [row.lookups])],
        );
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  };

  const flushMinute = (at, counts) => writeSlot('history_minute', 'zone', at, MINUTE, MINUTE_SLOTS, [
    { zone: HEARTBEAT, lookups: 0, blocked: 0 },
    ...[...counts].map(([zone, c]) => ({ zone, ...c })),
  ]);
  const flushFive = (at, counts) => writeSlot('history_station', 'station', at, FIVE, FIVE_SLOTS,
    [...counts].map(([station, lookups]) => ({ station, lookups })));

  const roll = (now = Date.now()) => {
    const m = floor(now, MINUTE);
    if (m !== minute) {
      const [at, counts] = [minute, zones];
      minute = m;
      zones = new Map();
      flushMinute(at, counts).catch((err) => console.error('history minute flush failed:', err.message));
    }
    const f = floor(now, FIVE);
    if (f !== five) {
      const [at, counts] = [five, stations];
      five = f;
      stations = new Map();
      flushFive(at, counts).catch((err) => console.error('history station flush failed:', err.message));
    }
  };
  setInterval(roll, 5000);

  const record = ({ ts = Date.now(), zone, station, blocked }) => {
    roll(ts);
    const z = zones.get(zone) ?? { lookups: 0, blocked: 0 };
    z.lookups += 1;
    if (blocked) z.blocked += 1;
    zones.set(zone, z);
    if (station) stations.set(station, (stations.get(station) ?? 0) + 1);
  };

  // Minutes recorded in the last 24 h; the backfill only runs when this is low.
  const coverage = async () => (await db.query(
    "select count(*)::int as n from history_minute where zone = $1 and at > now() - interval '24 hours'", [HEARTBEAT],
  )).rows[0].n;

  // Bulk load of older traffic (the AdGuard backfill): count as pages arrive,
  // then write whole buckets. Stops at the minute the live counters own.
  const bulk = () => {
    const [until, untilFive] = [minute, five];
    const byMinute = new Map();
    const byFive = new Map();
    const add = (e) => {
      const m = floor(e.ts, MINUTE);
      if (m >= until) return;
      const counts = byMinute.get(m) ?? new Map();
      const z = counts.get(e.zone) ?? { lookups: 0, blocked: 0 };
      z.lookups += 1;
      if (e.blocked) z.blocked += 1;
      counts.set(e.zone, z);
      byMinute.set(m, counts);
      const f = floor(e.ts, FIVE);
      if (f >= untilFive || !e.station) return;
      const s = byFive.get(f) ?? new Map();
      s.set(e.station, (s.get(e.station) ?? 0) + 1);
      byFive.set(f, s);
    };
    const finish = async () => {
      if (!byMinute.size) return 0;
      // The oldest minutes share ring slots with the newest live ones; skip
      // any slot the live counters may have reused while the log was read.
      const fromMinute = Math.max(Math.min(...byMinute.keys()), minute - DAY + 2 * MINUTE);
      const fromFive = five - DAY + 2 * FIVE;
      let written = 0;
      for (let m = fromMinute; m < until; m += MINUTE, written += 1) await flushMinute(m, byMinute.get(m) ?? new Map());
      for (const [f, counts] of byFive) if (f >= fromFive) await flushFive(f, counts);
      return written;
    };
    return { add, finish };
  };

  const series = async (hours) => {
    const span = Math.min(Math.max(Number(hours) || 24, 1), 24) * 60 * MINUTE;
    const start = floor(Date.now(), MINUTE) - span;
    const { rows } = await db.query(
      'select zone, extract(epoch from at) * 1000 as at, lookups, blocked from history_minute where at >= to_timestamp($1 / 1000.0) order by at',
      [start],
    );
    const buckets = new Map();
    rows.forEach((r) => {
      const at = Number(r.at);
      const b = buckets.get(at) ?? { at, zones: {}, blocked: 0 };
      if (r.zone !== HEARTBEAT) {
        b.zones[r.zone] = r.lookups;
        b.blocked += r.blocked;
      }
      buckets.set(at, b);
    });
    const current = { at: minute, zones: {}, blocked: 0, partial: true };
    zones.forEach((c, zone) => {
      current.zones[zone] = c.lookups;
      current.blocked += c.blocked;
    });
    return { step: MINUTE, start, end: minute + MINUTE, buckets: [...buckets.values(), current] };
  };

  return { record, bulk, coverage, series };
}
