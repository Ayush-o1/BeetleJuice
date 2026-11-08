import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { formatPaise, BREAK_TYPES, BREAK_STATUS, RUN_STATUS, OUTCOMES } from './format.js';

/* ---------- small building blocks ---------- */

export function button({ label, icon: iconName, variant = 'secondary', onClick, type = 'button', disabled, small, title, href, ariaLabel }) {
  const cls = `btn${variant === 'primary' ? ' btn-primary' : variant === 'danger' ? ' btn-danger' : variant === 'ghost' ? ' btn-ghost' : ''}${small ? ' btn-sm' : ''}`;
  const content = [iconName && icon(iconName), label && h('span', null, label)];
  if (href) return h('a', { class: cls, href, title, 'aria-label': ariaLabel }, content);
  return h('button', { class: cls, type, onclick: onClick, disabled, title, 'aria-label': ariaLabel }, content);
}

/** Runs an async action with a spinner on the button and no double submission. */
export async function withBusy(btn, fn) {
  if (btn.dataset.busy) return undefined;
  btn.dataset.busy = '1';
  btn.disabled = true;
  const prev = [...btn.childNodes];
  btn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', null, 'Working…'));
  try { return await fn(); } finally {
    btn.replaceChildren(...prev);
    btn.disabled = false;
    delete btn.dataset.busy;
  }
}

export const badge = (kind, text, extra = '') => h('span', { class: `badge badge-${kind}${extra ? ` ${extra}` : ''}` }, text);

export function statusBadge(status) {
  const kind = { open: 'warn', pending_review: 'info', resolved: 'ok' }[status] || 'neutral';
  return badge(kind, BREAK_STATUS[status] || status);
}
export function runBadge(status, extra = '') {
  const kind = { queued: 'neutral', running: 'info', completed: 'ok', failed: 'bad' }[status] || 'neutral';
  return badge(kind, RUN_STATUS[status] || status, `${status === 'running' ? 'badge-running' : ''} ${extra}`.trim());
}
export function outcomeBadge(outcome) {
  return badge({ MATCHED: 'ok', PENDING: 'warn', BREAK: 'bad' }[outcome] || 'neutral', OUTCOMES[outcome] || outcome);
}
export const typeBadge = (type) => badge('neutral', BREAK_TYPES[type] || type, 'badge-plain');
export const roleBadge = (role) => badge('info', role, 'badge-plain');

export function money(paise, opts) {
  const text = formatPaise(paise, opts);
  return h('span', { class: `num${paise < 0 ? ' neg' : ''}` }, text);
}

export const ref = (text) => h('span', { class: 'ref' }, text);

export function panel(title, body, { sub, actions, flush = true, id } = {}) {
  return h('section', { class: 'panel', id, 'aria-label': typeof title === 'string' ? title : undefined },
    title && h('div', { class: 'panel-head' }, h('h2', null, title, sub && h('span', { class: 'sub' }, sub)), actions && h('div', { class: 'row' }, actions)),
    body instanceof Element && body.classList.contains('panel-body') ? body : h('div', { class: `panel-body${flush ? ' flush' : ''}` }, body));
}

export const figure = (label, value, sub, cls = '') => h('div', { class: `figure ${cls}` },
  h('div', { class: 'k' }, label), h('div', { class: `v${typeof value === 'string' && value.length > 9 ? ' sm' : ''}` }, value), sub && h('div', { class: 's' }, sub));
export const figures = (...items) => h('div', { class: 'figures' }, items);

export function kv(pairs) {
  return h('dl', { class: 'kv' }, pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v ?? '—')]));
}

export function field(label, control, { hint, id, error, className = '' } = {}) {
  const fid = id || control.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  control.id = fid;
  return h('div', { class: `field ${className}` }, h('label', { for: fid }, label), control,
    hint && h('span', { class: 'hint' }, hint), error && h('span', { class: 'field-error' }, error));
}

export function select(options, value, props = {}) {
  const el = h('select', { class: 'select', ...props }, options.map(([v, label]) => h('option', { value: v }, label)));
  el.value = value ?? options[0]?.[0] ?? '';
  return el;
}

