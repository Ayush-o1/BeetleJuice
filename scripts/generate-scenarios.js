'use strict';

/**
 * Writes scenario data sets.
 *
 *   npm run demo:scenarios                                  # regenerate the committed small set in demo-data/scenarios/
 *   npm run demo:scenarios -- --list                        # describe every scenario
 *   npm run demo:scenarios -- --scenario break-storm --size large --seed 7 --out /tmp/storm
 *   npm run demo:scenarios -- --scenario all --size normal --out /tmp/all
 *
 * Output per scenario: ledger.csv, settlement.csv, expected.json (what the engine must produce), README.md.
 */
const fs = require('node:fs');
const path = require('node:path');
const { generateScenario, listScenarios, SIZES } = require('./lib/scenario-library');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };

if (args.includes('--list')) {
  console.log('Scenarios (sizes: ' + Object.entries(SIZES).map(([k, v]) => `${k}=${v}`).join(', ') + ' primary items):\n');
  for (const s of listScenarios()) console.log(`  ${s.name.padEnd(26)} ${s.description}\n`);
  process.exit(0);
}

const scenario = opt('scenario', 'all');
const size = opt('size', 'small');
const seed = Number(opt('seed', 20261108));
const committed = !opt('out');
const outRoot = path.resolve(opt('out', path.join(__dirname, '..', 'demo-data', 'scenarios')));
const names = scenario === 'all' ? listScenarios().map((s) => s.name) : [scenario];
if (!Number.isInteger(seed)) { console.error('--seed must be an integer'); process.exit(1); }

const readme = (name, title, description, e) => `# ${title}

\`${name}\` · size \`${e.size}\` · seed \`${e.seed}\` · as of **${e.asOfDate}** · default settings (${e.settings.settlementWindowDays}-day window, ${e.settings.feeRatePercent}% fee, ±${e.settings.feeTolerancePaise} paisa fee tolerance, no amount tolerance)

${description}

| | Rows | Accepted | Rejected |
|---|---:|---:|---:|
| \`ledger.csv\` | ${e.ledgerRows.total} | ${e.ledgerRows.accepted} | ${e.ledgerRows.rejected} |
| \`settlement.csv\` | ${e.settlementRows.total} | ${e.settlementRows.accepted} | ${e.settlementRows.rejected} |

Expected: **${e.transactions.matched}** matched, **${e.transactions.pending}** awaiting settlement, **${e.transactions.breaks}** transaction breaks, **${e.batches.broken}** of ${e.batches.total} batches broken (${e.totalBreaks} breaks in total).

${Object.entries(e.breaksByType).filter(([, n]) => n).map(([t, n]) => `* ${t}: ${n}`).join('\n') || '* no breaks'}
${e.rejectedCodes.ledger.length || e.rejectedCodes.settlement.length ? `\nRejected-row codes: ledger ${e.rejectedCodes.ledger.join(', ') || '—'}; settlement ${e.rejectedCodes.settlement.join(', ') || '—'}.\n` : ''}
Generated; do not edit. \`expected.json\` is what the reconciliation engine must reproduce (checked by \`test/unit/scenarios.test.js\`).
`;

const index = [];
for (const name of names) {
  const g = generateScenario(name, { size, seed });
  const dir = committed ? path.join(outRoot, name) : (names.length > 1 ? path.join(outRoot, name) : outRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ledger.csv'), g.ledgerCsv);
  fs.writeFileSync(path.join(dir, 'settlement.csv'), g.settlementCsv);
  fs.writeFileSync(path.join(dir, 'expected.json'), `${JSON.stringify(g.expected, null, 2)}\n`);
  const meta = listScenarios().find((s) => s.name === name);
  fs.writeFileSync(path.join(dir, 'README.md'), readme(name, meta.title, meta.description, g.expected));
  index.push({ name, title: meta.title, e: g.expected });
  console.log(`${name.padEnd(26)} ${size.padEnd(7)} ledger ${String(g.expected.ledgerRows.total).padStart(6)}  settlement ${String(g.expected.settlementRows.total).padStart(6)}  -> ${path.relative(process.cwd(), dir) || '.'}`);
}
if (committed) {
  fs.writeFileSync(path.join(outRoot, 'README.md'), `# Scenario data sets

Deterministic synthetic data (fictional merchants and a fictional processor) for demonstrating and testing BeetleJuice.
The files here are the **small** size of each scenario (about 10 primary items, small enough to read). Larger sizes are
generated on demand; see [docs/data-scenarios.md](../../docs/data-scenarios.md).

\`\`\`bash
npm run demo:scenarios -- --list
npm run demo:scenarios -- --scenario break-storm --size large --seed 7 --out /tmp/storm
\`\`\`

| Scenario | Ledger rows | Settlement rows | Matched | Pending | Breaks | Rejected rows |
|---|---:|---:|---:|---:|---:|---:|
${index.map(({ name, title, e }) => `| [${title}](${name}/README.md) | ${e.ledgerRows.total} | ${e.settlementRows.total} | ${e.transactions.matched} | ${e.transactions.pending} | ${e.totalBreaks} | ${e.ledgerRows.rejected + e.settlementRows.rejected} |`).join('\n')}

All sets are judged as of **2026-11-08** with the default settings. Each folder has \`ledger.csv\`, \`settlement.csv\`, an
\`expected.json\` (what the engine must produce, constructed rather than computed) and a short README.
`);
}
