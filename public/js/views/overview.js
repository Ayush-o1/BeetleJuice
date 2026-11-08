import { h } from '../dom.js';
import { api } from '../api.js';
import { route } from '../router.js';
import { asyncRegion, pageHead, panel, figures, figure, kv, button, emptyState, alertBox, typeBadge } from '../ui.js';
import { formatPaise, formatDateTime, formatDate, formatInt, plural, BREAK_TYPES } from '../format.js';
import { can } from '../shell.js';

route('/', async ({ container }) => {
  container.append(pageHead({ title: 'Overview', sub: 'Current position across sources, runs and breaks. Figures are read live from the database.' }));
  const region = h('div', { class: 'stack' });
  container.append(region);
  const { reload } = asyncRegion(region, { load: async () => (await api.get('/api/overview')).data, render: renderOverview });
  const timer = setInterval(reload, 15000);          // keeps counts fresh while the page is open
  return () => clearInterval(timer);
}, { title: 'Overview', permission: 'overview:read', nav: 'overview' });

function renderOverview(d) {
  const isEmpty = d.sources.ledgerFiles + d.sources.settlementFiles === 0 && d.runs.completed === 0;
  if (isEmpty) {
    return panel(null, emptyState({
      title: 'No reconciliation data yet',
      body: can('sources:upload') ? 'Start by loading the two files you want to compare.' : 'Nothing has been loaded yet. An analyst needs to upload the source files first.',
      actions: can('sources:upload') && button({ label: 'Upload a source file', icon: 'upload', variant: 'primary', href: '#/sources?upload=1' }),
    }));
  }
  const unresolved = d.breaks.open + d.breaks.pendingReview;
  const nodes = [];
  const active = d.runs.queued + d.runs.running;
  if (active) nodes.push(alertBox('info', `${plural(active, 'run')} in progress`, h('span', null, 'Results will appear when processing finishes. ', h('a', { href: '#/runs' }, 'View runs'))));
  if (d.runs.failed && !d.latestRun) nodes.push(alertBox('bad', 'A run failed', h('a', { href: '#/runs?status=failed' }, 'See failed runs')));

  nodes.push(figures(
    figure('Unresolved breaks', formatInt(unresolved), `${formatInt(d.breaks.open)} open · ${formatInt(d.breaks.pendingReview)} awaiting review`, unresolved ? 'is-warn' : ''),
    figure('Amount at issue', formatPaise(d.breaks.unresolvedImpactPaise), 'Sum across unresolved breaks'),
    figure('Awaiting review', formatInt(d.awaitingReview), can('proposals:decide') ? 'Proposals for you to decide' : 'Resolution proposals'),
    figure('Oldest unresolved', d.breaks.oldestUnresolvedDays === null ? '—' : `${d.breaks.oldestUnresolvedDays}d`, 'Since the break reference date'),
    figure('Resolved', formatInt(d.breaks.resolved), `${formatInt(d.runs.completed)} completed ${d.runs.completed === 1 ? 'run' : 'runs'}`)));

  const max = Math.max(1, ...d.breaks.byType.map((t) => t.count));
  const byType = d.breaks.byType.length
    ? h('div', { class: 'panel-body' }, d.breaks.byType.map((t) => {
      const fill = h('div', { class: 'bar-fill' });
      requestAnimationFrame(() => { fill.style.width = `${(t.count / max) * 100}%`; });
      return h('div', { class: 'bar-row' },
        h('a', { href: `#/breaks?type=${t.type}&status=unresolved` }, BREAK_TYPES[t.type] || t.type),
        h('div', { class: 'bar-track', role: 'img', 'aria-label': `${t.count} breaks` }, fill),
        h('span', { class: 'num' }, `${formatInt(t.count)} · ${formatPaise(t.impactPaise)}`));
    }))
    : emptyState({ title: 'No unresolved breaks', body: 'Everything from completed runs is resolved or matched.' });

  const main = panel('Unresolved breaks by type', byType, { flush: true, actions: button({ label: 'Open queue', href: '#/breaks', small: true }) });
  const side = [];
  const attention = [];
  if (can('proposals:decide')) attention.push(d.awaitingReview ? h('li', null, h('a', { href: '#/review' }, `${plural(d.awaitingReview, 'proposal')} awaiting your review`)) : h('li', { class: 'quiet muted' }, 'No proposals are waiting for review.'));
  if (can('proposals:create')) {
    attention.push(h('li', null, h('a', { href: '#/breaks?status=open' }, `${plural(d.breaks.open, 'open break')} to investigate`)));
    if (d.myAwaitingReview) attention.push(h('li', null, `${plural(d.myAwaitingReview, 'of your proposals')} awaiting a supervisor`));
  }
  if (!can('proposals:decide') && !can('proposals:create')) attention.push(h('li', { class: 'quiet muted' }, 'Read-only access. Use the audit log to inspect activity.'));
  side.push(panel(can('proposals:decide') ? 'Needs your attention' : 'Your queue', h('ul', { class: 'attn-list' }, attention), { flush: false }));
  if (d.latestRun) {
    const s = d.latestRun.summary;
    side.push(panel(`Latest completed run · #${d.latestRun.id}`, h('div', { class: 'panel-body' }, kv([
      ['As of', formatDate(d.latestRun.asOfDate)], ['Matched', formatInt(s.matched)], ['Awaiting settlement', formatInt(s.pending)],
      ['Transaction breaks', formatInt(s.breaks)], ['Batch breaks', formatInt(s.batchesBroken)], ['Completed', formatDateTime(d.latestRun.finishedAt)],
      ['Files', h('span', null, d.latestRun.ledgerFilename, h('br'), d.latestRun.settlementFilename)],
    ])), { flush: false, actions: button({ label: 'Open run', href: `#/runs/${d.latestRun.id}`, small: true }) }));
  }
  nodes.push(h('div', { class: 'main-grid' }, main, h('div', { class: 'stack' }, side)));
  return h('div', { class: 'stack' }, nodes);
}
