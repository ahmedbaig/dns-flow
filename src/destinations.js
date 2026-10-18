export const DESTINATION_RULES = [
  [/(^|\.)(google|youtube|ytimg|googlevideo|gstatic|googleapis|googleadservices|googlesyndication|doubleclick)\.[a-z.]+$/, 'google'],
  [/(^|\.)(apple|icloud|itunes)\.com$/, 'apple'],
  [/(^|\.)(microsoft|microsoftonline|office|linkedin|live)\.(com|net)$/, 'microsoft'],
  [/(^|\.)(netflix\.com|nflxso\.net|nflxvideo\.net)$/, 'netflix'],
  [/(^|\.)(github\.com|githubusercontent\.com)$/, 'github'],
  [/(^|\.)docker\.io$/, 'aws'],
  [/(^|\.)(cloudflare\.docker\.com|unpkg\.com|jsdelivr\.net|cloudflare\.com)$/, 'cloudflare'],
];

const INTERNAL_TARGETS = {
  'db.servers.baig.network': 'dev:databases',
  'proxmox.servers.baig.network': 'dev:proxmox-host',
  'metrics.servers.baig.network': 'dev:metrics',
  'macbook.home.baig.network': 'dev:macbook-pro',
  'gitlab.lab.baig.network': 'dev:gitlab',
  'registry.lab.baig.network': 'dev:container-registry',
  'vacuum.iot.baig.network': 'dev:robot-vacuum',
};

export const destinationFor = (ev) => {
  if (ev.outcome === 'blocked' || ev.qtype === 'PTR') return null;
  if (ev.outcome === 'rewrite') return 'dev:nginx-proxy';
  if (ev.outcome === 'internal') return INTERNAL_TARGETS[ev.qname] ?? null;
  return DESTINATION_RULES.find(([re]) => re.test(ev.qname))?.[1] ?? 'other';
};

export const internetDestination = (qname) => DESTINATION_RULES.find(([re]) => re.test(qname))?.[1] ?? 'other';
