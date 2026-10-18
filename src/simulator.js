import { DEVICES } from './topology.js';
import { destinationFor } from './destinations.js';

const DOMAINS = {
  web: [
    'www.google.com', 'www.youtube.com', 'i.ytimg.com', 'github.com', 'api.github.com', 'news.ycombinator.com',
    'claude.ai', 'api.anthropic.com', 'www.reddit.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net',
    'login.microsoftonline.com', 'outlook.office.com', 'teams.microsoft.com', 'slack.com', 'www.abc.net.au',
    'stackoverflow.com', 'www.linkedin.com', 'unpkg.com', 'docs.google.com',
  ],
  apple: [
    'gateway.icloud.com', 'p55-contacts.icloud.com', 'mesu.apple.com', 'gsp-ssl.ls.apple.com',
    'api.smoot.apple.com', 'init.itunes.apple.com', 'courier.push.apple.com', 'time.apple.com',
  ],
  media: [
    'www.netflix.com', 'occ-0-2794-2219.1.nflxso.net', 'ipv4-c001-syd001-ix.1.oca.nflxvideo.net',
    'rr3---sn-ntqe6n76.googlevideo.com', 'api.spotify.com', 'audio-ak.spotifycdn.com', 'www.disneyplus.com',
  ],
  console: [
    'ps5.np.playstation.net', 'store.playstation.com', 'gs2.ww.prod.dl.playstation.net',
    'auth.api.sonyentertainmentnetwork.com',
  ],
  tv: ['samsungcloudsolution.com', 'osb-apps.samsungqbe.com', 'time.samsungcloudsolution.com', 'www.netflix.com'],
  iot: [
    'a1.tuyaus.com', 'm2.tuyaus.com', 'pool.ntp.org', 'time.google.com', 'connectivitycheck.gstatic.com',
    'mqtt-ap.roborock.com', 'api-ap.roborock.com', 'clients3.google.com',
  ],
  server: [
    'deb.debian.org', 'security.debian.org', 'download.proxmox.com', 'registry-1.docker.io', 'auth.docker.io',
    'production.cloudflare.docker.com', 'registry.npmjs.org', 'api.cloudflare.com', 'objects.githubusercontent.com',
    'pypi.org', 'files.pythonhosted.org', 'acme-v02.api.letsencrypt.org',
  ],
  lab: ['gitlab.com', 'registry.gitlab.com', 'registry.npmjs.org', 'registry.yarnpkg.com', 'deb.debian.org', 'github.com'],
};

const TRACKERS = [
  'googleads.g.doubleclick.net', 'app-measurement.com', 'www.googleadservices.com', 'pagead2.googlesyndication.com',
  'sb.scorecardresearch.com', 'ads.tiktok.com', 'vortex.data.microsoft.com', 'metrics.icloud.com',
  'device-metrics-us.amazon.com', 'samsungads.com', 'log-config.samsungacr.com', 'browser-intake-datadoghq.com',
  'analytics.tuyaus.com', 'firebaselogging-pa.googleapis.com',
];

const MIXES = {
  phone: { apple: 4, web: 3, media: 1, trackers: 2 },
  laptop: { web: 6, apple: 2, rewrite: 2, trackers: 1 },
  tablet: { apple: 3, media: 4, trackers: 2 },
  desktop: { web: 4, apple: 3, rewrite: 2, internal: 1, trackers: 1 },
  handheld: { console: 4, media: 1, trackers: 1 },
  watch: { apple: 1 },
  pi: { server: 3, internal: 2 },
  vacuum: { iot: 4, trackers: 1 },
  camera: { iot: 5, trackers: 3 },
  container: { server: 3, internal: 3, ptr: 1 },
  server: { server: 5, internal: 1, ptr: 1 },
  console: { console: 5, media: 2, trackers: 2 },
  tv: { tv: 4, media: 4, trackers: 4 },
  cloud: { rewrite: 8, internal: 1 },
  scraper: { internal: 5, rewrite: 3, ptr: 2 },
  proxy: { internal: 4, server: 1 },
  lab: { lab: 4, internal: 2, server: 1 },
};

const REWRITES = [
  'home.baig.network', 'grafana.baig.network', 'dns1.baig.network', 'proxmox.baig.network',
  'gitlab.baig.network', 'prometheus.baig.network', 'auth.baig.network',
];

const INTERNAL = [
  'db.servers.baig.network', 'proxmox.servers.baig.network', 'metrics.servers.baig.network',
  'macbook.home.baig.network', 'gitlab.lab.baig.network', 'registry.lab.baig.network', 'vacuum.iot.baig.network',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const weightedKey = (weights) => {
  const entries = Object.entries(weights);
  let r = Math.random() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
};

const gaussian = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

const upstreamMs = () => (Math.random() < 0.015 ? 350 + Math.random() * 600 : Math.exp(Math.log(28) + 0.55 * gaussian()));

const qtypeFor = () => weightedKey({ A: 55, AAAA: 30, HTTPS: 15 });

const ptrName = () => `${2 + Math.floor(Math.random() * 240)}.${pick([10, 20, 30, 50])}.10.10.in-addr.arpa`;

function makeEvent(id, dev) {
  const ev = buildEvent(id, dev);
  const dest = destinationFor(ev);
  return { ...ev, kind: 'dns', dest: dest && dest !== dev.id && Math.random() < 0.75 ? dest : null };
}

function buildEvent(id, dev) {
  const category = weightedKey(MIXES[dev.profile] ?? MIXES[dev.type]);
  const base = {
    id,
    ts: Date.now(),
    client: { id: dev.id, ip: dev.ip, name: dev.label, zone: dev.zone },
    qtype: qtypeFor(),
    upstream: null,
  };
  switch (category) {
    case 'ptr': return { ...base, qname: ptrName(), qtype: 'PTR', outcome: 'internal', upstream: '10.10.20.1:53', ms: 1 + Math.random() * 4 };
    case 'internal': return { ...base, qname: pick(INTERNAL), outcome: 'internal', upstream: '10.10.20.1:53', ms: 1 + Math.random() * 5 };
    case 'rewrite': return { ...base, qname: pick(REWRITES), outcome: 'rewrite', ms: 0.05 + Math.random() * 0.3 };
    case 'trackers': return { ...base, qname: pick(TRACKERS), outcome: 'blocked', ms: 0.05 + Math.random() * 0.3 };
    default: {
      const qname = pick(DOMAINS[category]);
      if (Math.random() < 0.6) return { ...base, qname, outcome: 'cached', ms: 0.1 + Math.random() * 0.5 };
      return { ...base, qname, outcome: 'forwarded', upstream: Math.random() < 0.7 ? 'cloudflare' : 'quad9', ms: upstreamMs() };
    }
  }
}

export function createSimulator(onEvent) {
  const state = { rate: 10, storm: 0 };
  let backlog = 0;
  let nextId = 1;

  const online = DEVICES.filter((d) => d.online);
  const byId = new Map(online.map((d) => [d.id, d]));

  const pickDevice = () => byId.get(weightedKey(Object.fromEntries(online.map((d) => [d.id, d.weight * (state.storm > 0 && d.zone === 'iot' ? 12 : 1)]))));

  const tick = (dt) => {
    state.storm = Math.max(0, state.storm - dt);
    const rate = state.rate * (state.storm > 0 ? 4 : 1);
    backlog += rate * dt * (0.3 + Math.random() * 1.4);
    while (backlog >= 1) {
      backlog -= 1;
      onEvent(makeEvent(nextId++, pickDevice()));
    }
  };

  const storm = (seconds = 10) => { state.storm = seconds; };

  return { state, tick, storm };
}
