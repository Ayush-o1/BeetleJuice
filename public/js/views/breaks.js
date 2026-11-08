import { h, clear, debounce } from '../dom.js';
import { api, exportUrl } from '../api.js';
import { route, setQuery } from '../router.js';
import { asyncRegion, pageHead, panel, figures, figure, kv, button, badge, dataTable, tableFoot, emptyState, alertBox, withBusy, toast, ref, money, field, select, statusBadge, typeBadge, outcomeBadge, openDialog, confirmDialog, reasonDialog } from '../ui.js';
import { formatDateTime, formatDate, formatInt, formatPaise, ageLabel, shortHash, parseRupeesInput, BREAK_TYPES, BREAK_STATUS, RESOLUTIONS, SIDES } from '../format.js';
import { icon } from '../icons.js';
import { can, session } from '../shell.js';

/* ---------- queue ---------- */

const FILTER_KEYS = ['q', 'status', 'type', 'side', 'batch', 'runId', 'minAmount', 'maxAmount', 'minAge', 'maxAge', 'from', 'to'];
const FILTER_LABELS = { q: 'Reference', status: 'Status', type: 'Type', side: 'Source', batch: 'Batch', runId: 'Run', minAmount: 'Min amount', maxAmount: 'Max amount', minAge: 'Min age', maxAge: 'Max age', from: 'From', to: 'To' };

