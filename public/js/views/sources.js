import { h, clear } from '../dom.js';
import { api, exportUrl } from '../api.js';
import { route, setQuery } from '../router.js';
import { asyncRegion, pageHead, panel, figures, figure, kv, button, badge, dataTable, tableFoot, tabs, emptyState, alertBox, withBusy, toast, ref, money, field, errorState } from '../ui.js';
import { formatDateTime, formatDate, formatInt, formatPaise, shortHash, plural } from '../format.js';
import { icon } from '../icons.js';
import { can } from '../shell.js';
import { debounce } from '../dom.js';
import { LEDGER_TEMPLATE, SETTLEMENT_TEMPLATE, toCsvText } from '../templates.js';

const FORMATS = {
  ledger: {
    title: 'Internal ledger export',
    note: 'Amounts are positive; entry_type gives the direction. Timestamps need an explicit offset such as +05:30.',
    columns: [['ledger_id', 'Unique id of the ledger entry within the file'], ['reference', 'Payment reference shared with the processor'], ['merchant', 'Merchant name'], ['entry_type', 'PAYMENT or REFUND'], ['amount', 'Rupees, up to two decimals, no separators'], ['currency', 'INR'], ['recorded_at', 'ISO-8601 with offset, e.g. 2026-11-06T14:30:00+05:30']],
  },
  settlement: {
    title: 'Processor settlement export',
    note: 'One file holds TXN rows (settled lines, signed amounts: refunds negative) and one BATCH row per payout with the declared totals.',
    columns: [['record_type', 'TXN or BATCH'], ['batch_id', 'Processor batch identifier'], ['line_id', 'TXN only: unique line id'], ['reference', 'TXN only: payment reference'], ['txn_type', 'TXN only: SALE or REFUND'], ['amount', 'TXN only: signed rupees'], ['fee', 'TXN only: fee charged, ≥ 0'], ['currency', 'INR'], ['settled_on', 'YYYY-MM-DD'], ['batch_gross, batch_fee, batch_payout', 'BATCH only: declared totals']],
  },
};

route('/sources', async ({ container, query }) => {
  container.append(pageHead({
    title: 'Sources', sub: 'Uploaded ledger and processor settlement files. Each file is fingerprinted, validated row by row and kept unchanged.',
    actions: can('sources:upload') && button({ label: 'Upload file', icon: 'upload', variant: 'primary', onClick: () => { uploadSlot.hidden = false; uploadSlot.querySelector('input[type=file]')?.focus(); uploadSlot.scrollIntoView({ block: 'nearest' }); } }),
  }));
  const uploadSlot = h('div', { hidden: !(query.upload && can('sources:upload')) });
  if (can('sources:upload')) uploadSlot.append(uploadPanel(() => list.reload()));
  const region = h('div');
  const state = { kind: query.kind || '', page: Number(query.page) || 1 };
  const shell = h('div', { class: 'panel' });
  const tabRow = h('div');
  const drawTabs = () => clear(tabRow).append(tabs([['', 'All'], ['ledger', 'Ledger'], ['settlement', 'Settlement']], state.kind, (k) => { state.kind = k; state.page = 1; setQuery({ kind: k, page: '' }); drawTabs(); list.reload(); }));
  drawTabs();
  shell.append(tabRow, region);
  container.append(h('div', { class: 'stack' }, uploadSlot, shell));
  const list = asyncRegion(region, {
    load: () => api.get('/api/sources', { kind: state.kind, page: state.page, pageSize: 25 }),
    render: (res) => h('div', null, dataTable({
      caption: 'Uploaded source files',
      columns: [
        { label: 'File', render: (f) => h('div', null, h('a', { href: `#/sources/${f.id}` }, f.filename), h('span', { class: 'cell-sub ref' }, shortHash(f.sha256))) },
        { label: 'Type', render: (f) => badge(f.kind === 'ledger' ? 'info' : 'neutral', f.kind === 'ledger' ? 'Ledger' : 'Settlement', 'badge-plain') },
        { label: 'Rows accepted', align: 'num', render: (f) => formatInt(f.acceptedRows) },
        { label: 'Rejected', align: 'num', render: (f) => (f.rejectedRows ? badge('warn', formatInt(f.rejectedRows), 'badge-plain') : h('span', { class: 'faint' }, '0')) },
        { label: 'Used in runs', align: 'num', hideSm: true, render: (f) => f.runCount },
        { label: 'Uploaded', hideSm: true, render: (f) => h('div', null, formatDateTime(f.uploadedAt), h('span', { class: 'cell-sub' }, `by ${f.uploadedByName}`)) },
      ],
      rows: res.data, rowHref: (f) => `/sources/${f.id}`,
      emptyNode: emptyState({ title: 'No files uploaded', body: can('sources:upload') ? 'Upload a ledger export and a processor settlement export to begin.' : 'No source files have been uploaded yet.' }),
    }), res.data.length > 0 && tableFoot(res.page, (p) => { state.page = p; setQuery({ page: p > 1 ? p : "" }); list.reload(); }, 'files')),
  });
}, { title: 'Sources', permission: 'sources:read', nav: 'sources' });

