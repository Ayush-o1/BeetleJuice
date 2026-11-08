import { h } from '../dom.js';
import { api } from '../api.js';
import { route } from '../router.js';
import { asyncRegion, pageHead, panel, figures, figure, kv, button, emptyState, alertBox, typeBadge } from '../ui.js';
import { formatPaise, formatDateTime, formatDate, formatInt, plural, BREAK_TYPES, RESOLUTIONS } from '../format.js';
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
  if (d.recentFailures.length) {
    const f = d.recentFailures[0];
    nodes.push(alertBox('bad', `${plural(d.recentFailures.length, 'run')} failed in the last 7 days`, h('span', null, `Latest: run #${f.id} (${f.errorCode || 'no code recorded'}) on ${formatDateTime(f.finishedAt)}. `, h('a', { href: '#/runs?status=failed' }, 'See failed runs'))));
  }

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

  const main = h('div', { class: 'stack' },
    panel('Unresolved breaks by type', byType, { flush: true, actions: button({ label: 'Open queue', href: '#/breaks', small: true }) }),
    unresolved ? panel('How old are they?', ageingBars(d.ageing), { flush: true, sub: 'days since the break reference date' }) : null);
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
  side.push(panel('Recent activity', activityList(d.recentActivity), { flush: true }));
  nodes.push(h('div', { class: 'main-grid' }, main, h('div', { class: 'stack' }, side)));
  return h('div', { class: 'stack' }, nodes);
}

const AGE_BUCKETS = {
  d0_1: ['0–1 days', { maxAge: 1 }], d2_3: ['2–3 days', { minAge: 2, maxAge: 3 }],
  d4_7: ['4–7 days', { minAge: 4, maxAge: 7 }], d8_plus: ['8 days or more', { minAge: 8 }],
};

function ageingBars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return h('div', { class: 'panel-body' }, rows.map((r) => {
    const [label, filter] = AGE_BUCKETS[r.bucket];
    const qs = new URLSearchParams({ status: 'unresolved', ...Object.fromEntries(Object.entries(filter).map(([k, v]) => [k, String(v)])) }).toString();
    const fill = h('div', { class: `bar-fill${r.bucket === 'd8_plus' ? ' bar-bad' : r.bucket === 'd4_7' ? ' bar-warn' : ''}` });
    requestAnimationFrame(() => { fill.style.width = `${(r.count / max) * 100}%`; });
    return h('div', { class: 'bar-row' },
      r.count ? h('a', { href: `#/breaks?${qs}` }, label) : h('span', { class: 'muted' }, label),
      h('div', { class: 'bar-track', role: 'img', 'aria-label': `${r.count} breaks aged ${label}` }, fill),
      h('span', { class: 'num' }, `${formatInt(r.count)} · ${formatPaise(r.impactPaise)}`));
  }));
}

function describeActivity(a) {
  const d = a.detail || {};
  switch (a.type) {
    case 'upload': return { text: `${a.actor} uploaded ${d.kind} file`, target: [a.label, `#/sources/${a.refId}`], tail: `${formatInt(d.accepted)} rows accepted${d.rejected ? `, ${formatInt(d.rejected)} rejected` : ''}` };
    case 'run_completed': return { text: 'Run completed', target: [`Run #${a.refId}`, `#/runs/${a.refId}`], tail: `${formatInt(d.matched)} matched, ${plural(d.totalBreaks, 'break')}` };
    case 'run_failed': return { text: 'Run failed', target: [`Run #${a.refId}`, `#/runs/${a.refId}`], tail: d.errorCode || '', bad: true };
    case 'decision_approved': return { text: `${a.actor} approved “${RESOLUTIONS[d.resolution] || d.resolution}” for`, target: [a.label, `#/breaks/${d.breakId}`], tail: '' };
    case 'decision_rejected': return { text: `${a.actor} rejected “${RESOLUTIONS[d.resolution] || d.resolution}” for`, target: [a.label, `#/breaks/${d.breakId}`], tail: '', bad: true };
    default: return { text: a.type, target: null, tail: '' };
  }
}

function activityList(items) {
  if (!items.length) return emptyState({ title: 'Nothing yet', body: 'Uploads, runs and decisions will appear here.' });
  return h('ul', { class: 'activity' }, items.map((a) => {
    const d = describeActivity(a);
    return h('li', null,
      h('div', null, `${d.text} `, d.target && h('a', { href: d.target[1] }, d.target[0]), d.tail && h('span', { class: d.bad ? 'neg' : 'muted' }, ` — ${d.tail}`)),
      h('time', { class: 'when', datetime: a.at }, formatDateTime(a.at)));
  }));
}
