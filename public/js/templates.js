// Starter CSV files offered on the Sources page. Pure data (no DOM) so a unit test can run them through the real parsers.
export const LEDGER_TEMPLATE = {
  filename: 'ledger-template.csv',
  header: ['ledger_id', 'reference', 'merchant', 'entry_type', 'amount', 'currency', 'recorded_at'],
  rows: [
    ['LDG-000001', 'PAY-2026-0001', 'Example Merchant', 'PAYMENT', '1500.00', 'INR', '2026-11-06T14:30:00+05:30'],
    ['LDG-000002', 'RFD-2026-0001', 'Example Merchant', 'REFUND', '250.50', 'INR', '2026-11-06T16:05:00+05:30'],
  ],
};

export const SETTLEMENT_TEMPLATE = {
  filename: 'settlement-template.csv',
  header: ['record_type', 'batch_id', 'line_id', 'reference', 'txn_type', 'amount', 'fee', 'currency', 'settled_on', 'batch_gross', 'batch_fee', 'batch_payout'],
  rows: [
    ['TXN', 'B-20261107', 'L-000001', 'PAY-2026-0001', 'SALE', '1500.00', '30.00', 'INR', '2026-11-07', '', '', ''],
    ['TXN', 'B-20261107', 'L-000002', 'RFD-2026-0001', 'REFUND', '-250.50', '0.00', 'INR', '2026-11-07', '', '', ''],
    ['BATCH', 'B-20261107', '', '', '', '', '', 'INR', '2026-11-07', '1249.50', '30.00', '1219.50'],
  ],
};

const cell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const toCsvText = (t) => `${[t.header, ...t.rows].map((r) => r.map(cell).join(',')).join('\n')}\n`;
