import { h, clear } from '../dom.js';
import { api } from '../api.js';
import { route, setQuery, navigate } from '../router.js';
import { asyncRegion, pageHead, panel, figures, figure, kv, button, badge, runBadge, dataTable, tableFoot, tabs, emptyState, alertBox, withBusy, toast, ref, money, field, select, outcomeBadge, typeBadge, statusBadge } from '../ui.js';
import { formatDateTime, formatDate, formatInt, formatPaise, shortHash, ageLabel, OUTCOMES, BREAK_TYPES } from '../format.js';
import { icon } from '../icons.js';
import { can } from '../shell.js';

const ACTIVE = new Set(['queued', 'running']);

route('/runs', async ({ container, query }) => {
  const state = { page: Number(query.page) || 1, status: query.status || '' };
  container.append(pageHead({
    title: 'Runs', sub: 'Each run compares one ledger file with one settlement file under a frozen copy of the settings.',
    actions: can('runs:create') && button({ label: 'New run', icon: 'plus', variant: 'primary', onClick: () => { newSlot.hidden = false; newSlot.querySelector('select')?.focus(); } }),
  }));
  const newSlot = h('div', { hidden: !(query.new && can('runs:create')) });
  if (can('runs:create')) newSlot.append(newRunPanel(query, () => list.reload()));
  const region = h('div');
  const tabRow = h('div');
  const drawTabs = () => clear(tabRow).append(tabs([['', 'All'], ['queued', 'Queued'], ['running', 'Running'], ['completed', 'Completed'], ['failed', 'Failed']], state.status, (s) => { state.status = s; state.page = 1; setQuery({ status: s, page: '' }); drawTabs(); list.reload(); }));
  drawTabs();
  container.append(h('div', { class: 'stack' }, newSlot, h('div', { class: 'panel' }, tabRow, region)));

  let anyActive = false;
  const list = asyncRegion(region, {
    load: async () => { const r = await api.get('/api/runs', { status: state.status, page: state.page, pageSize: 25 }); anyActive = r.data.some((x) => ACTIVE.has(x.status)); return r; },
    render: (res) => h('div', null, dataTable({
      caption: 'Reconciliation runs',
      columns: [
        { label: 'Run', render: (r) => h('a', { href: `#/runs/${r.id}`, class: 'ref' }, `#${r.id}`) },
        { label: 'Status', render: (r) => runBadge(r.status) },
        { label: 'As of', render: (r) => formatDate(r.asOfDate) },
        { label: 'Files', hideSm: true, render: (r) => h('div', null, r.ledgerFilename, h('span', { class: 'cell-sub' }, r.settlementFilename)) },
        { label: 'Matched', align: 'num', render: (r) => (r.summary ? formatInt(r.summary.matched) : '—') },
        { label: 'Awaiting', align: 'num', hideSm: true, render: (r) => (r.summary ? formatInt(r.summary.pending) : '—') },
        { label: 'Breaks', align: 'num', render: (r) => (r.summary ? formatInt(r.summary.totalBreaks) : '—') },
        { label: 'Started by', hideSm: true, render: (r) => h('div', null, r.createdByName, h('span', { class: 'cell-sub' }, formatDateTime(r.createdAt))) },
      ],
      rows: res.data, rowHref: (r) => `/runs/${r.id}`,
      emptyNode: emptyState({ title: 'No runs yet', body: can('runs:create') ? 'Choose a ledger file and a settlement file to start the first run.' : 'No reconciliation runs have been started.' }),
    }), res.data.length > 0 && tableFoot(res.page, (p) => { state.page = p; setQuery({ page: p }); list.reload(); }, 'runs')),
  });
  // Poll only while something is queued or running.
  const timer = setInterval(() => { if (anyActive) list.reload(); }, 2500);
  return () => clearInterval(timer);
}, { title: 'Runs', permission: 'runs:read', nav: 'runs' });

