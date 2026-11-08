// Display formatting. Money arrives as integer paise and is formatted by integer arithmetic only.

export function formatPaise(paise, { symbol = true, sign = false } = {}) {
  if (paise === null || paise === undefined) return '—';
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = String(Math.trunc(abs / 100));
  const head = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = head ? `${head},${rupees.slice(-3)}` : rupees;
  const body = `${symbol ? '₹' : ''}${grouped}.${String(abs % 100).padStart(2, '0')}`;
  if (neg) return `−${body}`;           // true minus sign
  return sign && paise > 0 ? `+${body}` : body;
}

// Parses what a person types into the rupee fields ("1,250.5") into paise; null when invalid.
export function parseRupeesInput(text) {
  const t = String(text).trim().replace(/,/g, '');
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// 'YYYY-MM-DD' -> '06 Nov 2026' without ever constructing a Date (no timezone drift).
export function formatDate(ymd) {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

const IST = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
// Every timestamp is shown in IST and labelled as such.
export function formatDateTime(iso) {
  if (!iso) return '—';
  return `${IST.format(new Date(iso)).replace(',', '')} IST`;
}

export const shortHash = (h) => (h ? h.slice(0, 10) : '');
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const formatInt = (n) => new Intl.NumberFormat('en-IN').format(n);
export const ageLabel = (days) => (days === null || days === undefined ? '—' : days === 0 ? 'Today' : `${days}d`);

export const BREAK_TYPES = {
  AMOUNT_MISMATCH: 'Amount mismatch',
  DUPLICATE_SETTLEMENT: 'Duplicate settlement',
  MISSING_IN_LEDGER: 'Missing in ledger',
  MISSING_IN_SETTLEMENT: 'Missing in settlement',
  BATCH_PAYOUT_MISMATCH: 'Batch payout mismatch',
  FEE_VARIANCE: 'Fee variance',
  AMBIGUOUS_REFERENCE: 'Ambiguous reference',
};
export const BREAK_STATUS = { open: 'Open', pending_review: 'Awaiting review', resolved: 'Resolved' };
export const RUN_STATUS = { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed' };
export const OUTCOMES = { MATCHED: 'Matched', PENDING: 'Awaiting settlement', BREAK: 'Break' };
export const RESOLUTIONS = {
  CORRECT_LEDGER: 'Correct the ledger',
  DISPUTE_WITH_PROCESSOR: 'Dispute with processor',
  RECOVER_DUPLICATE: 'Recover duplicate payment',
  WRITE_OFF: 'Write off variance',
  NO_ACTION: 'No action required',
};
export const ROLES = { analyst: 'Reconciliation Analyst', supervisor: 'Reconciliation Supervisor', auditor: 'Auditor' };
export const SIDES = { ledger: 'Ledger only', settlement: 'Settlement only', both: 'Both sources' };