route('/breaks', async ({ container, query }) => {
  // status defaults to "unresolved" unless the URL says otherwise (an explicit empty value means all)
  const f = { status: 'status' in query ? query.status : 'unresolved', sort: query.sort || 'age:desc', page: Number(query.page) || 1 };
  for (const k of FILTER_KEYS) if (k !== 'status' && query[k]) f[k] = query[k];

  const region = h('div');
  const chipHost = h('div');
  const moreRow = h('div', { class: 'filters', hidden: !['batch', 'runId', 'minAmount', 'maxAmount', 'minAge', 'maxAge', 'from', 'to'].some((k) => f[k]) });

  const apply = (patch) => { Object.assign(f, patch, { page: patch.page ?? 1 }); setQuery({ ...patch, status: f.status, page: f.page === 1 ? '' : f.page }); drawChips(); list.reload(); };
  const controls = {};
  const input = (key, props = {}) => { const el = h('input', { class: 'input', value: f[key] || '', 'aria-label': FILTER_LABELS[key], ...props }); controls[key] = el; return el; };
  const debounced = debounce((key, value) => apply({ [key]: value }), 300);
  const text = (key, props) => { const el = input(key, props); el.addEventListener('input', () => debounced(key, el.value.trim())); return el; };
  const amount = (key) => {
    const el = input(key, { inputmode: 'decimal', placeholder: '0.00' });
    el.addEventListener('input', () => {
      const bad = el.value.trim() && parseRupeesInput(el.value) === null;
      el.setAttribute('aria-invalid', String(Boolean(bad)));
      if (!bad) debounced(key, el.value.trim().replace(/,/g, ''));
    });
    return el;
  };
  const sel = (key, options) => { const el = select(options, f[key] || '', { 'aria-label': FILTER_LABELS[key], onchange: (e) => apply({ [key]: e.target.value }) }); controls[key] = el; return el; };
  const statusSelect = select([['unresolved', 'Unresolved'], ['open', 'Open'], ['pending_review', 'Awaiting review'], ['resolved', 'Resolved'], ['', 'All statuses']], f.status, { 'aria-label': 'Status', onchange: (e) => apply({ status: e.target.value }) });
  controls.status = statusSelect;
  const syncControls = () => { for (const [k, el] of Object.entries(controls)) el.value = f[k] || ''; };

  const primary = h('div', { class: 'filters' },
    field('Search reference', text('q', { type: 'search', placeholder: 'e.g. PAY-1042', 'aria-label': 'Search reference' }), { className: 'wide' }),
    field('Status', statusSelect),
    field('Type', sel('type', [['', 'All types'], ...Object.entries(BREAK_TYPES)])),
    field('Source', sel('side', [['', 'Any source'], ...Object.entries(SIDES)])),
    button({ label: moreRow.hidden ? 'More filters' : 'Fewer filters', variant: 'ghost', small: true, onClick: (e) => { moreRow.hidden = !moreRow.hidden; e.currentTarget.querySelector('span').textContent = moreRow.hidden ? 'More filters' : 'Fewer filters'; } }));
  moreRow.append(
    field('Batch', text('batch', { placeholder: 'B-1001' }), { className: 'narrow' }), field('Run', text('runId', { inputmode: 'numeric', placeholder: '#' }), { className: 'narrow' }),
    field('Min amount (₹)', amount('minAmount'), { className: 'narrow' }), field('Max amount (₹)', amount('maxAmount'), { className: 'narrow' }),
    field('Min age (days)', text('minAge', { inputmode: 'numeric' }), { className: 'narrow' }), field('Max age (days)', text('maxAge', { inputmode: 'numeric' }), { className: 'narrow' }),
    field('Reference date from', input('from', { type: 'date', onchange: (e) => apply({ from: e.target.value }) })), field('to', input('to', { type: 'date', onchange: (e) => apply({ to: e.target.value }) })));

  function drawChips() {
    const active = FILTER_KEYS.filter((k) => f[k] && !(k === 'status' && f.status === 'unresolved'));
    clear(chipHost);
    if (!active.length) return;
    const label = (k) => (k === 'type' ? BREAK_TYPES[f[k]] : k === 'status' ? (BREAK_STATUS[f[k]] || f[k]) : k === 'side' ? SIDES[f[k]] : f[k]);
    const resetOne = (k) => { apply({ [k]: k === 'status' ? 'unresolved' : '' }); syncControls(); };
    const resetAll = () => { apply(Object.fromEntries(FILTER_KEYS.map((k) => [k, k === 'status' ? 'unresolved' : '']))); syncControls(); };
    chipHost.append(h('div', { class: 'chips' }, h('span', { class: 'muted' }, 'Filtered by'),
      active.map((k) => h('span', { class: 'chip' }, `${FILTER_LABELS[k]}: ${label(k)}`,
        h('button', { type: 'button', 'aria-label': `Remove ${FILTER_LABELS[k]} filter`, onclick: () => resetOne(k) }, icon('x', { size: 12 })))),
      button({ label: 'Clear all', variant: 'ghost', small: true, onClick: resetAll })));
  }

  const list = asyncRegion(region, {
    load: () => api.get('/api/breaks', queryFor(f)),
    render: (res) => h('div', null, dataTable({
      caption: 'Break queue', sort: f.sort, onSort: (key, dir) => apply({ sort: `${key}:${dir}` }),
      columns: [
        { label: 'Reference', sortKey: 'reference', render: (b) => h('div', null, h('a', { href: `#/breaks/${b.id}`, class: 'ref' }, b.reference || b.batchRef), h('span', { class: 'cell-sub' }, `Break #${b.id}`)) },
        { label: 'Type', sortKey: 'type', render: (b) => typeBadge(b.type) },
        { label: 'Status', sortKey: 'status', render: (b) => statusBadge(b.status) },
        { label: 'Amount at issue', align: 'num', sortKey: 'impact', render: (b) => money(b.impactPaise) },
        { label: 'Ledger', align: 'num', hideSm: true, render: (b) => money(b.ledgerAmountPaise) },
        { label: 'Settlement', align: 'num', hideSm: true, render: (b) => money(b.settlementAmountPaise) },
        { label: 'Ref. date', sortKey: 'date', hideSm: true, render: (b) => formatDate(b.referenceDate) },
        { label: 'Age', align: 'num', sortKey: 'age', render: (b) => ageLabel(b.ageDays) },
        { label: 'Batch / run', hideSm: true, render: (b) => h('span', { class: 'ref faint' }, b.batchRef ? `${b.batchRef} · run #${b.runId}` : `run #${b.runId}`) },
      ],
      rows: res.data, rowHref: (b) => `/breaks/${b.id}`,
      emptyNode: emptyState({ title: 'No breaks match these filters', body: FILTER_KEYS.some((k) => f[k] && !(k === 'status' && f.status === 'unresolved')) ? 'Remove a filter to widen the search.' : 'There are no unresolved breaks. Completed runs that find differences will list them here.' }),
    }), res.data.length > 0 && tableFoot(res.page, (p) => { f.page = p; setQuery({ page: p }); list.reload(); }, 'breaks')),
  });
  drawChips();

  container.append(
    pageHead({ title: 'Breaks', sub: 'Differences found by reconciliation runs, oldest first by default. Select a break to investigate it.',
      actions: button({ label: 'Export CSV', icon: 'download', href: exportUrl('/api/breaks/export.csv', queryFor(f, true)) }) }),
    h('div', { class: 'panel' }, primary, moreRow, chipHost, region));
}, { title: 'Breaks', permission: 'breaks:read', nav: 'breaks' });

