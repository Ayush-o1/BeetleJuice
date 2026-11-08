// Remembers the break queue the user came from (ids on the current page + the exact filtered URL) for this tab only.
// Used to offer previous/next on a break and to make "Breaks" in the breadcrumb return to the same filters.
const KEY = 'bj.queue';

export function saveQueue(ids, hash) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ ids, hash })); } catch { /* storage blocked: navigation falls back to the plain list */ }
}

export function loadQueue() {
  try { const q = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return q && Array.isArray(q.ids) ? q : null; } catch { return null; }
}

/** Position of a break inside the remembered queue, or null when the user did not arrive from it. */
export function queuePosition(id) {
  const q = loadQueue();
  if (!q) return null;
  const i = q.ids.indexOf(Number(id));
  if (i < 0) return null;
  return { index: i, total: q.ids.length, prev: q.ids[i - 1] ?? null, next: q.ids[i + 1] ?? null, hash: q.hash || '#/breaks' };
}