/* ---------- upload ---------- */

function uploadPanel(onDone) {
  let kind = 'ledger';
  let file = null;
  const body = h('div', { class: 'panel-body stack' });
  const result = h('div');
  const picker = h('input', { type: 'file', accept: '.csv,text/csv', class: 'sr-only', id: 'file-input' });
  const picked = h('div', { class: 'muted' }, 'Drop a .csv file here, or ');
  const zone = h('div', { class: 'dropzone' }, picked);
  const help = h('div');
  const submit = button({ label: 'Upload and validate', icon: 'upload', variant: 'primary', type: 'submit', disabled: true });
  const bar = h('progress', { class: 'upload-bar', max: '100', value: '0', 'aria-label': 'Upload progress' });
  const progress = h('div', { class: 'upload-progress', hidden: true, role: 'status' }, bar, h('span', { class: 'muted' }));
  const showProgress = (loaded, total) => {
    progress.hidden = false;
    const done = loaded >= total;
    bar.value = Math.round((loaded / total) * 100);
    bar.toggleAttribute('value', !done);          // indeterminate once all bytes are sent: the server is validating, and no percentage exists for that
    progress.lastChild.textContent = done ? 'File received. Validating every row…' : `Uploading… ${Math.round((loaded / total) * 100)}% (${(loaded / 1024).toFixed(0)} of ${(total / 1024).toFixed(0)} KB)`;
    if (!done) bar.value = Math.round((loaded / total) * 100);
  };

  const chooseBtn = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => picker.click() }, 'choose a file');
  const setFile = (f) => {
    file = f;
    submit.disabled = !f;
    picked.replaceChildren(f ? h('span', { class: 'picked' }, `${f.name} · ${(f.size / 1024).toFixed(1)} KB`) : 'Drop a .csv file here, or ', chooseBtn);
  };
  setFile(null);
  picker.addEventListener('change', () => setFile(picker.files[0] || null));
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });

  const drawHelp = () => {
    const f = FORMATS[kind];
    clear(help).append(h('details', null, h('summary', { class: 'muted', style: undefined }, `Expected columns for the ${f.title.toLowerCase()}`),
      h('p', { class: 'hint' }, f.note),
      h('table', { class: 'data-table' }, h('caption', null, 'Expected columns'), h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Column'), h('th', { scope: 'col' }, 'Meaning'))),
        h('tbody', null, f.columns.map(([c, d]) => h('tr', null, h('td', { class: 'ref' }, c), h('td', null, d)))))));
  };
  const radio = (value, title, desc) => h('label', { class: 'radio-card' },
    h('input', { type: 'radio', name: 'kind', value, checked: value === kind, onchange: () => { kind = value; drawHelp(); clear(result); } }),
    h('div', null, h('div', { class: 't' }, title), h('div', { class: 'd' }, desc)));
  drawHelp();

  const form = h('form', null, body);
  body.append(
    h('fieldset', { style: undefined }, h('legend', { class: 'sr-only' }, 'File type'), h('div', { class: 'radio-row' }, radio('ledger', 'Internal ledger', 'Payments recorded by the merchant'), radio('settlement', 'Processor settlement', 'Transactions and batch payouts from the processor'))),
    zone, picker, help, h('div', { class: 'row' }, submit, templateLink()), progress, result);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!file) return;
    clear(result);
    if (!/\.csv$/i.test(file.name)) { result.append(alertBox('bad', 'Choose a .csv file', 'Only CSV exports are accepted. Export the data as CSV and try again.')); return; }
    if (file.size === 0) { result.append(alertBox('bad', 'This file is empty', 'It has no header and no rows.')); return; }
    await withBusy(submit, async () => {
      try {
        showProgress(0, 1);
        const res = await api.upload(kind, file, showProgress);
        clear(result).append(renderUploadReport(res.data));
        toast(`${file.name} ingested`);
        setFile(null); picker.value = '';
        onDone();
      } catch (err) {
        clear(result).append(renderUploadError(err));
      } finally { progress.hidden = true; }
    });
  });
  function templateLink() {
    return button({ label: 'Download a template', icon: 'download', small: true, variant: 'ghost', title: 'A small valid example file for the selected type', onClick: () => {
      const t = kind === 'ledger' ? LEDGER_TEMPLATE : SETTLEMENT_TEMPLATE;
      const url = URL.createObjectURL(new Blob([toCsvText(t)], { type: 'text/csv' }));
      const a = h('a', { href: url, download: t.filename });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } });
  }
  return panel('Upload a source file', form, { flush: false });
}

