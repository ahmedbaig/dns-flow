import { fileURLToPath } from 'node:url';

export const config = {
  port: Number(process.env.PORT ?? 8787),
  staticDir: process.env.STATIC_DIR ?? fileURLToPath(new URL('..', import.meta.url)),
  databaseUrl: process.env.DATABASE_URL,
  adguardUrl: process.env.ADGUARD_URL ?? 'http://10.10.20.2',
  adguardAuth: process.env.ADGUARD_AUTH ?? '',
  lokiUrl: process.env.LOKI_URL ?? 'http://10.10.20.5:3100',
  promUrl: process.env.PROM_URL ?? 'http://10.10.20.5:9090',
  wireguardHost: process.env.WIREGUARD_HOST ?? '10.10.50.20',
  dataDir: process.env.DATA_DIR ?? fileURLToPath(new URL('../var', import.meta.url)),
};

export const VLAN_BY_IFACE = { br0: 'main', br10: 'trusted', br20: 'servers', br30: 'iot', br40: 'guest', br50: 'lab' };

const SUBNETS = [
  ['10.10.10.', 'trusted'], ['10.10.20.', 'servers'], ['10.10.30.', 'iot'], ['10.10.40.', 'guest'], ['10.10.50.', 'lab'],
  ['192.168.0.', 'main'], ['10.9.0.', 'vpn'],
];

export const zoneForIp = (ip) => SUBNETS.find(([prefix]) => ip?.startsWith(prefix))?.[1] ?? null;
