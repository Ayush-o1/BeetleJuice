import { h, clear } from '../dom.js';
import { api } from '../api.js';
import { route, setQuery } from '../router.js';
import { asyncRegion, pageHead, button, badge, dataTable, tableFoot, tabs, emptyState, ref, money, typeBadge } from '../ui.js';
import { formatDateTime, RESOLUTIONS } from '../format.js';
import { can } from '../shell.js';

route('/review', async ({ container, query }) => {
  const state = { status: ['pending', 'approved', 'rejected', 'all'].includes(query.status) ? query.status : 'pending', page: Number(query.page) || 1 };
  container.append(pageHead({
    title: 'Review queue',
    sub: can('proposals:decide') ? 'Resolution proposals waiting for a supervisor. Open one to see the evidence and decide.' : 'Resolution proposals and their outcomes. Only supervisors can decide.',
  }));
  const tabRow = h('div');
  const region = h('div');
  const drawTabs = () => clear(tabRow).append(tabs([['pending', 'Awaiting review'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']], state.status, (s) => { state.status = s; state.page = 1; setQuery({ status: s, page: '' }); drawTabs(); list.reload(); }));
  drawTabs();
  container.append(h('div', { class: 'panel' }, tabRow, region));
  const list = asyncRegion(region, {
    load: () => api.get('/api/proposals', { status: state.status, page: state.page, pageSize: 25 }),
    render: (res) => h('div', null, dataTable({
      caption: 'Resolution proposals',
      columns: [
        { label: 'Break', render: (p) => h('div', null, h('a', { href: `#/breaks/${p.breakId}`, class: 'ref' }, p.reference || `#${p.breakId}`), h('span', { class: 'cell-sub' }, `Break #${p.breakId}`)) },
        { label: 'Type', hideSm: true, render: (p) => typeBadge(p.breakType) },
        { label: 'Proposed resolution', render: (p) => h('div', null, RESOLUTIONS[p.resolutionCode], h('span', { class: 'cell-sub truncate' }, p.note.length > 80 ? `${p.note.slice(0, 80)}…` : p.note)) },
        { label: 'Amount at issue', align: 'num', render: (p) => money(p.impactPaise) },
        { label: 'Proposed by', hideSm: true, render: (p) => h('div', null, p.proposedByName, h('span', { class: 'cell-sub' }, formatDateTime(p.createdAt))) },
        { label: 'Status', render: (p) => badge({ pending: 'info', approved: 'ok', rejected: 'bad' }[p.status], p.status === 'pending' ? 'Awaiting review' : p.status === 'approved' ? 'Approved' : 'Rejected') },
        { label: '', srLabel: 'Open', render: (p) => button({ label: p.status === 'pending' && can('proposals:decide') ? 'Review' : 'View', small: true, href: `#/breaks/${p.breakId}` }) },
      ],
      rows: res.data, rowHref: (p) => `/breaks/${p.breakId}`,
      emptyNode: emptyState({ title: state.status === 'pending' ? 'Nothing is waiting for review' : 'No proposals here', body: state.status === 'pending' ? 'New proposals from analysts will appear in this queue.' : undefined }),
    }), res.data.length > 0 && tableFoot(res.page, (p) => { state.page = p; setQuery({ page: p > 1 ? p : "" }); list.reload(); }, 'proposals')),
  });
}, { title: 'Review queue', permission: 'proposals:read', nav: 'review' });