function renderUploadReport({ file, errors }) {
  const rejected = file.rejectedRows;
  const out = [
    alertBox(rejected ? 'warn' : 'ok', rejected ? 'Upload contains invalid rows' : 'File ingested', rejected
      ? `${file.filename} was stored. ${plural(rejected, 'row')} could not be loaded and ${rejected === 1 ? 'is' : 'are'} listed below.`
      : `${file.filename} passed validation. Every row was loaded.`),
    figures(figure('Rows in file', formatInt(file.totalRows)), figure('Accepted', formatInt(file.acceptedRows), 'Loaded as records'), figure('Rejected', formatInt(file.rejectedRows), rejected ? 'Not loaded' : 'None', rejected ? 'is-warn' : '')),
  ];
  if (rejected) out.push(errorSummary(errors), h('div', { class: 'row' }, button({ label: 'View all rejected rows', href: `#/sources/${file.id}?tab=errors` })));
  out.push(h('div', { class: 'row' }, button({ label: 'Open source', href: `#/sources/${file.id}`, variant: file.kind === 'ledger' || true ? 'secondary' : 'primary' }), button({ label: 'Start a run', icon: 'runs', href: `#/runs?new=1&${file.kind}=${file.id}` })));
  return h('div', { class: 'stack result-figures' }, out);
}

function errorSummary(errors) {
  return h('div', { class: 'stack' },
    h('div', { class: 'code-list' }, Object.entries(errors.byCode).map(([code, n]) => badge('warn', `${code} × ${n}`, 'badge-plain'))),
    h('div', { class: 'panel' }, errorsTable(errors.sample), errors.totalIssues > errors.sample.length && h('div', { class: 'table-foot' }, `Showing the first ${errors.sample.length} of ${formatInt(errors.totalIssues)} issues.`)));
}

function errorsTable(rows) {
  return dataTable({
    caption: 'Rejected rows',
    columns: [
      { label: 'Row', align: 'num', render: (r) => r.rowNumber }, { label: 'Line', align: 'num', hideSm: true, render: (r) => r.lineNumber },
      { label: 'Field', render: (r) => (r.field ? h('span', { class: 'ref' }, r.field) : '—') },
      { label: 'Reason', render: (r) => h('div', null, r.message, h('span', { class: 'cell-sub' }, r.code)) },
      { label: 'Row content', hideSm: true, class: 'truncate', render: (r) => h('span', { class: 'ref faint' }, r.rawExcerpt || '') },
    ],
    rows,
  });
}