function queryFor(f, forExport = false) {
  const q = {};
  for (const k of FILTER_KEYS) if (f[k]) q[k] = f[k];
  if (!forExport) { q.sort = f.sort; q.page = f.page; q.pageSize = 25; }
  return q;
}

/* ---------- detail ---------- */

const ACTION_LABELS = {
  'break.created': ['Break created by run', 'info'], 'break.note_added': ['Investigation note added', 'info'],
  'proposal.created': ['Resolution proposed', 'warn'], 'proposal.approved': ['Proposal approved', 'ok'], 'proposal.rejected': ['Proposal rejected', 'bad'],
  'break.resolved': ['Break resolved', 'ok'], 'break.reopened': ['Break reopened', 'warn'], 'proposal.self_decision_blocked': ['Self-review attempt blocked', 'bad'],
};

route('/breaks/:id', async ({ container, params }) => {
  const region = h('div', { class: 'stack' });
  container.append(region);
  const list = asyncRegion(region, { load: async () => (await api.get(`/api/breaks/${params.id}`)).data, render: (b) => renderBreak(b, () => list.reload()) });
}, { title: 'Break', permission: 'breaks:read', nav: 'breaks' });

function renderBreak(b, reload) {
  const r = b.result;
  const isBatch = r.scope === 'BATCH';
  const title = h('span', { class: 'row' }, h('span', { class: 'mono' }, b.reference || b.batchRef), typeBadge(b.type), statusBadge(b.status));

  const finding = h('div', { class: 'finding' },
    h('div', null, r.explanation),
    h('div', { class: 'rule' }, `Rule ${r.ruleId} · ${r.ruleName} · run #${b.runId} as of ${formatDate(b.runAsOfDate)} (settings v${b.run.settingsVersion})`));
  const figs = figures(
    figure('Amount at issue', formatPaise(b.impactPaise)),
    figure(isBatch ? 'Payout difference' : b.type === 'FEE_VARIANCE' ? 'Fee difference' : 'Difference', r.amountDiffPaise === null ? '—' : formatPaise(r.amountDiffPaise, { sign: true })),
    figure('Age', ageLabel(b.ageDays), `Reference date ${formatDate(b.referenceDate)}`),
    figure('Age at run', ageLabel(b.ageAtRunDays), 'Frozen when the run executed'));

  const left = [panel('Finding', h('div', { class: 'panel-body stack' }, finding, figs), { flush: true })];
  left.push(isBatch ? batchPanel(b) : comparePanel(b));
  if (!isBatch && (b.related.ledger.length || b.related.settlement.length)) left.push(relatedPanel(b));
  if (!isBatch && b.batch?.summary) left.push(batchContextPanel(b));

  const right = [resolutionPanel(b, reload), notesPanel(b, reload), timelinePanel(b)];
  if (b.proposals.length > 1 || (b.proposals.length === 1 && b.status !== 'pending_review')) right.push(historyPanel(b));

  return h('div', { class: 'stack' },
    pageHead({ crumbs: [{ label: 'Breaks', href: '#/breaks' }, { label: `#${b.id}` }], title, sub: h('span', null, 'From ', h('a', { href: `#/runs/${b.runId}` }, `run #${b.runId}`), ' · ', r.groupKey && !isBatch ? `match key ${r.groupKey.replace('|', ' · ')}` : '') }),
    h('div', { class: 'split' }, h('div', { class: 'stack' }, left), h('div', { class: 'stack sticky' }, right)));
}

