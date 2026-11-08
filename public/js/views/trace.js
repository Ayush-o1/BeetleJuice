import { h } from '../dom.js';
import { api } from '../api.js';
import { route } from '../router.js';
import { asyncRegion, pageHead, panel, dataTable, emptyState, alertBox, ref, money, outcomeBadge, typeBadge, statusBadge } from '../ui.js';
import { formatDate, formatDateTime, plural, BREAK_TYPES, OUTCOMES } from '../format.js';

route('/trace', async ({ container, query }) => {
  const reference = (query.reference || '').trim();
  container.append(pageHead({ title: 'Find a reference', sub: 'Every ledger entry and settlement line that carries a reference, and what each completed run decided about it. Matching is exact and ignores case.' }));
  if (reference.length < 2) {
    container.append(panel(null, emptyState({ title: 'Enter a reference', body: 'Use the search box at the top of the page, for example PAY-2611-00296.' })));
    return;
  }
  const region = h('div', { class: 'stack' });
  container.append(region);
  asyncRegion(region, { load: async () => (await api.get('/api/trace', { reference })).data, render: renderTrace });
}, { title: 'Find a reference', permission: 'breaks:read', nav: 'breaks' });

function renderTrace(d) {
  const nothing = !d.ledger.length && !d.settlement.length;
  if (nothing) {
    return panel(null, emptyState({ title: `No record carries “${d.reference}”`, body: 'It does not appear in any uploaded ledger or settlement file. Check the spelling, or whether the file containing it has been uploaded yet.' }));
  }
  const latest = d.results[0];
  const latestRun = latest ? d.results.filter((r) => r.runId === latest.runId) : [];
  const summary = !latest ? 'No completed run has included these records yet.'
    : latestRun.length === 1 ? `Latest completed run (#${latest.runId}) says: ${latest.explanation}`
      : `Latest completed run (#${latest.runId}) produced ${latestRun.length} results for this reference: ${[...new Set(latestRun.map((r) => (r.breakType ? BREAK_TYPES[r.breakType] : OUTCOMES[r.outcome])))].join(', ')}. Each is listed below.`;
  const nodes = [];
  nodes.push(alertBox(latest ? (latest.outcome === 'MATCHED' ? 'ok' : latest.outcome === 'PENDING' ? 'info' : 'warn') : 'info',
    `${d.reference}: ${plural(d.ledger.length, 'ledger entry', 'ledger entries')} and ${plural(d.settlement.length, 'settlement line')}`,
    summary));
  if (d.truncated) nodes.push(alertBox('info', 'Showing the first 50 records on each side', 'Narrow the search by using the full reference.'));

  nodes.push(h('div', { class: 'grid-2' },
    panel('Ledger entries', dataTable({
      caption: 'Ledger entries with this reference', rows: d.ledger, emptyNode: emptyState({ title: 'None', body: 'No ledger entry carries this reference.' }),
      columns: [
        { label: 'Entry', render: (r) => h('div', null, ref(r.ledgerId), h('span', { class: 'cell-sub' }, `${r.filename} · row ${r.rowNumber}`)) },
        { label: 'Amount', align: 'num', render: (r) => money(r.entryType === 'REFUND' ? -r.amountPaise : r.amountPaise) },
        { label: 'Recorded', render: (r) => h('div', null, formatDateTime(r.recordedAt), h('span', { class: 'cell-sub' }, `${r.entryType === 'REFUND' ? 'Refund' : 'Payment'} · ${r.merchant}`)) },
      ] }), { flush: true }),
    panel('Settlement lines', dataTable({
      caption: 'Settlement lines with this reference', rows: d.settlement, emptyNode: emptyState({ title: 'None', body: 'The processor has not settled this reference in any uploaded file.' }),
      columns: [
        { label: 'Line', render: (r) => h('div', null, ref(r.lineId), h('span', { class: 'cell-sub' }, `${r.filename} · row ${r.rowNumber}`)) },
        { label: 'Amount', align: 'num', render: (r) => h('div', null, money(r.amountPaise), h('span', { class: 'cell-sub' }, `fee ${(r.feePaise / 100).toFixed(2)}`)) },
        { label: 'Settled', render: (r) => h('div', null, formatDate(r.settledOn), h('span', { class: 'cell-sub' }, r.batchRef)) },
      ] }), { flush: true })));

  nodes.push(panel('How each run classified it', dataTable({
    caption: 'Run outcomes for this reference', rows: d.results,
    emptyNode: emptyState({ title: 'Not reconciled yet', body: 'These records have not been part of a completed run.' }),
    columns: [
      { label: 'Run', render: (r) => h('div', null, h('a', { href: `#/runs/${r.runId}` }, `Run #${r.runId}`), h('span', { class: 'cell-sub' }, `as of ${formatDate(r.asOfDate)}`)) },
      { label: 'Outcome', render: (r) => h('div', { class: 'row' }, outcomeBadge(r.outcome), r.breakType && typeBadge(r.breakType)) },
      { label: 'Explanation', class: 'wrap', render: (r) => h('div', null, r.explanation, h('span', { class: 'cell-sub' }, `Rule ${r.ruleId}`)) },
      { label: 'Break', render: (r) => (r.breakId ? h('div', null, h('a', { href: `#/breaks/${r.breakId}` }, `Break #${r.breakId}`)) : '—') },
      { label: 'Status', render: (r) => (r.breakStatus ? statusBadge(r.breakStatus) : '—') },
    ] }), { flush: true }));
  return h('div', { class: 'stack' }, nodes);
}
