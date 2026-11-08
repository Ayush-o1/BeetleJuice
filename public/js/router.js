// Hash router: "#/breaks/12?x=1". Views are functions that render into the container and may return a cleanup.
const routes = [];
let current = { cleanup: null };
let silent = false;
let listener = null;

export function route(pattern, handler, options = {}) {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:([a-z]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ regex, keys, handler, options });
}

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(search)) };
}

export function navigate(path, query, { replace = false } = {}) {
  const search = new URLSearchParams(Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  const target = `#${path}${search ? `?${search}` : ''}`;
  if (replace) history.replaceState(null, '', target); else location.hash = target;
}

// Update filters in the URL (shareable, back-button friendly) without re-rendering the whole view.
export function setQuery(patch) {
  const { path, query } = parseHash();
  const next = { ...query, ...patch };
  for (const k of Object.keys(next)) if (next[k] === '' || next[k] === undefined || next[k] === null) delete next[k];
  silent = true;
  navigate(path, next, { replace: true });
  queueMicrotask(() => { silent = false; });
  return next;
}

export function startRouter({ container, onRoute, resolveUser, notFound, forbidden }) {
  async function render() {
    if (silent) return;
    current.cleanup?.();
    current = { cleanup: null };
    const { path, query } = parseHash();
    const match = routes.map((r) => ({ r, m: r.regex.exec(path) })).find((x) => x.m);
    container.replaceChildren();
    container.classList.remove('view-enter');
    void container.offsetWidth;                 // restart the entry animation
    container.classList.add('view-enter');
    if (!match) { notFound(container); onRoute({ path, title: 'Not found' }); return; }
    const params = Object.fromEntries(match.r.keys.map((k, i) => [k, decodeURIComponent(match.m[i + 1])]));
    const user = resolveUser();
    if (match.r.options.permission && !user.permissions.includes(match.r.options.permission)) {
      forbidden(container); onRoute({ path, title: 'Not permitted' }); return;
    }
    onRoute({ path, title: match.r.options.title || '', nav: match.r.options.nav });
    document.title = `${match.r.options.title ? `${match.r.options.title} · ` : ''}BeetleJuice`;
    current.cleanup = await match.r.handler({ container, params, query, user });
    $focusMain();
  }
  const $focusMain = () => document.getElementById('main')?.focus({ preventScroll: true });
  if (listener) window.removeEventListener('hashchange', listener);
  listener = render;
  window.addEventListener('hashchange', render);
  render();
  return render;
}