function cmpRow(label, a, b, diff) {
  const cell = (v) => (v === null || v === undefined ? h('div', { class: diff ? 'diff missing' : 'missing' }, '—') : h('div', { class: diff ? 'diff' : '' }, v));
  return [h('div', { class: 'l' }, label), cell(a), cell(b)];
}

function comparePanel(b) {
  const L = b.ledger; const S = b.settlement; const r = b.result;
  const cells = [h('div', { class: 'h' }, ''), h('div', { class: 'h' }, 'Internal ledger'), h('div', { class: 'h' }, 'Processor settlement')];
  const none = (side) => h('span', { class: 'missing' }, `No ${side} record`);
  const rows = [
    cmpRow('Record id', L && ref(L.ledgerId), S && ref(S.lineId)),
    cmpRow('Source file row', L && `#${L.sourceFileId} · row ${L.rowNumber}`, S && `#${S.sourceFileId} · row ${S.rowNumber}`),
    cmpRow('Reference', L && ref(L.reference), S && ref(S.reference)),
    cmpRow('Type', L && (L.entryType === 'REFUND' ? 'Refund' : 'Payment'), S && (S.txnType === 'REFUND' ? 'Refund' : 'Sale')),
    cmpRow('Amount', L && money(L.amountPaise), S && money(S.amountPaise), L && S && L.amountPaise !== S.amountPaise),
    cmpRow('Fee charged', null, S && money(S.feePaise), r.ruleId === 'R08'),
    r.expectedFeePaise !== null && cmpRow('Fee expected', null, money(r.expectedFeePaise), r.ruleId === 'R08'),
    cmpRow('Recorded / settled', L && h('span', null, formatDateTime(L.recordedAt), h('span', { class: 'cell-sub' }, `Business date ${formatDate(L.businessDate)}`)), S && formatDate(S.settledOn)),
    cmpRow('Merchant / batch', L && L.merchant, S && h('a', { href: `#/breaks?batch=${encodeURIComponent(S.batchRef)}&status=` }, S.batchRef)),
  ].filter(Boolean).flat();
  const body = h('div', { class: 'compare' }, cells, rows);
  if (!L) body.prepend();
  return panel('Records compared', h('div', null, body, (!L || !S) && h('div', { class: 'panel-foot muted' }, !L ? 'The processor settled this reference but the ledger has no matching record.' : 'The ledger has this record but no settlement line was matched to it.')), { flush: true });
}

function batchPanel(b) {
  const d = b.result.details;
  const c = d.computed; const dec = d.declared;
  const rows = dec ? [
    cmpRow('Gross amount', money(dec.grossPaise), money(c.grossPaise), d.diffs.grossPaise !== 0),
    cmpRow('Processing fees', money(dec.feesPaise), money(c.feesPaise), d.diffs.feesPaise !== 0),
    cmpRow('Payout', money(dec.payoutPaise), money(c.expectedNetPaise), d.diffs.payoutPaise !== 0),
    cmpRow('Fees at configured rate', null, money(c.rateExpectedFeesPaise)),
    cmpRow('Lines in batch', null, formatInt(c.lineCount)),
  ].flat() : cmpRow('Expected payout', null, money(c.expectedNetPaise)).concat(cmpRow('Lines in batch', null, formatInt(c.lineCount)));
  return panel(`Batch ${b.batchRef}`, h('div', null,
    h('div', { class: 'compare' }, h('div', { class: 'h' }, ''), h('div', { class: 'h' }, 'Declared by processor'), h('div', { class: 'h' }, 'Computed from lines'), rows),
    h('div', { class: 'panel-foot muted' }, 'Computed gross is the sum of settlement lines; expected payout is gross less the fees charged on those lines.')), { flush: true });
}

function relatedPanel(b) {
  const rows = [...b.related.ledger.map((x) => ({ src: 'Ledger', id: x.ledgerId, amount: x.amountPaise, date: x.businessDate })), ...b.related.settlement.map((x) => ({ src: 'Settlement', id: x.lineId, amount: x.amountPaise, date: x.settledOn, batch: x.batchRef }))];
  return panel('Other records with this reference', dataTable({
    caption: 'Other records with the same reference', rows,
    columns: [{ label: 'Source', render: (x) => x.src }, { label: 'Id', render: (x) => ref(x.id) }, { label: 'Amount', align: 'num', render: (x) => money(x.amount) }, { label: 'Date', render: (x) => formatDate(x.date) }, { label: 'Batch', render: (x) => (x.batch ? ref(x.batch) : '—') }],
  }), { sub: 'in the same source files' });
}