function newRunPanel(query, onCreated) {
  const body = h('div', { class: 'panel-body' }, h('p', { class: 'muted' }, 'Loading sources…'));
  (async () => {
    try {
      const [ledgers, settlements, settings] = await Promise.all([
        api.get('/api/sources', { kind: 'ledger', pageSize: 100 }), api.get('/api/sources', { kind: 'settlement', pageSize: 100 }), api.get('/api/settings')]);
      if (!ledgers.data.length || !settlements.data.length) {
        clear(body).append(alertBox('info', 'Both a ledger file and a settlement file are needed', h('span', null, 'Upload them from ', h('a', { href: '#/sources?upload=1' }, 'Sources'), '.')));
        return;
      }
      const opt = (f) => [String(f.id), `#${f.id} · ${f.filename} (${formatInt(f.acceptedRows)} rows)`];
      const L = select(ledgers.data.map(opt), query.ledger || String(ledgers.data[0].id), { 'aria-label': 'Ledger file' });
      const S = select(settlements.data.map(opt), query.settlement || String(settlements.data[0].id), { 'aria-label': 'Settlement file' });
      const asOf = h('input', { class: 'input', type: 'date', required: true });
      const asOfHint = h('span', { class: 'hint' }, 'Defaults to the latest date present in either file.');
      const suggest = async () => {
        try { asOf.value = (await api.get('/api/runs/suggest', { ledgerFileId: L.value, settlementFileId: S.value })).data.asOfDate; } catch { /* leave blank */ }
      };
      L.addEventListener('change', suggest); S.addEventListener('change', suggest); suggest();
      const s = settings.data;
      const submit = button({ label: 'Start run', icon: 'runs', variant: 'primary', type: 'submit' });
      const err = h('div');
      const form = h('form', { novalidate: true },
        h('div', { class: 'form-grid' }, field('Ledger file', L), field('Settlement file', S), field('As-of date', asOf, { hint: 'Pending items are judged against this date.' })),
        h('p', { class: 'hint', style: undefined }, `Settings frozen into this run (version ${s.version}): ${s.settlementWindowDays}-day settlement window, ${s.feeRatePercent}% fee rate, ±${formatPaise(s.feeTolerancePaise)} fee tolerance, ±${formatPaise(s.amountTolerancePaise)} amount tolerance.`),
        err, h('div', { class: 'form-actions' }, submit));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clear(err);
        await withBusy(submit, async () => {
          try {
            const res = await api.post('/api/runs', { ledgerFileId: Number(L.value), settlementFileId: Number(S.value), asOfDate: asOf.value || undefined });
            toast(`Run #${res.data.id} queued`);
            onCreated();
            navigate(`/runs/${res.data.id}`);
          } catch (ex) {
            clear(err).append(ex.code === 'DUPLICATE_RUN'
              ? alertBox('warn', 'An identical run already exists', h('span', null, ex.message, ' ', h('a', { href: `#/runs/${ex.details.existingRunId}` }, 'Open it')))
              : alertBox('bad', 'Run could not be started', ex.message));
          }
        });
      });
      clear(body).append(form);
    } catch (ex) { clear(body).append(alertBox('bad', 'Could not load sources', ex.message)); }
  })();
  return panel('Start a reconciliation run', body, { flush: true });
}

/* ---------- run detail ---------- */

route('/runs/:id', async ({ container, params, query }) => {
  const region = h('div', { class: 'stack' });
  container.append(region);
  let lastStatus = null;
  let timer = null;
  const view = { tab: query.tab || 'breaks', page: 1, outcome: '', q: '' };

  const list = asyncRegion(region, {
    load: async () => (await api.get(`/api/runs/${params.id}`)).data,
    render: (run) => {
      const justFinished = lastStatus && ACTIVE.has(lastStatus) && run.status === 'completed';
      if (justFinished) { toast(`Run #${run.id} completed`); window.dispatchEvent(new Event('bj:refresh-nav')); }
      if (lastStatus && ACTIVE.has(lastStatus) && run.status === 'failed') toast(`Run #${run.id} failed`, 'bad');
      lastStatus = run.status;
      return renderRun(run, view, justFinished);
    },
  });
  const poll = () => { if (!lastStatus || ACTIVE.has(lastStatus)) list.reload(); };
  timer = setInterval(poll, 1500);
  return () => clearInterval(timer);
}, { title: 'Run', permission: 'runs:read', nav: 'runs' });

