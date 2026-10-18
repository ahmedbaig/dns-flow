const EVENTS = ['snapshot', 'stations', 'destinations', 'dns', 'conn', 'flow', 'wifi', 'peers'];

export function connectLive(handlers) {
  const source = new EventSource('api/stream');
  EVENTS.forEach((type) => source.addEventListener(type, (e) => handlers[type]?.(JSON.parse(e.data))));
  source.addEventListener('open', () => handlers.status?.('live'));
  source.addEventListener('error', () => handlers.status?.('reconnecting'));
  return source;
}

export const api = async (method, url, body) => {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
};