function batchContextPanel(b) {
  const { summary, result } = b.batch;
  return panel(`Batch context · ${summary.batchRef}`, h('div', { class: 'panel-body' }, kv([
    ['Batch result', result ? outcomeBadge(result.outcome) : '—'], ['Settled on', formatDate(summary.settledOn)], ['Declared gross', money(summary.declaredGrossPaise)],
    ['Declared fees', money(summary.declaredFeePaise)], ['Declared payout', money(summary.declaredPayoutPaise)], ['Explanation', result?.explanation],
  ])), { flush: false });
}

/* ---------- resolution workflow ---------- */

function resolutionPanel(b, reload) {
  const pending = b.proposals.find((p) => p.status === 'pending');
  const body = h('div', { class: 'panel-body stack' });

  if (b.status === 'resolved') {
    const approved = b.proposals.find((p) => p.status === 'approved');
    body.append(alertBox('ok', `Resolved: ${RESOLUTIONS[b.resolutionCode]}`, approved && `Approved by ${approved.decidedByName} on ${formatDateTime(approved.decidedAt)}.`), approved && h('p', { class: 'muted' }, approved.note));
  } else if (pending) {
    body.append(h('div', null, h('div', { class: 'row' }, badge('info', 'Awaiting review'), h('strong', null, RESOLUTIONS[pending.resolutionCode])), h('p', { class: 'muted', style: undefined }, pending.note), h('p', { class: 'hint' }, `Proposed by ${pending.proposedByName} on ${formatDateTime(pending.createdAt)}`)));
    if (can('proposals:decide')) {
      if (pending.proposedById === session.user.id) body.append(alertBox('info', null, 'You proposed this resolution, so a different supervisor must review it.'));
      else body.append(h('div', { class: 'decision-actions' },
        button({ label: 'Approve', icon: 'check', variant: 'primary', onClick: (e) => decide(e.currentTarget, 'approved', pending, b, reload) }),
        button({ label: 'Reject', icon: 'x', onClick: (e) => decide(e.currentTarget, 'rejected', pending, b, reload) })));
    } else body.append(h('p', { class: 'hint' }, 'A supervisor will review this proposal.'));
  } else if (can('proposals:create')) {
    body.append(proposalForm(b, reload));
  } else {
    body.append(h('p', { class: 'muted' }, 'No resolution has been proposed. Only analysts can propose a resolution.'));
  }
  return panel('Resolution', body, { flush: true });
}

function proposalForm(b, reload) {
  const code = select([['', 'Choose a resolution…'], ...Object.entries(RESOLUTIONS)], '', { required: true });
  const note = h('textarea', { class: 'textarea', maxlength: '2000', rows: '4', placeholder: 'What did you find, and why is this the right outcome?', required: true });
  const err = h('div');
  const submit = button({ label: 'Submit for review', icon: 'review', variant: 'primary', type: 'submit' });
  const form = h('form', { novalidate: true }, field('Proposed resolution', code), field('Explanation', note, { hint: 'At least 10 characters. A supervisor will see this.' }), err, h('div', { class: 'form-actions' }, submit));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(err);
    if (!code.value) { err.append(alertBox('bad', null, 'Choose a resolution.')); return; }
    if (note.value.trim().length < 10) { err.append(alertBox('bad', null, 'Explain the proposal in at least 10 characters.')); return; }
    const ok = await confirmDialog({ title: 'Submit for review?', message: `“${RESOLUTIONS[code.value]}” will be sent to a supervisor. You will not be able to edit it afterwards.`, confirmLabel: 'Submit' });
    if (!ok) return;
    await withBusy(submit, async () => {
      try {
        await api.post(`/api/breaks/${b.id}/proposals`, { resolutionCode: code.value, note: note.value.trim(), breakVersion: b.version });
        toast('Proposal submitted for review');
        window.dispatchEvent(new Event('bj:refresh-nav'));
        reload();
      } catch (ex) { handleConflict(ex, err, reload); }
    });
  });
  return form;
}

