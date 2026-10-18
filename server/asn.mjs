import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';

const SOURCE = 'https://iptoasn.com/data/ip2asn-combined.tsv.gz';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const ipv4 = (ip) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);

const ipv6 = (ip) => {
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return groups.reduce((n, g) => (n << 16n) + BigInt(parseInt(g || '0', 16)), 0n);
};

const search = (starts, ends, value) => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (value < starts[mid]) hi = mid - 1;
    else if (value > ends[mid]) lo = mid + 1;
    else return mid;
  }
  return -1;
};

async function fetchTable(dataDir) {
  const file = path.join(dataDir, 'ip2asn-combined.tsv.gz');
  await mkdir(dataDir, { recursive: true });
  const age = await stat(file).then((s) => Date.now() - s.mtimeMs).catch(() => Infinity);
  if (age > MAX_AGE_MS) {
    try {
      const res = await fetch(SOURCE);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      if (age === Infinity) throw err;
      console.error('ip2asn refresh failed, keeping cached copy:', err.message);
    }
  }
  return gunzipSync(await readFile(file)).toString('utf8');
}

export async function loadAsnTable(dataDir) {
  const lines = (await fetchTable(dataDir)).split('\n');
  const v4 = { starts: [], ends: [], rows: [] };
  const v6 = { starts: [], ends: [], rows: [] };
  for (const line of lines) {
    const [start, end, asn, country, description] = line.split('\t');
    if (!description || asn === '0') continue;
    const row = { asn: Number(asn), country, description };
    if (start.includes(':')) {
      v6.starts.push(ipv6(start));
      v6.ends.push(ipv6(end));
      v6.rows.push(row);
    } else {
      v4.starts.push(ipv4(start));
      v4.ends.push(ipv4(end));
      v4.rows.push(row);
    }
  }
  const lookup = (ip) => {
    if (!ip) return null;
    const table = ip.includes(':') ? v6 : v4;
    const i = search(table.starts, table.ends, ip.includes(':') ? ipv6(ip) : ipv4(ip));
    return i < 0 ? null : table.rows[i];
  };
  console.log(`ip2asn loaded: ${v4.rows.length} IPv4 and ${v6.rows.length} IPv6 ranges`);
  return { lookup, refresh: () => loadAsnTable(dataDir) };
}
