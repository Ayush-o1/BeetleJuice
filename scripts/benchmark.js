'use strict';

/**
 * Measures the pipeline on synthetic data: parse/validate, ingest, reconcile, persist, query.
 * Uses its OWN throwaway database (beetlejuice_bench), dropped and recreated on every run, and
 * never touches any other database.   npm run bench -- [rowsPerFile] [--browser]
 *
 * Besides the pipeline steps it times the HTTP API (median of 7 calls through the real Express app, including
 * the overview, trace and break-queue endpoints). With --browser it also drives Chrome and reports how long
 * the main screens take to render their data and how much main-thread blocking (long tasks) that causes.
 */
require('../src/load-env');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { loadConfig } = require('../src/config');
const { buildContext } = require('../src/context');
const { migrate } = require('../src/db/migrate');
const users = require('../src/modules/users/user.repo');
const sources = require('../src/modules/sources/source.service');
const runs = require('../src/modules/runs/run.service');
const { createWorker } = require('../src/modules/runs/run.worker');
const { hashPassword } = require('../src/modules/auth/passwords');
const { toRupeesString } = require('../src/lib/money');
const { computeFeePaise, parsePercent } = require('../src/lib/rate');

const N = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || 45000;
const BENCH_DB = 'beetlejuice_bench';
const rate = parsePercent('2');

function mulberry32(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function synth(n) {
  const rnd = mulberry32(42);
  const L = ['ledger_id,reference,merchant,entry_type,amount,currency,recorded_at'];
  const S = ['record_type,batch_id,line_id,reference,txn_type,amount,fee,currency,settled_on,batch_gross,batch_fee,batch_payout'];
  const batches = new Map();
  const add = (batch, gross, fee) => { const b = batches.get(batch) || { g: 0, f: 0 }; b.g += gross; b.f += fee; batches.set(batch, b); };
  for (let i = 1; i <= n; i++) {
    const day = 1 + Math.floor(rnd() * 5);
    const p = 10000 + Math.floor(rnd() * 900000);
    const ref = `PAY-B-${String(i).padStart(7, '0')}`;
    const r = rnd();
    L.push(`L-${i},${ref},Merchant ${i % 50},PAYMENT,${toRupeesString(p)},INR,2026-11-0${day}T12:00:00+05:30`);
    if (r < 0.02) continue;                                               // missing in settlement
    const sp = r < 0.05 ? p + 100 : p;                                    // amount mismatch
    const fee = computeFeePaise(sp, rate);
    const batch = `B-2026110${day + 1}`;
    S.push(`TXN,${batch},S-${i},${ref},SALE,${toRupeesString(sp)},${toRupeesString(fee)},INR,2026-11-0${day + 1},,,`);
    add(batch, sp, fee);
    if (r > 0.99) { S.push(`TXN,${batch},S-${i}D,${ref},SALE,${toRupeesString(sp)},${toRupeesString(fee)},INR,2026-11-0${day + 1},,,`); add(batch, sp, fee); }
  }
  for (const [b, v] of batches) S.push(`BATCH,${b},,,,,,INR,2026-11-07,${toRupeesString(v.g)},${toRupeesString(v.f)},${toRupeesString(v.g - v.f)}`);
  return { ledger: Buffer.from(`${L.join('\n')}\n`), settlement: Buffer.from(`${S.join('\n')}\n`) };
}

async function browserTiming(baseUrl, firstBreak, runId) {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(baseUrl); await page.fill('input[name=username]', 'bench'); await page.fill('input[name=password]', 'benchmark-password'); await page.click('button[type=submit]'); await page.waitForSelector('.shell');
  await page.evaluate(() => { window.__long = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long += e.duration; }).observe({ entryTypes: ['longtask'] }); });
  console.log('\nBrowser (Chrome headless, 1440x900, same machine; navigation inside the SPA to data visible):');
  const screens = [
    ['Overview', '/', '.figures'], ['Break queue (25 of ' + (await ctx_count()) + ' rows)', '/breaks', 'table.data-table tbody tr'],
    ['Break queue, type filter', '/breaks?type=AMOUNT_MISMATCH', 'table.data-table tbody tr'], [`Break detail #${firstBreak.id}`, `/breaks/${firstBreak.id}`, '.compare'],
    ['Trace a reference', `/trace?reference=${firstBreak.reference}`, '.alert'], [`Run #${runId}`, `/runs/${runId}`, '.figures'], 
  ];
  for (const [label, route, selector] of screens) {
    await page.evaluate(() => { location.hash = '#/blank-start'; }); await page.waitForSelector('.empty'); await page.waitForTimeout(150);   // an empty view, so only the target screen can satisfy the selector
    const r = await page.evaluate(async ([route2, selector2]) => {
      window.__long = 0; const t0 = performance.now(); location.hash = `#${route2}`;
      await new Promise((resolve) => { const check = () => (document.querySelector(selector2) && !document.querySelector('.skeleton') ? resolve() : requestAnimationFrame(check)); check(); });
      return { ms: performance.now() - t0, long: window.__long };
    }, [route, selector]);
    console.log(`  ${label.padEnd(46)} ${r.ms.toFixed(0).padStart(6)} ms   main-thread blocking ${r.long.toFixed(0)} ms`);
  }
  await browser.close();
}
let ctx_count = async () => '?';
const time = async (label, fn) => { const t = process.hrtime.bigint(); const v = await fn(); const ms = Number((process.hrtime.bigint() - t) / 1000n) / 1000; console.log(`${label.padEnd(44)} ${ms.toFixed(1).padStart(10)} ms`); return { v, ms }; };

