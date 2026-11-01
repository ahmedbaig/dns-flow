const KEY = 'flow.hudHidden';
const COMPACT = window.matchMedia('(max-width: 760px)');

const stored = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

const remember = (hidden) => {
  try {
    localStorage.setItem(KEY, hidden ? '1' : '0');
  } catch {}
};

export function createView() {
  const body = document.body;
  const hudButton = document.getElementById('hud-toggle');
  const fullButton = document.getElementById('fullscreen');

  const setHud = (hidden) => {
    body.classList.toggle('hud-hidden', hidden);
    hudButton.setAttribute('aria-pressed', String(hidden));
    hudButton.title = hidden ? 'Show panels (H)' : 'Hide panels (H)';
    remember(hidden);
  };
  const toggleHud = () => setHud(!body.classList.contains('hud-hidden'));

  const setSheet = (name) => {
    ['controls', 'feed', 'history'].forEach((s) => body.classList.toggle(`sheet-${s}`, s === name));
    document.querySelectorAll('#sheet-tabs [data-sheet]').forEach((b) => b.classList.toggle('on', b.dataset.sheet === name));
  };
  const openSheet = () => ['controls', 'feed', 'history'].find((s) => body.classList.contains(`sheet-${s}`)) ?? null;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  };

  fullButton.hidden = !document.fullscreenEnabled;
  fullButton.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    const on = Boolean(document.fullscreenElement);
    fullButton.setAttribute('aria-pressed', String(on));
    fullButton.title = on ? 'Exit full screen' : 'Full screen';
  });
  hudButton.addEventListener('click', toggleHud);
  document.getElementById('sheet-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sheet]');
    if (b) setSheet(openSheet() === b.dataset.sheet ? null : b.dataset.sheet);
  });

  setHud(stored());

  const padding = () => {
    const { innerWidth: w } = window;
    if (body.classList.contains('hud-hidden')) return { left: 24, right: 24, top: 64, bottom: 24 };
    if (COMPACT.matches) return { left: 16, right: 16, top: document.getElementById('top').getBoundingClientRect().bottom + 12, bottom: 72 };
    return { left: Math.min(270, w * 0.3), right: 40, top: 70, bottom: 40 };
  };

  return { toggleHud, toggleFullscreen, setSheet, padding, compact: () => COMPACT.matches };
}
