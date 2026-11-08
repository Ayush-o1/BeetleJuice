import { h, clear, debounce } from '../dom.js';
import { api, exportUrl } from '../api.js';
import { route, setQuery } from '../router.js';
import { asyncRegion, pageHead, button, dataTable, tableFoot, emptyState, field, select, roleBadge } from '../ui.js';
import { formatDateTime } from '../format.js';
import { describeEvent, actorLabel } from '../audit-text.js';

const KEYS = ['action', 'entityType', 'actor', 'runId', 'breakId', 'from', 'to', 'hide'];
const FAMILIES = [['', 'All actions'], ['auth.', 'Authentication'], ['source.', 'Sources'], ['run.', 'Runs'], ['break.', 'Breaks'], ['proposal.', 'Proposals'], ['settings.', 'Settings']];

route('/audit', async ({ container, query }) => {
  const f = { page: Number(query.page) || 1 };
  for (const k of KEYS) if (query[k]) f[k] = query[k];
  const region = h('div');
  const apply = (patch) => { Object.assign(f, patch, { page: patch.page ?? 1 }); setQuery({ ...patch, page: f.page === 1 ? '' : f.page }); list.reload(); exportLink.href = exportUrl('/api/audit/export.csv', filterQuery()); };
  const filterQuery = () => Object.fromEntries(KEYS.filter((k) => f[k]).map((k) => [k, f[k]]));
  const debounced = debounce((k, v) => apply({ [k]: v }), 300);
  const txt = (k, label, props = {}) => { const el = h('input', { class: 'input', value: f[k] || '', 'aria-label': label, ...props }); el.addEventListener('input', () => debounced(k, el.value.trim())); return field(label, el, { className: 'narrow' }); };

  const actionSelect = select(FAMILIES, FAMILIES.some(([v]) => v === f.action) ? f.action : '', { 'aria-label': 'Action', onchange: (e) => apply({ action: e.target.value }) });
  api.get('/api/audit/actions').then((r) => {
    const known = r.data.map((a) => [a, a]);
    actionSelect.replaceChildren(...[...FAMILIES, ...known].map(([v, l]) => h('option', { value: v }, l)));
    actionSelect.value = f.action || '';
  }).catch(() => {});
  const exportLink = h('a', { class: 'btn', href: exportUrl('/api/audit/export.csv', filterQuery()) }, 'Export CSV');
  exportLink.prepend(h('span', null));

  container.append(
    pageHead({ title: 'Audit log', sub: 'Append-only history of who did what. Rows cannot be edited or deleted through the application or by its database role.', actions: exportLink }),
    h('div', { class: 'panel' },
      h('div', { class: 'filters' },
        field('Action', actionSelect, { className: 'wide' }),
        txt('actor', 'Actor', { placeholder: 'username' }), txt('runId', 'Run', { inputmode: 'numeric', placeholder: '#' }), txt('breakId', 'Break', { inputmode: 'numeric', placeholder: '#' }),
        field('From (IST)', h('input', { class: 'input', type: 'date', value: f.from || '', 'aria-label': 'From date', onchange: (e) => apply({ from: e.target.value }) })),
        field('To (IST)', h('input', { class: 'input', type: 'date', value: f.to || '', 'aria-label': 'To date', onchange: (e) => apply({ to: e.target.value }) })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.hide === 'auth', onchange: (e) => apply({ hide: e.target.checked ? 'auth' : '' }) }), 'Hide sign-in activity')),
      region));

  const list = asyncRegion(region, {
    load: () => api.get('/api/audit', { ...filterQuery(), page: f.page, pageSize: 50 }),
    render: (res) => h('div', null, dataTable({
      caption: 'Audit events',
      columns: [
        { label: 'When', render: (e) => h('span', { class: 'nowrap' }, formatDateTime(e.occurredAt)) },
        { label: 'Who', render: (e) => (e.actor ? h('div', null, actorLabel(e), h('span', { class: 'cell-sub' }, `${e.actor} · ${e.actorRole}`)) : h('span', { class: 'muted' }, 'System')) },
        { label: 'What happened', class: 'wrap', render: (e) => { const d = describeEvent(e); return h('div', null, h('span', { class: `evt evt-${d.tone}` }, d.text), h('span', { class: 'cell-sub ref' }, e.action)); } },
        { label: 'Related', render: (e) => subject(e) },
        { label: 'Technical', render: (e) => detail(e) },
      ],
      rows: res.data,
      emptyNode: emptyState({ title: 'No events match', body: 'Adjust the filters to widen the search.' }),
    }), res.data.length > 0 && tableFoot(res.page, (p) => { f.page = p; setQuery({ page: p }); list.reload(); }, 'events')),
  });
}, { title: 'Audit log', permission: 'audit:read', nav: 'audit' });

function subject(e) {
  const links = [];
  if (e.breakId) links.push(h('a', { href: `#/breaks/${e.breakId}` }, `Break #${e.breakId}`));
  if (e.runId) links.push(h('a', { href: `#/runs/${e.runId}` }, `Run #${e.runId}`));
  if (!links.length) return h('span', { class: 'muted' }, e.entityType === 'source_file' && e.entityId ? h('a', { href: `#/sources/${e.entityId}` }, `Source #${e.entityId}`) : `${e.entityType.replace('_', ' ')}${e.entityId ? ` #${e.entityId}` : ''}`);
  return h('span', { class: 'row', style: undefined }, links.flatMap((l, i) => (i ? [' · ', l] : [l])));
}

function detail(e) {
  const keys = Object.keys(e.context || {});
  if (!keys.length && !e.requestId) return h('span', { class: 'faint' }, '—');
  return h('details', null, h('summary', { class: 'muted' }, 'JSON'),
    h('pre', { class: 'json' }, JSON.stringify(e.context, null, 2) + (e.requestId ? `\nrequest ${e.requestId}` : '') + (e.ip ? `\nip ${e.ip}` : '')));
}