function renderUploadError(err) {
  if (err.code === 'DUPLICATE_FILE') {
    return alertBox('warn', 'This file was already uploaded', h('span', null, `${err.message} `, h('a', { href: `#/sources/${err.details.existingSourceId}` }, 'Open the original')));
  }
  const nodes = [alertBox('bad', err.code === 'NO_VALID_ROWS' ? 'No rows could be loaded' : 'File rejected', err.message)];
  if (err.code === 'CSV_HEADER_INVALID' && err.details?.expected) nodes.push(h('p', { class: 'hint' }, `Expected columns: ${err.details.expected.join(', ')}`));
  if (err.details?.errors) nodes.push(errorSummary(err.details.errors));
  return h('div', { class: 'stack' }, nodes);
}

/* ---------- detail ---------- */

route('/sources/:id', async ({ container, params, query }) => {
  const region = h('div', { class: 'stack' });
  container.append(region);
  asyncRegion(region, {
    load: async () => (await api.get(`/api/sources/${params.id}`)).data,
    render: (f) => renderSource(f, query),
  });
}, { title: 'Source', permission: 'sources:read', nav: 'sources' });

function renderSource(f, query) {
  const t = f.totals;
  const isLedger = f.kind === 'ledger';
  const figs = isLedger
    ? [figure('Entries', formatInt(t.entries)), figure('Net amount', formatPaise(t.netPaise), 'Payments less refunds'), figure('Dates', t.firstDate ? `${formatDate(t.firstDate)}` : '—', t.lastDate ? `to ${formatDate(t.lastDate)}` : '')]
    : [figure('Lines', formatInt(t.lines)), figure('Batches', formatInt(t.batches)), figure('Gross amount', formatPaise(t.grossPaise), `Fees ${formatPaise(t.feesPaise)}`)];
  figs.push(figure('Rejected rows', formatInt(f.rejectedRows), `of ${formatInt(f.totalRows)} in file`, f.rejectedRows ? 'is-warn' : ''));

  const state = { tab: query.tab === 'errors' ? 'errors' : 'records', view: 'lines', q: '', page: 1 };
  const body = h('div');
  const tabHost = h('div');
  const region = h('div');
  let loader;
  const draw = () => {
    clear(tabHost).append(tabs([['records', 'Records'], ['errors', 'Rejected rows', f.rejectedRows]], state.tab, (k) => { state.tab = k; state.page = 1; draw(); }));
    clear(body);
    if (state.tab === 'records') body.append(recordsToolbar(), region); else body.append(region);
    loader = asyncRegion(region, { load: () => load(), render: (res) => renderTab(res) });
  };
  const load = () => (state.tab === 'errors'
    ? api.get(`/api/sources/${f.id}/errors`, { page: state.page, pageSize: 50 })
    : api.get(`/api/sources/${f.id}/records`, { page: state.page, pageSize: 50, q: state.q, view: state.view }));
  const reloadSoon = debounce(() => { state.page = 1; loader.reload(); }, 250);
  function recordsToolbar() {
    const q = h('input', { class: 'input', type: 'search', placeholder: 'Search reference, id or name', 'aria-label': 'Search records', oninput: (e) => { state.q = e.target.value.trim(); reloadSoon(); } });
    return h('div', { class: 'filters' },
      h('div', { class: 'field wide' }, q),
      !isLedger && h('div', { class: 'row' }, ['lines', 'batches'].map((v) => h('button', { class: `btn btn-sm${state.view === v ? ' btn-primary' : ''}`, type: 'button', onclick: () => { state.view = v; state.page = 1; draw(); } }, v === 'lines' ? 'Settled lines' : 'Batch summaries'))));
  }
  function renderTab(res) {
    const foot = res.data.length > 0 && tableFoot(res.page, (p) => { state.page = p; loader.reload(); }, state.tab === 'errors' ? 'issues' : 'records');
    if (state.tab === 'errors') {
      return h('div', null, dataTable({ caption: 'Rejected rows', columns: errorColumns(), rows: res.data, emptyNode: emptyState({ title: 'No rejected rows', body: 'Every row in this file was loaded.' }) }), foot);
    }
    const cols = isLedger ? ledgerColumns() : state.view === 'batches' ? batchColumns() : lineColumns();
    return h('div', null, dataTable({ caption: 'Source records', columns: cols, rows: res.data, emptyNode: emptyState({ title: 'No matching records' }) }), foot);
  }
  draw();

  return h('div', { class: 'stack' },
    pageHead({
      crumbs: [{ label: 'Sources', href: '#/sources' }, { label: `#${f.id}` }],
      title: f.filename,
      sub: h('span', null, badge(isLedger ? 'info' : 'neutral', isLedger ? 'Ledger' : 'Settlement', 'badge-plain'), ` Uploaded ${formatDateTime(f.uploadedAt)} by ${f.uploadedByName} · SHA-256 `, h('span', { class: 'ref' }, shortHash(f.sha256)), '…'),
      actions: can('runs:create') && button({ label: 'Start a run', icon: 'runs', variant: 'primary', href: `#/runs?new=1&${f.kind}=${f.id}` }),
    }),
    figures(...figs),
    h('div', { class: 'panel' }, tabHost, body));
}

