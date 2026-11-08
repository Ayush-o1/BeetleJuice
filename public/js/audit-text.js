// Turns an audit event (action code + JSON context) into a sentence a person can read.
// The raw action code and JSON stay available in the UI; this is presentation only.
import { BREAK_TYPES, RESOLUTIONS, formatPaise, formatInt, plural } from './format.js';

const trim = (s, n = 140) => (s && s.length > n ? `${s.slice(0, n)}…` : s);
const kindName = (k) => (k === 'ledger' ? 'ledger' : k === 'settlement' ? 'settlement' : 'source');
const res = (code) => RESOLUTIONS[code] || code;

const DESCRIBE = {
  'auth.login': () => ({ label: 'Signed in', text: 'Signed in', tone: 'neutral' }),
  'auth.logout': () => ({ label: 'Signed out', text: 'Signed out', tone: 'neutral' }),
  'auth.login_failed': (c) => ({ label: 'Failed sign-in', text: `Failed sign-in attempt${c.attemptedUsername ? ` as “${c.attemptedUsername}”` : ''}`, tone: 'warn' }),
  'auth.account_locked': (c) => ({ label: 'Account locked', text: `Account locked for ${c.lockMinutes ?? '?'} minutes after repeated failed sign-ins`, tone: 'bad' }),
  'source.ingested': (c) => ({ label: 'File uploaded', text: `Uploaded ${kindName(c.kind)} file ${c.filename}: ${formatInt(c.acceptedRows)} of ${formatInt(c.totalRows)} rows accepted${c.rejectedRows ? `, ${formatInt(c.rejectedRows)} rejected` : ''}`, tone: c.rejectedRows ? 'warn' : 'ok' }),
  'source.duplicate_rejected': (c) => ({ label: 'Duplicate upload', text: `Rejected ${c.filename || 'a file'}: identical content was already uploaded`, tone: 'warn' }),
  'source.upload_rejected': (c) => ({ label: 'Upload rejected', text: `Rejected ${c.filename || 'a file'}: ${trim(c.message) || 'invalid file'}`, tone: 'bad' }),
  'run.created': (c) => ({ label: 'Run queued', text: `Queued a run as of ${c.asOfDate} using settings v${c.settingsVersion}`, tone: 'info' }),
  'run.completed': (c) => ({ label: 'Run completed', text: `Run completed: ${formatInt(c.matched)} matched, ${formatInt(c.pending)} awaiting settlement, ${plural(c.totalBreaks, 'break')}`, tone: 'ok' }),
  'run.failed': (c) => ({ label: 'Run failed', text: `Run failed${c.code ? ` (${c.code})` : ''}${c.message ? `: ${trim(c.message)}` : ''}`, tone: 'bad' }),
  'break.created': (c) => ({ label: 'Break raised', text: `${BREAK_TYPES[c.breakType] || c.breakType} on ${c.reference}${c.impactPaise !== undefined ? `, ${formatPaise(c.impactPaise)} at issue` : ''}`, tone: 'warn' }),
  'break.note_added': () => ({ label: 'Note added', text: 'Added an investigation note', tone: 'info' }),
  'proposal.created': (c) => ({ label: 'Resolution proposed', text: `Proposed “${res(c.resolutionCode)}”${c.note ? ` — ${trim(c.note)}` : ''}`, tone: 'info' }),
  'proposal.approved': (c) => ({ label: 'Proposal approved', text: `Approved “${res(c.resolutionCode)}”${c.note ? ` — ${trim(c.note)}` : ''}`, tone: 'ok' }),
  'proposal.rejected': (c) => ({ label: 'Proposal rejected', text: `Rejected “${res(c.resolutionCode)}”${c.note ? ` — ${trim(c.note)}` : ''}`, tone: 'bad' }),
  'proposal.self_decision_blocked': () => ({ label: 'Self-review blocked', text: 'Tried to review their own proposal; the request was refused', tone: 'bad' }),
  'break.resolved': (c) => ({ label: 'Break resolved', text: `Break resolved as “${res(c.resolutionCode)}”`, tone: 'ok' }),
  'break.reopened': (c) => ({ label: 'Break reopened', text: `Break returned to the queue after “${res(c.resolutionCode)}” was rejected`, tone: 'warn' }),
  'settings.updated': (c) => ({ label: 'Settings changed', text: `Saved new settings${c.note ? ` — ${trim(c.note)}` : ''}`, tone: 'info' }),
};

export function describeEvent(e) {
  const fn = DESCRIBE[e.action];
  if (!fn) return { label: e.action, text: e.action, tone: 'neutral' };
  try { return fn(e.context || {}); } catch { return { label: e.action, text: e.action, tone: 'neutral' }; }
}

export const actorLabel = (e) => e.actorName || e.actor || null;
