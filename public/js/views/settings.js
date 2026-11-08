import { h, clear } from '../dom.js';
import { api } from '../api.js';
import { route } from '../router.js';
import { asyncRegion, pageHead, panel, kv, button, alertBox, dataTable, tableFoot, field, withBusy, toast, confirmDialog, emptyState } from '../ui.js';
import { formatDateTime, formatPaise, parseRupeesInput } from '../format.js';
import { can } from '../shell.js';

const RULES = [
  ['R01', 'Exact reference and amount match', 'Same reference and direction, same amount (or within the amount tolerance when exactly one record is left on each side).'],
  ['R02', 'Reference match with amount mismatch', 'Exactly one unpaired record on each side for a reference, with different amounts.'],
  ['R09', 'Ambiguity guard', 'Several unpaired records on both sides of a reference that cannot be paired one-to-one. Nothing is guessed; every record becomes a break.'],
  ['R03', 'Duplicate settlement reference', 'Settlement lines left over for a reference whose ledger entries were already settled.'],
  ['R04', 'Pending within settlement window', 'Ledger entry with no settlement yet, as-of date not past recorded date + window.'],
  ['R05', 'Missing internal ledger record', 'Settlement line for a reference that has no ledger record.'],
  ['R06', 'Missing settlement after window', 'Ledger entry still unsettled after its window closed.'],
  ['R07', 'Batch payout reconciliation', 'Declared gross, fees and payout compared with the sum of the batch’s lines.'],
  ['R08', 'Fee variance', 'Fee charged differs from the fee at the configured rate by more than the fee tolerance.'],
];

route('/settings', async ({ container }) => {
  container.append(pageHead({ title: 'Settings', sub: 'Matching tolerances and fee expectations. A change creates a new version and applies to future runs only; finished runs keep the configuration they used.' }));
  const region = h('div', { class: 'stack' });
  container.append(region);
  const list = asyncRegion(region, { load: async () => (await api.get('/api/settings')).data, render: (s) => render(s, () => list.reload()) });
}, { title: 'Settings', permission: 'settings:read', nav: 'settings' });

function render(s, reload) {
  const editable = can('settings:update');
  const nodes = [];
  if (!editable) nodes.push(alertBox('info', null, 'Settings are read-only for your role. Supervisors can change them.'));

  const window_ = h('input', { class: 'input', type: 'number', min: '0', max: '30', step: '1', value: s.settlementWindowDays, disabled: !editable });
  const amountTol = h('input', { class: 'input', inputmode: 'decimal', value: (s.amountTolerancePaise / 100).toFixed(2), disabled: !editable });
  const rate = h('input', { class: 'input', inputmode: 'decimal', value: s.feeRatePercent, disabled: !editable });
  const feeTol = h('input', { class: 'input', inputmode: 'decimal', value: (s.feeTolerancePaise / 100).toFixed(2), disabled: !editable });
  const note = h('input', { class: 'input', maxlength: '200', placeholder: 'Why is this changing?', disabled: !editable });
  const err = h('div');
  const save = button({ label: 'Save as new version', variant: 'primary', type: 'submit', disabled: !editable });
  const form = h('form', { novalidate: true },
    h('div', { class: 'form-grid' },
      field('Settlement window (days)', window_, { hint: 'Calendar days after the recorded date before an unsettled entry becomes a break.' }),
      field('Amount tolerance (₹)', amountTol, { hint: 'Largest amount difference still treated as a match.' }),
      field('Expected fee rate (%)', rate, { hint: 'Up to four decimals. Fee is rounded half up to the paisa.' }),
      field('Fee tolerance (₹)', feeTol, { hint: 'Largest fee difference not reported as a variance.' }),
      field('Change note', note, { className: 'wide' })),
    err, editable && h('div', { class: 'form-actions' }, save));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(err);
    const a = parseRupeesInput(amountTol.value); const t = parseRupeesInput(feeTol.value);
    const days = Number(window_.value);
    const problems = [];
    if (!Number.isInteger(days) || days < 0 || days > 30) problems.push('Settlement window must be a whole number from 0 to 30.');
    if (a === null) problems.push('Amount tolerance must be an amount such as 0.50.');
    if (t === null) problems.push('Fee tolerance must be an amount such as 0.01.');
    if (!/^\d{1,2}(\.\d{1,4})?$/.test(rate.value.trim()) || Number(rate.value) > 20) problems.push('Fee rate must be between 0 and 20 with at most four decimals.');
    if (problems.length) { err.append(alertBox('bad', 'Check these fields', h('ul', null, problems.map((p) => h('li', null, p))))); return; }
    const ok = await confirmDialog({ title: 'Save new settings version?', message: `Version ${s.version + 1} will apply to runs queued from now on. Finished runs are not affected.`, confirmLabel: 'Save version' });
    if (!ok) return;
    await withBusy(save, async () => {
      try {
        await api.put('/api/settings', { settlementWindowDays: days, amountTolerancePaise: a, feeRatePercent: rate.value.trim(), feeTolerancePaise: t, note: note.value.trim() || undefined, expectedVersion: s.version });
        toast(`Settings saved as version ${s.version + 1}`);
        reload();
      } catch (ex) {
        clear(err).append(alertBox(ex.code === 'SETTINGS_STALE' ? 'warn' : 'bad', ex.code === 'SETTINGS_STALE' ? 'Settings changed while you were editing' : 'Could not save', ex.message));
        if (ex.code === 'SETTINGS_STALE') reload();
      }
    });
  });
  nodes.push(panel(`Current settings · version ${s.version}`, form, { flush: false, sub: s.changedBy ? `set by ${s.changedBy}, ${formatDateTime(s.createdAt)}` : 'initial defaults' }));

  const histRegion = h('div');
  const state = { page: 1 };
  const hist = asyncRegion(histRegion, {
    load: () => api.get('/api/settings/history', { page: state.page, pageSize: 10 }),
    render: (res) => h('div', null, dataTable({
      caption: 'Settings history',
      columns: [
        { label: 'Version', render: (v) => `v${v.version}` }, { label: 'Window', align: 'num', render: (v) => `${v.settlementWindowDays} d` },
        { label: 'Fee rate', align: 'num', render: (v) => `${v.feeRatePercent}%` }, { label: 'Fee tol.', align: 'num', render: (v) => formatPaise(v.feeTolerancePaise) },
        { label: 'Amount tol.', align: 'num', hideSm: true, render: (v) => formatPaise(v.amountTolerancePaise) },
        { label: 'Changed', hideSm: true, render: (v) => h('div', null, v.changedBy || 'System', h('span', { class: 'cell-sub' }, formatDateTime(v.createdAt))) },
        { label: 'Note', hideSm: true, render: (v) => v.note || '—' },
      ],
      rows: res.data, emptyNode: emptyState({ title: 'No history' }),
    }), tableFoot(res.page, (p) => { state.page = p; hist.reload(); }, 'versions')),
  });
  nodes.push(panel('Version history', histRegion));

  nodes.push(panel('Matching rules', h('div', { class: 'panel-body' }, h('p', { class: 'hint' }, 'Rules claim records in this order. The sequence is fixed and the same for every run.'),
    h('ol', { class: 'rules-list' }, RULES.map(([id, name, desc]) => h('li', null, h('span', { class: 'tag' }, id), h('div', null, h('strong', null, name), h('div', { class: 'muted' }, desc)))))), { flush: false }));
  return h('div', { class: 'stack' }, nodes);
}