async function decide(btn, decision, proposal, b, reload) {
  const approve = decision === 'approved';
  const result = await reasonDialog({
    title: approve ? 'Approve this resolution?' : 'Reject this resolution?',
    message: approve ? `This marks the break as resolved (“${RESOLUTIONS[proposal.resolutionCode]}”). A resolved break cannot be changed.` : 'The break returns to the analyst queue and the proposal stays on record.',
    label: approve ? 'Comment' : 'Reason for rejection', optional: approve, minLength: 5, confirmLabel: approve ? 'Approve' : 'Reject', danger: !approve,
  });
  if (result === null) return;
  await withBusy(btn, async () => {
    try {
      await api.post(`/api/proposals/${proposal.id}/decision`, { decision, note: result || undefined, breakVersion: b.version });
      toast(approve ? 'Resolution approved' : 'Resolution rejected');
      window.dispatchEvent(new Event('bj:refresh-nav'));
    } catch (ex) {
      toast(ex.status === 409 ? 'This break changed while you were reviewing it. It has been reloaded.' : ex.message, 'bad');
    }
    reload();
  });
}

function handleConflict(ex, host, reload) {
  if (ex.status === 409) { toast('This break changed since you opened it. It has been reloaded.', 'bad'); reload(); return; }
  clear(host).append(alertBox('bad', 'Could not submit', ex.message));
}

function notesPanel(b, reload) {
  const body = h('div', { class: 'panel-body' }, b.notes.length ? b.notes.map((n) => h('div', { class: 'note' }, h('span', { class: 'who' }, n.authorName), h('span', { class: 'when' }, formatDateTime(n.createdAt)), h('p', null, n.body))) : h('p', { class: 'muted' }, 'No investigation notes yet.'));
  if (can('breaks:note') && b.status !== 'resolved') {
    const ta = h('textarea', { class: 'textarea', maxlength: '2000', rows: '3', placeholder: 'Record what you checked or learned', 'aria-label': 'New note' });
    const add = button({ label: 'Add note', variant: 'secondary', small: true, type: 'submit' });
    const form = h('form', null, ta, h('div', { class: 'form-actions' }, add));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!ta.value.trim()) return;
      await withBusy(add, async () => {
        try { await api.post(`/api/breaks/${b.id}/notes`, { body: ta.value.trim() }); toast('Note added'); reload(); } catch (ex) { toast(ex.message, 'bad'); }
      });
    });
    body.append(h('div', { class: 'note' }, form));
  }
  return panel('Investigation notes', body, { sub: String(b.notes.length) });
}

function timelinePanel(b) {
  const items = b.timeline.map((e) => {
    const [label, kind] = ACTION_LABELS[e.action] || [e.action, 'info'];
    const extra = e.action === 'break.created' ? ` #${b.runId}` : '';
    return h('li', { class: `t-${kind}` }, h('div', null, `${label}${extra}`, e.actor ? ` — ${e.actor}` : ''), h('div', { class: 'when' }, formatDateTime(e.occurredAt)));
  });
  return panel('Timeline', h('div', { class: 'panel-body' }, h('ol', { class: 'timeline' }, items)), { flush: false });
}

function historyPanel(b) {
  return panel('Proposal history', h('div', { class: 'panel-body' }, b.proposals.map((p) => h('div', { class: 'proposal' },
    h('div', { class: 'head' }, h('strong', null, RESOLUTIONS[p.resolutionCode]), badge({ pending: 'info', approved: 'ok', rejected: 'bad' }[p.status], p.status === 'pending' ? 'Awaiting review' : p.status === 'approved' ? 'Approved' : 'Rejected')),
    h('p', null, p.note), h('p', { class: 'hint' }, `${p.proposedByName} · ${formatDateTime(p.createdAt)}`),
    p.decision && h('p', { class: 'hint' }, `${p.decision === 'approved' ? 'Approved' : 'Rejected'} by ${p.decidedByName}${p.decisionNote ? `: “${p.decisionNote}”` : ''}`)))), { flush: false });
}