function renderRun(run, view, justFinished) {
  const s = run.summary;
  const nodes = [pageHead({
    crumbs: [{ label: 'Runs', href: '#/runs' }, { label: `#${run.id}` }],
    title: h('span', { class: 'row' }, `Run #${run.id}`, runBadge(run.status, justFinished ? 'badge-settled' : '')),
    sub: `As of ${formatDate(run.asOfDate)} · started by ${run.createdByName} on ${formatDateTime(run.createdAt)}`,
    actions: run.status === 'completed' && button({ label: 'View breaks', icon: 'breaks', variant: 'primary', href: `#/breaks?runId=${run.id}&status=` }),
  }), stepper(run)];

  if (run.status === 'failed') {
    nodes.push(alertBox('bad', 'This run failed', h('span', null, `${run.errorMessage || 'No details were recorded.'} (code ${run.errorCode}, ${run.attempts} of ${run.maxAttempts} attempts). `,
      can('runs:create') ? h('a', { href: `#/runs?new=1&ledger=${run.ledgerFileId}&settlement=${run.settlementFileId}` }, 'Start it again') : '')));
  } else if (ACTIVE.has(run.status)) {
    nodes.push(alertBox('info', run.status === 'queued' ? 'Waiting for a worker' : 'Reconciling…', run.errorCode ? `Retrying after attempt ${run.attempts - (run.status === 'queued' ? 0 : 1)} failed (${run.errorCode}).` : 'This page updates automatically.'));
  }
  if (s) {
    nodes.push(figures(
      figure('Matched', formatInt(s.matched), `of ${formatInt(s.inputs.ledgerEntries)} ledger entries`, ''),
      figure('Awaiting settlement', formatInt(s.pending), formatPaise(s.pendingPaise), s.pending ? 'is-warn' : ''),
      figure('Transaction breaks', formatInt(s.breaks), 'Ledger or settlement line', s.breaks ? 'is-bad' : ''),
      figure('Batch breaks', formatInt(s.batchesBroken), `of ${formatInt(s.inputs.settlementBatches)} batches`, s.batchesBroken ? 'is-bad' : ''),
      figure('Amount at issue', formatPaise(s.breakImpactPaise), 'Across all breaks')));
    nodes.push(h('div', { class: 'main-grid' }, summaryByType(s), configPanel(run)));
    nodes.push(resultsPanel(run, view));
  } else {
    nodes.push(configPanel(run));
  }
  return h('div', { class: 'stack' }, nodes);
}

function stepper(run) {
  const order = ['queued', 'running', 'completed'];
  const failed = run.status === 'failed';
  const idx = failed ? 1 : order.indexOf(run.status);
  const step = (i, label, detail) => {
    const cls = failed && i === 2 ? 'failed' : i < idx || run.status === 'completed' ? 'done' : i === idx ? 'active' : '';
    return h('div', { class: `step ${cls}` }, h('span', { class: 'dot' }, cls === 'done' ? icon('check') : cls === 'failed' ? icon('x') : null), h('span', null, label, detail && h('span', { class: 'faint' }, ` · ${detail}`)));
  };
  return h('div', { class: 'panel' }, h('div', { class: 'panel-body row' }, h('div', { class: 'stepper', role: 'list', 'aria-label': 'Run progress' },
    step(0, 'Queued', formatDateTime(run.createdAt)), h('span', { class: 'step-line' }),
    step(1, 'Running', run.startedAt ? formatDateTime(run.startedAt) : ''), h('span', { class: 'step-line' }),
    step(2, failed ? 'Failed' : 'Completed', run.finishedAt ? formatDateTime(run.finishedAt) : ''))));
}

function summaryByType(s) {
  const entries = Object.entries(s.breaksByType).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return panel('Breaks by type', entries.length ? h('div', { class: 'panel-body' }, entries.map(([type, n]) => {
    const fill = h('div', { class: 'bar-fill' });
    requestAnimationFrame(() => { fill.style.width = `${(n / max) * 100}%`; });
    return h('div', { class: 'bar-row' }, BREAK_TYPES[type] || type, h('div', { class: 'bar-track' }, fill), h('span', { class: 'num' }, n));
  })) : emptyState({ title: 'No breaks', body: 'Every record in this run matched or is awaiting settlement.' }));
}