const errorColumns = () => [
  { label: 'Row', align: 'num', render: (r) => r.rowNumber }, { label: 'Line', align: 'num', hideSm: true, render: (r) => r.lineNumber },
  { label: 'Field', render: (r) => (r.field ? h('span', { class: 'ref' }, r.field) : '—') },
  { label: 'Reason', render: (r) => h('div', null, r.message, h('span', { class: 'cell-sub' }, r.code)) },
  { label: 'Row content', hideSm: true, class: 'truncate', render: (r) => h('span', { class: 'ref faint' }, r.rawExcerpt || '') },
];
const ledgerColumns = () => [
  { label: 'Row', align: 'num', render: (r) => r.rowNumber }, { label: 'Ledger id', render: (r) => ref(r.ledgerId) }, { label: 'Reference', render: (r) => ref(r.reference) },
  { label: 'Merchant', hideSm: true, render: (r) => r.merchant }, { label: 'Type', render: (r) => (r.entryType === 'REFUND' ? 'Refund' : 'Payment') },
  { label: 'Amount', align: 'num', render: (r) => money(r.amountPaise) }, { label: 'Business date', render: (r) => formatDate(r.businessDate) },
];
const lineColumns = () => [
  { label: 'Row', align: 'num', render: (r) => r.rowNumber }, { label: 'Line id', render: (r) => ref(r.lineId) }, { label: 'Reference', render: (r) => ref(r.reference) },
  { label: 'Batch', render: (r) => ref(r.batchRef) }, { label: 'Type', render: (r) => (r.txnType === 'REFUND' ? 'Refund' : 'Sale') },
  { label: 'Amount', align: 'num', render: (r) => money(r.amountPaise) }, { label: 'Fee', align: 'num', render: (r) => money(r.feePaise) }, { label: 'Settled', hideSm: true, render: (r) => formatDate(r.settledOn) },
];
const batchColumns = () => [
  { label: 'Row', align: 'num', render: (r) => r.rowNumber }, { label: 'Batch', render: (r) => ref(r.batchRef) }, { label: 'Settled', render: (r) => formatDate(r.settledOn) },
  { label: 'Declared gross', align: 'num', render: (r) => money(r.grossPaise) }, { label: 'Declared fees', align: 'num', render: (r) => money(r.feePaise) }, { label: 'Declared payout', align: 'num', render: (r) => money(r.payoutPaise) },
];