(async () => {
  const base = loadConfig({ ...process.env, NODE_ENV: 'development', LOG_LEVEL: 'silent' });
  const admin = new Client({ connectionString: new URL('/postgres', base.databaseUrl).toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${BENCH_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${BENCH_DB}`);
  await admin.end();
  const url = new URL(`/${BENCH_DB}`, base.databaseUrl).toString();
  const config = loadConfig({ ...process.env, NODE_ENV: 'development', LOG_LEVEL: 'silent', DATABASE_URL: url, MAX_UPLOAD_ROWS: '100000', MAX_UPLOAD_BYTES: String(60 * 1024 * 1024), SCRYPT_LOG2_N: '10', UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'bj-bench-')) });
  const ctx = buildContext(config);
  try {
    await migrate(ctx.pool);
    const u = await users.create(ctx.pool, { username: 'bench', displayName: 'Bench', role: 'analyst', passwordHash: await hashPassword('benchmark-password', 10) });
    const actor = { user: { ...u }, ip: null, requestId: 'bench' };
    console.log(`BeetleJuice benchmark · ${os.cpus()[0].model} · ${os.cpus().length} cores · Node ${process.version} · PostgreSQL local\n`);
    const { v: data } = await time(`generate ${N} ledger rows + settlement`, async () => synth(N));
    console.log(`  ledger ${(data.ledger.length / 1048576).toFixed(1)} MiB, settlement ${(data.settlement.length / 1048576).toFixed(1)} MiB`);
    const rss0 = process.memoryUsage().rss;
    const { v: l } = await time('ingest ledger (parse+validate+insert)', () => sources.ingest(ctx, actor, { kind: 'ledger', filename: 'bench-ledger.csv', buffer: data.ledger }));
    const { v: s } = await time('ingest settlement (parse+validate+insert)', () => sources.ingest(ctx, actor, { kind: 'settlement', filename: 'bench-settlement.csv', buffer: data.settlement }));
    const run = await runs.createRun(ctx, actor, { ledgerFileId: l.file.id, settlementFileId: s.file.id });
    await time('run: load + reconcile + persist (worker)', () => createWorker(ctx).processNext());
    const done = (await ctx.pool.query('SELECT summary FROM reconciliation_runs WHERE id = $1', [run.id])).rows[0].summary;
    console.log(`  engine only: ${done.execution.durationMs} ms for ${done.inputs.ledgerEntries} ledger + ${done.inputs.settlementLines} settlement lines`);
    console.log(`  outcomes: matched ${done.matched}, pending ${done.pending}, breaks ${done.totalBreaks}`);
    console.log(`  peak RSS growth ≈ ${((process.memoryUsage().rss - rss0) / 1048576).toFixed(0)} MiB\n`);

    await ctx.pool.query('ANALYZE');
    ctx_count = async () => (await ctx.pool.query("SELECT count(*)::int AS n FROM breaks WHERE status <> 'resolved'")).rows[0].n.toLocaleString('en-IN');
    const q = async (label, sql, params = []) => time(label, () => ctx.pool.query(sql, params));
    const breakRepo = require('../src/modules/breaks/break.repo');
    await time('break queue: page 1, unresolved, age desc', () => breakRepo.list(ctx.pool, { status: 'unresolved' }, { limit: 25, offset: 0, sort: 'age:desc' }));
    await time('break queue: type + amount range + sort', () => breakRepo.list(ctx.pool, { type: 'AMOUNT_MISMATCH', minAmountPaise: 5000 }, { limit: 25, offset: 0, sort: 'impact:desc' }));
    await time('break queue: reference contains "B-00123"', () => breakRepo.list(ctx.pool, { q: 'B-00123' }, { limit: 25, offset: 0, sort: 'age:desc' }));
    await q('audit log: latest 50', 'SELECT * FROM audit_events ORDER BY occurred_at DESC, id DESC LIMIT 50');
    await q('run results: matched page', "SELECT * FROM match_results WHERE run_id = $1 AND outcome = 'MATCHED' ORDER BY id LIMIT 25", [run.id]);
    // ---- HTTP API through the real app (median of 7, after one warm-up call) ----
    const { createApp } = require('../src/app');
    const server = await new Promise((resolve) => { const sv = createApp(ctx).listen(0, '127.0.0.1', () => resolve(sv)); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'bench', password: 'benchmark-password' }) });
      const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
      const firstBreak = (await ctx.pool.query("SELECT id, reference FROM breaks WHERE reference IS NOT NULL ORDER BY id LIMIT 1")).rows[0];
      console.log('\nHTTP API (median of 7, warm):');
      for (const [label, url] of [
        ['GET /api/overview (counts, ageing, activity)', '/api/overview'],
        ['GET /api/breaks?status=unresolved (page 1)', '/api/breaks?status=unresolved&pageSize=25'],
        [`GET /api/breaks/${firstBreak.id} (detail)`, `/api/breaks/${firstBreak.id}`],
        ['GET /api/trace (reference with a break)', `/api/trace?reference=${firstBreak.reference}`],
        ['GET /api/trace (reference that matched)', '/api/trace?reference=PAY-B-0001234'],
        ['GET /api/trace (unknown reference)', '/api/trace?reference=NOPE-0000'],
        [`GET /api/runs/${run.id}`, `/api/runs/${run.id}`],
      ]) {
        await fetch(baseUrl + url, { headers: { cookie } });
        const ts = [];
        for (let i = 0; i < 7; i++) { const t = process.hrtime.bigint(); const r = await fetch(baseUrl + url, { headers: { cookie } }); await r.arrayBuffer(); ts.push(Number((process.hrtime.bigint() - t) / 1000n) / 1000); if (r.status !== 200) throw new Error(`${url} -> ${r.status}`); }
        console.log(`  ${label.padEnd(46)} ${median(ts).toFixed(1).padStart(8)} ms`);
      }
      if (process.argv.includes('--browser')) await browserTiming(baseUrl, firstBreak, run.id);
    } finally { await new Promise((r) => server.close(r)); }

    const plan = (await ctx.pool.query(`EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) SELECT b.id FROM breaks b WHERE b.status IN ('open','pending_review') AND b.break_type = 'AMOUNT_MISMATCH' ORDER BY b.id DESC LIMIT 25`)).rows.map((r) => r['QUERY PLAN']);
    console.log('\nplan for type-filtered queue:\n  ' + plan.slice(0, 6).join('\n  '));
    const rows = (await ctx.pool.query("SELECT (SELECT count(*) FROM match_results) AS results, (SELECT count(*) FROM breaks) AS breaks, (SELECT count(*) FROM audit_events) AS audit, pg_size_pretty(pg_database_size(current_database())) AS size")).rows[0];
    console.log(`\nrows: ${rows.results} match_results, ${rows.breaks} breaks, ${rows.audit} audit events; database size ${rows.size}`);
  } finally {
    await ctx.pool.end();
    fs.rmSync(config.uploadDir, { recursive: true, force: true });
    const admin2 = new Client({ connectionString: new URL('/postgres', base.databaseUrl).toString() });
    await admin2.connect(); await admin2.query(`DROP DATABASE IF EXISTS ${BENCH_DB} WITH (FORCE)`); await admin2.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