export function tabs(items, active, onSelect) {
  return h('div', { class: 'tabs', role: 'tablist' }, items.map(([key, label, count]) => h('button', {
    class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(key === active), onclick: () => onSelect(key),
  }, label, count !== undefined && h('span', { class: 'count' }, count))));
}

/* ---------- states ---------- */

export function emptyState({ title, body, actions }) {
  return h('div', { class: 'empty' }, h('h3', null, title), body && h('p', null, body), actions && h('div', { class: 'row' }, actions));
}

export function errorState(err, onRetry) {
  const forbidden = err.status === 403;
  return h('div', { class: 'empty', role: 'alert' },
    h('h3', null, forbidden ? 'You do not have access to this' : err.status === 404 ? 'Not found' : 'This could not be loaded'),
    h('p', null, err.message),
    err.requestId && h('p', { class: 'faint' }, `Reference ${err.requestId}`),
    onRetry && !forbidden && button({ label: 'Try again', icon: 'refresh', onClick: onRetry }));
}

export function alertBox(kind, title, body, { iconName } = {}) {
  return h('div', { class: `alert alert-${kind}`, role: kind === 'bad' ? 'alert' : 'status' },
    icon(iconName || (kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert')),
    h('div', null, title && h('div', { class: 'title' }, title), body && h('div', null, body)));
}

export function skeleton(rows = 6) {
  return h('div', { class: 'panel-body', 'aria-busy': 'true', 'aria-label': 'Loading' },
    Array.from({ length: rows }, () => h('div', { class: 'skeleton-row' },
      h('span', { class: 'skeleton w2' }), h('span', { class: 'skeleton' }), h('span', { class: 'skeleton' }), h('span', { class: 'skeleton' }))));
}

/**
 * Renders async data into a region with loading and error states.
 * `load()` returns data; `render(data)` returns a node. Returns { reload }.
 */
export function asyncRegion(region, { load, render, loading = () => skeleton() }) {
  let seq = 0;
  async function reload() {
    const mine = ++seq;
    region.setAttribute('aria-busy', 'true');
    if (!region.firstChild) region.replaceChildren(loading());
    try {
      const data = await load();
      if (mine !== seq) return;
      clear(region).append(render(data));
    } catch (err) {
      if (mine !== seq) return;
      clear(region).append(errorState(err, reload));
    } finally {
      if (mine === seq) region.removeAttribute('aria-busy');
    }
  }
  reload();
  return { reload };
}

/* ---------- tables ---------- */

export function dataTable({ caption, columns, rows, sort, onSort, rowHref, emptyNode, stack = true }) {
  if (!rows.length && emptyNode) return emptyNode;
  const [sortKey, sortDir] = (sort || '').split(':');
  const hidden = (c) => (c.hideSm ? 'hide-sm' : '');
  const head = h('tr', { role: 'row' }, columns.map((c) => {
    const th = h('th', { scope: 'col', role: 'columnheader', class: `${c.align === 'num' ? 'num ' : ''}${hidden(c)}`.trim() });
    if (c.sortKey && onSort) {
      const active = sortKey === c.sortKey;
      th.setAttribute('aria-sort', active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.append(h('button', { class: 'th-sort', type: 'button', onclick: () => onSort(c.sortKey, active && sortDir !== 'asc' ? 'asc' : 'desc') }, c.label, icon('sort')));
    } else if (c.label) th.append(c.label);
    else th.append(h('span', { class: 'sr-only' }, c.srLabel || 'Actions'));
    return th;
  }));
  const body = rows.map((row, i) => {
    const href = rowHref?.(row);
    // One tab stop per row: the link inside the row is the keyboard target; clicking anywhere else on the row is a pointer convenience.
    const tr = h('tr', { role: 'row', class: href ? 'clickable' : '' }, columns.map((c, ci) => h('td', {
      role: 'cell', 'data-label': c.label || undefined, class: `${c.align === 'num' ? 'num ' : ''}${hidden(c)} ${ci === 0 ? 'cell-title ' : ''}${c.class || ''}`.trim(),
    }, c.render(row, i))));
    if (href) tr.addEventListener('click', (e) => { if (!e.target.closest('a,button,input,select,summary')) location.hash = href; });
    return tr;
  });
  return h('div', { class: 'table-wrap' }, h('table', { class: `data-table${stack ? ' stack-sm' : ''}`, role: 'table' },
    h('caption', null, caption), h('thead', { role: 'rowgroup' }, head), h('tbody', { role: 'rowgroup' }, body)));
}

export function tableFoot(pageInfo, onPage, noun = 'rows') {
  const { number, size, total, pages } = pageInfo;
  const from = total === 0 ? 0 : (number - 1) * size + 1;
  const to = Math.min(total, number * size);
  return h('div', { class: 'table-foot' },
    h('span', null, `Showing ${from}–${to} of ${total.toLocaleString('en-IN')} ${noun}`),
    pages > 1 && h('div', { class: 'pager' },
      button({ icon: 'chevron-left', small: true, ariaLabel: 'Previous page', title: 'Previous page', disabled: number <= 1, onClick: () => onPage(number - 1) }),
      h('span', null, `Page ${number} of ${pages}`),
      button({ icon: 'chevron-right', small: true, ariaLabel: 'Next page', title: 'Next page', disabled: number >= pages, onClick: () => onPage(number + 1) })));
}

/* ---------- feedback ---------- */

export function toast(message, kind = 'ok') {
  const el = h('div', { class: `toast toast-${kind}` }, icon(kind === 'ok' ? 'check' : 'alert'), h('span', null, message));
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'ok' ? 4500 : 8000);
}

/**
 * Modal dialog built on <dialog> (focus trap, Esc, inert background come from the platform).
 * `content` is extra body nodes; `collect()` may return { error } to block closing or a value to resolve with.
 */
export function openDialog({ title, message, content, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, collect }) {
  return new Promise((resolve) => {
    const err = h('p', { class: 'field-error', role: 'alert' });
    const dlg = h('dialog', { class: 'dlg', 'aria-labelledby': 'dlg-title' });
    const form = h('form', { method: 'dialog' },
      h('div', { class: 'dlg-head' }, h('h2', { id: 'dlg-title' }, title)),
      h('div', { class: 'dlg-body' }, message && h('p', null, message), content, err),
      h('div', { class: 'dlg-foot' },
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close('cancel') }, cancelLabel),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'submit' }, confirmLabel)));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = collect ? collect() : true;
      if (out && out.error) { err.textContent = out.error; return; }
      dlg.dataset.value = JSON.stringify(out === undefined ? true : out);
      dlg.close('ok');
    });
    dlg.append(form);
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      const value = ok ? JSON.parse(dlg.dataset.value) : null;
      dlg.remove();
      resolve(ok ? value : null);
    });
    document.body.append(dlg);
    dlg.showModal();
    (dlg.querySelector('textarea, input, select') || dlg.querySelector('button[type=submit]')).focus();
  });
}

export const confirmDialog = (opts) => openDialog(opts).then(Boolean);

export function reasonDialog({ title, message, label = 'Reason', minLength = 5, confirmLabel, danger, optional = false }) {
  const ta = h('textarea', { class: 'textarea', maxlength: '2000', rows: '3' });
  return openDialog({
    title, message, confirmLabel, danger,
    content: field(optional ? `${label} (optional)` : label, ta),
    collect: () => {
      const v = ta.value.trim();
      if (!optional && v.length < minLength) return { error: `Enter at least ${minLength} characters.` };
      return v;
    },
  });
}

export function pageHead({ title, sub, actions, crumbs }) {
  return h('div', { class: 'page-head' },
    h('div', null,
      crumbs && h('div', { class: 'crumbs' }, crumbs.flatMap((c, i) => [i > 0 && icon('chevron-right'), c.href ? h('a', { href: c.href }, c.label) : h('span', null, c.label)])),
      typeof title === 'string' ? h('h1', null, title) : h('h1', null, title),
      sub && h('p', { class: 'sub' }, sub)),
    actions && h('div', { class: 'page-actions' }, actions));
}
