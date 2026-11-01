import { zoneForIp } from './config.mjs';

const ONLINE_MS = 15 * 60 * 1000;
const FORGET_MS = 7 * 24 * 60 * 60 * 1000;
const isPrivateMac = (mac) => /^.[26ae]/i.test(mac ?? '');
const ownerKey = (kind, value) => `${kind}:${value}`;

export async function createRegistry(db, onChange) {
  const devices = new Map();
  const owners = new Map();
  const sightings = new Map();
  const activity = new Map();

  (await db.query('select * from devices')).rows.forEach((d) => devices.set(d.id, d));
  (await db.query('select * from identifiers')).rows.forEach((i) => owners.set(ownerKey(i.kind, i.value), i.device_id));
  (await db.query('select * from sightings')).rows.forEach((s) => sightings.set(s.key, { ...s, last_seen: new Date(s.last_seen).getTime() }));

  const audit = (actor, action, detail) => db.query('insert into audit (actor, action, detail) values ($1, $2, $3)', [actor, action, JSON.stringify(detail)]);

  const identifiersOf = (deviceId) => [...owners].filter(([, id]) => id === deviceId).map(([k]) => k);

  const persist = (s) => db.query(
    `insert into sightings (key, mac, ip, zone, hostname, ap, radio, rssi, online, first_seen, last_seen)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11 / 1000.0))
     on conflict (key) do update set mac = excluded.mac, ip = excluded.ip, zone = excluded.zone, hostname = excluded.hostname,
       ap = excluded.ap, radio = excluded.radio, rssi = excluded.rssi, online = excluded.online, last_seen = excluded.last_seen`,
    [s.key, s.mac, s.ip, s.zone, s.hostname, s.ap, s.radio, s.rssi, s.online, s.first_seen, s.last_seen],
  ).catch((e) => console.error('sighting persist failed', e.message));

  const attach = async (deviceId, kind, value, actor, action = 'attach') => {
    await db.query(
      'insert into identifiers (device_id, kind, value) values ($1, $2, $3) on conflict (kind, value) do update set device_id = excluded.device_id',
      [deviceId, kind, value],
    );
    owners.set(ownerKey(kind, value), deviceId);
    await audit(actor, action, { deviceId, kind, value });
  };

  const observe = async ({ mac = null, ip = null, zone = null, hostname = null, ap = null, radio = null, rssi = null, online = true }) => {
    if (!mac && !ip) return;
    const key = mac ?? `ip:${ip}`;
    const prev = sightings.get(key);
    const next = {
      key,
      mac: mac ?? prev?.mac ?? null,
      ip: ip ?? prev?.ip ?? null,
      zone: zone ?? prev?.zone ?? zoneForIp(ip ?? prev?.ip),
      hostname: hostname ?? prev?.hostname ?? null,
      ap: ap ?? prev?.ap ?? null,
      radio: radio ?? prev?.radio ?? null,
      rssi: rssi ?? prev?.rssi ?? null,
      online,
      first_seen: prev?.first_seen ?? new Date(),
      last_seen: Date.now(),
    };
    sightings.set(key, next);
    if (mac && ip) {
      const ipOnly = `ip:${ip}`;
      if (sightings.delete(ipOnly)) db.query('delete from sightings where key = $1', [ipOnly]).catch(() => {});
      sightings.forEach((s) => { if (s.key !== key && s.ip === ip) s.ip = null; });
      const pinned = owners.get(ownerKey('ip', ip));
      if (pinned && !owners.has(ownerKey('mac', mac)) && !identifiersOf(pinned).some((k) => k.startsWith('mac:'))) {
        await attach(pinned, 'mac', mac, 'auto', 'auto-claim');
      }
    }
    persist(next);
    if (!prev || prev.zone !== next.zone || prev.online !== next.online || prev.ip !== next.ip || prev.hostname !== next.hostname) onChange();
  };

  const deviceForIp = (ip) => {
    const sighting = [...sightings.values()].filter((s) => s.ip === ip && s.mac).sort((a, b) => b.last_seen - a.last_seen)[0];
    return (sighting && owners.get(ownerKey('mac', sighting.mac))) ?? owners.get(ownerKey('ip', ip)) ?? null;
  };

  const stationForIp = (ip) => {
    const deviceId = deviceForIp(ip);
    if (deviceId) return `dev:${deviceId}`;
    const sighting = [...sightings.values()].filter((s) => s.ip === ip).sort((a, b) => b.last_seen - a.last_seen)[0];
    if (sighting) return sighting.mac ? `mac:${sighting.mac}` : sighting.key;
    return null;
  };

  const resolveClient = async (ip) => {
    let id = stationForIp(ip);
    if (!id) {
      await observe({ ip });
      id = `ip:${ip}`;
    }
    if (!activity.has(id)) onChange();
    activity.set(id, Date.now());
    return id;
  };

  const deviceForPeer = (peer) => owners.get(ownerKey('wg_peer', peer)) ?? null;

  const stations = () => {
    const now = Date.now();
    const claimed = new Set();
    const out = [];
    devices.forEach((d) => {
      if (d.hidden) return;
      const keys = identifiersOf(d.id);
      const macs = keys.filter((k) => k.startsWith('mac:')).map((k) => k.slice(4));
      const ips = keys.filter((k) => k.startsWith('ip:')).map((k) => k.slice(3));
      const seen = [...macs.map((m) => sightings.get(m)), ...ips.map((ip) => sightings.get(`ip:${ip}`))]
        .filter(Boolean).sort((a, b) => b.last_seen - a.last_seen);
      seen.forEach((s) => claimed.add(s.key));
      const s = seen[0];
      const id = `dev:${d.id}`;
      const active = activity.get(id) ?? 0;
      const lastSeen = Math.max(s?.last_seen ?? 0, active);
      const left = s && s.online === false && active < s.last_seen;
      out.push({
        id, deviceId: d.id, known: true, label: d.name, type: d.type ?? 'unknown', owner: d.owner, notes: d.notes,
        zone: d.zone === 'vpn' ? 'vpn' : (s?.zone ?? d.zone ?? zoneForIp(ips[0])),
        ip: s?.ip ?? ips[0] ?? null, mac: s?.mac ?? macs[0] ?? null, macs, peers: keys.filter((k) => k.startsWith('wg_peer:')).map((k) => k.slice(8)),
        hostname: s?.hostname ?? null, ap: s?.ap ?? null, radio: s?.radio ?? null, rssi: s?.rssi ?? null,
        online: Boolean(lastSeen) && !left && now - lastSeen < ONLINE_MS, lastSeen: lastSeen || null, source: d.source,
      });
    });
    sightings.forEach((s) => {
      if (claimed.has(s.key) || (s.mac && owners.has(ownerKey('mac', s.mac))) || (s.ip && owners.has(ownerKey('ip', s.ip)))) return;
      const id = s.mac ? `mac:${s.mac}` : s.key;
      const lastSeen = Math.max(s.last_seen, activity.get(id) ?? 0);
      if (now - lastSeen > FORGET_MS) return;
      out.push({
        id, key: s.key, known: false, label: s.hostname ? `Unknown · ${s.hostname}` : 'Unknown device', type: 'unknown',
        zone: s.zone ?? zoneForIp(s.ip) ?? 'unassigned', ip: s.ip, mac: s.mac, privateMac: isPrivateMac(s.mac), hostname: s.hostname,
        ap: s.ap, radio: s.radio, rssi: s.rssi, online: s.online !== false && now - lastSeen < ONLINE_MS, lastSeen,
      });
    });
    return out;
  };

  const stationKey = (stationId) => (stationId.startsWith('mac:') ? stationId.slice(4) : stationId);

  const nameStation = async (stationId, fields, actor) => {
    const s = sightings.get(stationKey(stationId));
    if (!s) throw new Error('unknown station');
    const { rows } = await db.query(
      'insert into devices (name, type, owner, notes, zone, updated_by) values ($1, $2, $3, $4, $5, $6) returning *',
      [fields.name, fields.type || null, fields.owner || null, fields.notes || null, s.zone, actor],
    );
    devices.set(rows[0].id, rows[0]);
    await (s.mac ? attach(rows[0].id, 'mac', s.mac, actor, 'name') : attach(rows[0].id, 'ip', s.ip, actor, 'name'));
    onChange();
    return rows[0];
  };

  const assignStation = async (stationId, deviceId, actor) => {
    const s = sightings.get(stationKey(stationId));
    if (!s || !devices.has(deviceId)) throw new Error('unknown station or device');
    await (s.mac ? attach(deviceId, 'mac', s.mac, actor, 'merge') : attach(deviceId, 'ip', s.ip, actor, 'merge'));
    onChange();
  };

  const updateDevice = async (deviceId, fields, actor) => {
    const d = devices.get(deviceId);
    if (!d) throw new Error('unknown device');
    const next = { ...d, ...Object.fromEntries(['name', 'type', 'owner', 'notes', 'hidden'].filter((k) => k in fields).map((k) => [k, fields[k]])) };
    const { rows } = await db.query(
      'update devices set name = $2, type = $3, owner = $4, notes = $5, hidden = $6, updated_by = $7, updated_at = now() where id = $1 returning *',
      [deviceId, next.name, next.type, next.owner, next.notes, Boolean(next.hidden), actor],
    );
    devices.set(deviceId, rows[0]);
    await audit(actor, 'update', { deviceId, fields });
    onChange();
    return rows[0];
  };

  const deviceList = () => [...devices.values()].map((d) => ({ id: d.id, name: d.name, type: d.type, hidden: d.hidden }));

  return { observe, resolveClient, stationForIp, deviceForPeer, stations, nameStation, assignStation, updateDevice, deviceList, devices };
}