function configPanel(run) {
  const c = run.config;
  return panel('Configuration used', h('div', { class: 'panel-body' }, kv([
    ['Settings version', `v${c.settingsVersion}`], ['As-of date', formatDate(c.asOfDate)], ['Settlement window', `${c.settlementWindowDays} days`],
    ['Fee rate', `${c.feeRatePercent}%`], ['Fee tolerance', formatPaise(c.feeTolerancePaise)], ['Amount tolerance', formatPaise(c.amountTolerancePaise)],
    ['Engine', `v${c.engineVersion}`],
    ['Ledger input', h('span', null, h('a', { href: `#/sources/${c.inputs.ledger.fileId}` }, c.inputs.ledger.filename), h('span', { class: 'cell-sub ref' }, shortHash(c.inputs.ledger.sha256)))],
    ['Settlement input', h('span', null, h('a', { href: `#/sources/${c.inputs.settlement.fileId}` }, c.inputs.settlement.filename), h('span', { class: 'cell-sub ref' }, shortHash(c.inputs.settlement.sha256)))],
    run.summary?.execution && ['Executed', `${run.summary.execution.durationMs} ms, attempt ${run.summary.execution.attempt}`],
  ])), { flush: false, sub: 'frozen at queue time' });
}

function resultsPanel(run, view) {
  const body = h('div');
  const tabHost = h('div');
  const region = h('div');
  let loader;
  const draw = () => {
    clear(tabHost).append(tabs([['breaks', 'Breaks'], ['batches', 'Batches'], ['all', 'All results']], view.tab, (k) => { view.tab = k; view.page = 1; draw(); }));
    clear(body);
    if (view.tab === 'all') body.append(h('div', { class: 'filters' },
      field('Outcome', select([['', 'All outcomes'], ['MATCHED', 'Matched'], ['PENDING', 'Awaiting settlement'], ['BREAK', 'Break']], view.outcome, { onchange: (e) => { view.outcome = e.target.value; view.page = 1; loader.reload(); } })),
      field('Reference', h('input', { class: 'input', type: 'search', value: view.q, placeholder: 'Contains…', oninput: (e) => { view.q = e.target.value.trim(); clearTimeout(draw.t); draw.t = setTimeout(() => { view.page = 1; loader.reload(); }, 250); } }), { className: 'wide' })));
    body.append(region);
    loader = asyncRegion(region, { load, render });
  };
  const load = () => {
    if (view.tab === 'breaks') return api.get('/api/runs/' + run.id + '/results', { outcome: 'BREAK', scope: 'TRANSACTION', page: view.page, pageSize: 25 });
    if (view.tab === 'batches') return api.get('/api/runs/' + run.id + '/results', { scope: 'BATCH', pageSize: 100 });
    return api.get('/api/runs/' + run.id + '/results', { outcome: view.outcome, q: view.q, scope: 'TRANSACTION', page: view.page, pageSize: 25 });
  };
  const render = (res) => {
    const foot = view.tab !== 'batches' && res.data.length > 0 && tableFoot(res.page, (p) => { view.page = p; loader.reload(); }, 'results');
    if (view.tab === 'batches') {
      return dataTable({
        caption: 'Batch payout results', rows: res.data, rowHref: (r) => (r.breakId ? `/breaks/${r.breakId}` : null),
        columns: [
          { label: 'Batch', render: (r) => ref(r.batchRef) }, { label: 'Result', render: (r) => outcomeBadge(r.outcome) },
          { label: 'Explanation', render: (r) => r.explanation },
          { label: 'Payout difference', align: 'num', render: (r) => money(r.amountDiffPaise, { sign: true }) },
        ],
        emptyNode: emptyState({ title: 'No batches in this file' }),
      });
    }
    return h('div', null, dataTable({
      caption: 'Reconciliation results', rows: res.data, rowHref: (r) => (r.breakId ? `/breaks/${r.breakId}` : null),
      columns: [
        { label: 'Reference', render: (r) => ref(r.reference) },
        { label: 'Result', render: (r) => (r.outcome === 'BREAK' ? typeBadge(r.breakType) : outcomeBadge(r.outcome)) },
        { label: 'Ledger', align: 'num', render: (r) => money(r.ledgerAmountPaise) }, { label: 'Settlement', align: 'num', render: (r) => money(r.settlementAmountPaise) },
        { label: 'Rule', hideSm: true, render: (r) => h('span', { class: 'tag' }, r.ruleId) },
        { label: 'Explanation', hideSm: true, render: (r) => h('span', { class: 'muted' }, r.explanation) },
      ],
      emptyNode: emptyState({ title: view.tab === 'breaks' ? 'No transaction breaks' : 'No results match', body: view.tab === 'breaks' ? 'Batch-level breaks are on the Batches tab.' : undefined }),
    }), foot);
  };
  draw();
  return h('div', { class: 'panel' }, tabHost, body);
}
