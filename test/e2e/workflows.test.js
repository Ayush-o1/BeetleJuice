'use strict';
/** Browser workflows beyond the main journey: lists, navigation, theme, uploads, role limits, empty and failing states. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestApp, PASSWORD } = require('../helpers/app');
const { launch, openAs, loadScenario } = require('../helpers/browser');
const { generateScenario } = require('../../scripts/lib/scenario-library');

let app; let browser; let skipReason; let worker; let tmp;
const issues = [];
test.before(async () => {
  ({ browser, skipReason } = await launch());
  if (skipReason) return;
  app = await startTestApp({ WORKER_POLL_MS: '100' });
  worker = app.worker(); worker.start();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bj-e2e-wf-'));
});
test.after(async () => { await worker?.stop(); await browser?.close(); await app?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

const open = (role, opts) => openAs(browser, app, role, { issues, password: PASSWORD, ...opts });
const settle = (page) => page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !document.querySelector('.skeleton') && document.getAnimations().every((a) => a.playState !== 'running'));
const rows = (page) => page.locator('table.data-table tbody tr');
const hash = (page) => page.evaluate(() => location.hash);

test('empty states: a fresh installation explains what to do next, per role', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await app.reset();
  const a = await open('analyst');
  await settle(a.page);
  assert.equal(await a.page.locator('text=No reconciliation data yet').count(), 1);
  assert.equal(await a.page.locator('a:has-text("Upload a source file")').count(), 1, 'an analyst is offered the upload');
  await a.page.goto(`${app.base}/#/breaks`); await settle(a.page);
  assert.equal(await a.page.locator('text=No breaks match these filters').count(), 1);
  await a.page.goto(`${app.base}/#/runs`); await settle(a.page);
  assert.equal(await a.page.locator('text=No runs yet').count(), 1);
  await a.page.goto(`${app.base}/#/trace?reference=PAY-1`); await settle(a.page);
  assert.equal(await a.page.locator('text=/No record carries/').count(), 1);
  await a.ctx.close();
  const u = await open('auditor'); await settle(u.page);
  assert.equal(await u.page.locator('text=No reconciliation data yet').count(), 1);
  assert.equal(await u.page.locator('a:has-text("Upload a source file")').count(), 0, 'an auditor is not offered an upload');
  await u.ctx.close();
});

test('break queue: filters, chips, sorting and pagination work together and are reflected in the URL', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await app.reset();
  const analystApi = await app.as('analyst');
  const { g } = await loadScenario(analystApi, 'break-storm', 'normal');
  const total = g.expected.totalBreaks;
  const { ctx, page } = await open('analyst');
  await page.goto(`${app.base}/#/breaks`); await settle(page);

  assert.equal(await rows(page).count(), 25, 'first page is 25 rows');
  const pages = Math.ceil(total / 25);
  assert.match(await page.locator('.table-foot').first().textContent(), new RegExp(`Showing 1–25 of ${total}`));
  assert.match(await page.locator('.table-foot').first().textContent(), new RegExp(`Page 1 of ${pages}`));
  assert.equal(await page.locator('button[aria-label="Previous page"]').isDisabled(), true);

  await page.click('button[aria-label="Next page"]'); await settle(page);
  assert.match(await hash(page), /page=2/);
  assert.match(await page.locator('.table-foot').first().textContent(), new RegExp(`Showing 26–${Math.min(50, total)}`));
  await page.click('button[aria-label="Previous page"]'); await settle(page);
  assert.doesNotMatch(await hash(page), /page=/);

  // type filter -> chip, URL, exact count; changing a filter returns to page 1
  await page.selectOption('select[aria-label="Type"]', 'FEE_VARIANCE'); await settle(page);
  assert.equal(await rows(page).count(), g.expected.breaksByType.FEE_VARIANCE);
  assert.match(await hash(page), /type=FEE_VARIANCE/);
  assert.equal(await page.locator('.chip:has-text("Type: Fee variance")').count(), 1);
  assert.equal(await page.locator('table tbody td:has-text("Fee variance")').count() >= g.expected.breaksByType.FEE_VARIANCE, true);

  // search narrows further; a search with no hits shows the empty state and the hint to widen
  await page.fill('input[aria-label="Search reference"]', 'ZZZ-NOPE');          // search is debounced, so wait for the result itself
  await page.waitForSelector('text=No breaks match these filters');
  await page.click('button:has-text("Clear all")'); await settle(page);
  assert.equal(await rows(page).count(), 25);
  assert.equal(await page.locator('.chip').count(), 0);

  // sorting: the header button toggles aria-sort and the order really changes
  await page.click('th button:has-text("Amount at issue")'); await settle(page);
  assert.equal(await page.locator('th[aria-sort="descending"]:has-text("Amount at issue")').count(), 1);
  const amounts = await page.locator('td[data-label="Amount at issue"]').allTextContents();
  const num = (s) => Number(s.replace(/[^\d.]/g, ''));
  assert.deepEqual(amounts.map(num), [...amounts.map(num)].sort((a, b) => b - a));

  // a filtered URL is shareable: opening it in a fresh page restores the same view
  await page.goto(`${app.base}/#/breaks?type=MISSING_IN_SETTLEMENT&status=unresolved`); await settle(page);
  assert.equal(await rows(page).count(), g.expected.breaksByType.MISSING_IN_SETTLEMENT);
  assert.equal(await page.inputValue('select[aria-label="Type"]'), 'MISSING_IN_SETTLEMENT');
  await ctx.close();
});

test('break page: previous/next follow the list the user came from, [ and ] step through it, and the breadcrumb keeps the filter', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ctx, page } = await open('analyst');
  await page.goto(`${app.base}/#/breaks?type=AMOUNT_MISMATCH`); await settle(page);
  const n = await rows(page).count();
  assert.ok(n >= 3);
  await page.click('tbody tr:first-child a.ref'); await page.waitForSelector('.queue-nav'); await settle(page);
  assert.match(await page.locator('.queue-nav').textContent(), new RegExp(`1 of ${n}`));
  assert.equal(await page.locator('.queue-nav button:has-text("Previous")').isDisabled(), true);
  const first = await hash(page);
  const position = (k) => page.waitForFunction(([k2, n2]) => document.querySelector('.queue-nav')?.textContent.includes(`${k2} of ${n2}`), [k, n]);
  await page.click('.queue-nav a:has-text("Next")'); await position(2);
  assert.notEqual(await hash(page), first);
  await page.keyboard.press(']'); await position(3);
  await page.keyboard.press('['); await position(2);
  assert.equal(await page.locator('h1 .badge:has-text("Amount mismatch")').count(), 1, 'still within the filtered list');
  await page.click('.crumbs a:has-text("Breaks")'); await settle(page);
  assert.match(await hash(page), /type=AMOUNT_MISMATCH/, 'back to the same filtered list');
  // opening a break directly (no list context) shows no queue controls
  await page.goto(`${app.base}/#/breaks/1`); await page.evaluate(() => sessionStorage.clear()); await page.reload(); await settle(page);
  assert.equal(await page.locator('.queue-nav').count(), 0);
  await ctx.close();
});

test('reference search: topbar box finds matched, broken and unknown references', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ctx, page } = await open('supervisor');
  const ref = (await (await app.as('analyst')).get('/api/breaks?type=DUPLICATE_SETTLEMENT')).body.data[0].reference;
  await page.keyboard.press('/');
  await page.keyboard.type(ref.toLowerCase());
  await page.keyboard.press('Enter'); await page.waitForSelector('h1:has-text("Find a reference")'); await settle(page);
  assert.match(await hash(page), /trace\?reference=/);
  assert.equal(await page.locator('h2:has-text("Ledger entries")').count(), 1);
  assert.equal(await page.locator('text=Duplicate settlement').count() >= 1, true);
  assert.equal(await page.locator('a:has-text("Break #")').count() >= 1, true, 'links to the break');
  await page.fill('input[aria-label="Find a reference"]', 'NOT-A-REFERENCE'); await page.keyboard.press('Enter');
  await page.waitForSelector('text=/No record carries/');
  await ctx.close();
});

test('theme: choice applies instantly, survives a reload, follows the system until chosen, and never flashes the wrong theme', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ctx, page } = await open('analyst', { colorScheme: 'light' });
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await theme(), 'light');
  const lightBg = await bg();
  await page.click('button[aria-label="Display settings"]'); await page.check('input[name=theme][value=dark]');
  assert.equal(await theme(), 'dark');
  assert.notEqual(await bg(), lightBg);
  await page.reload(); await settle(page);
  assert.equal(await theme(), 'dark', 'persisted');
  // system preference is followed while the choice is "Match system"
  await page.click('button[aria-label="Display settings"]'); await page.check('input[name=theme][value=system]');
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.emulateMedia({ colorScheme: 'light' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  // an explicit choice wins over the system
  await page.check('input[name=theme][value=dark]'); await page.emulateMedia({ colorScheme: 'light' });
  assert.equal(await theme(), 'dark');
  await ctx.close();

  // no flash: with the app script delayed, the first paint already uses the saved theme
  const c2 = await browser.newContext({ colorScheme: 'light' });
  await c2.addInitScript(() => { try { localStorage.setItem('bj.theme', 'dark'); } catch { /* ignore */ } });
  const p2 = await c2.newPage();
  await p2.route('**/js/main.js', async (route) => { await new Promise((r) => setTimeout(r, 800)); await route.continue(); });
  await p2.goto(app.base, { waitUntil: 'domcontentloaded' });
  assert.equal(await p2.evaluate(() => document.documentElement.dataset.theme), 'dark', 'set before the app script ran');
  assert.equal(await p2.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(16, 19, 25)', 'dark canvas painted');
  await c2.close();
});

test('theme and density: density changes row height and is remembered', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ctx, page } = await open('analyst');
  await page.goto(`${app.base}/#/breaks`); await settle(page);
  const h = () => page.evaluate(() => document.querySelector('tbody tr').getBoundingClientRect().height);
  const comfortable = await h();
  await page.click('button[aria-label="Display settings"]'); await page.check('input[name=density][value=compact]');
  assert.ok(await h() < comfortable, 'compact rows are shorter');
  await page.reload(); await settle(page);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.density), 'compact');
  await ctx.close();
});

test('upload: a wrong file type, an empty file, bad headers, a partly invalid file and a duplicate each get a specific answer', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await app.reset();
  const { ctx, page } = await open('analyst');
  await page.goto(`${app.base}/#/sources?upload=1`); await page.waitForSelector('#file-input', { state: 'attached' });
  const send = async (name, content) => {
    const f = path.join(tmp, name); fs.writeFileSync(f, content);
    await page.setInputFiles('#file-input', f);
    await page.click('button:has-text("Upload and validate")');
  };
  const resultText = () => page.locator('.panel-body .alert').last().textContent();

  await send('notes.txt', 'hello');
  await page.waitForSelector('.alert:has-text("Choose a .csv file")');                 // client-side convenience check
  await send('empty.csv', '');
  await page.waitForSelector('.alert:has-text("This file is empty")');
  await send('badheader.csv', 'a,b,c\n1,2,3\n');                                        // server-side validation
  await page.waitForSelector('.alert:has-text("File rejected")');
  assert.match(await page.locator('.hint:has-text("Expected columns")').textContent(), /ledger_id, reference/);

  // a ledger with two bad rows: accepted with a report that lists the reasons
  const g = generateScenario('invalid-rows', { size: 'small' });
  await send('partly-bad.csv', g.ledgerCsv);
  await page.waitForSelector('.result-figures');
  assert.match(await resultText(), /could not be loaded/);
  assert.equal(await page.locator('.result-figures figure, .result-figures .figure').count() >= 3, true);
  assert.equal(await page.locator('td:has-text("AMOUNT_ZERO")').count() >= 1, true, 'row-level reasons are listed');
  await page.click('a:has-text("View all rejected rows")'); await page.waitForSelector('h1:has-text("partly-bad.csv")'); await settle(page);
  assert.equal(await page.locator('tbody tr').count(), g.expected.ledgerRows.rejected);

  // the same bytes again are recognised, whatever the file is called
  await page.goto(`${app.base}/#/sources?upload=1`); await page.waitForSelector('#file-input', { state: 'attached' });
  await send('same-content-new-name.csv', g.ledgerCsv);
  await page.waitForSelector('.alert:has-text("already uploaded")');
  assert.equal(await page.locator('a:has-text("Open the original")').count(), 1);

  // the template download is a real, valid CSV
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download a template")')]);
  assert.equal(dl.suggestedFilename(), 'ledger-template.csv');
  assert.match(fs.readFileSync(await dl.path(), 'utf8'), /^ledger_id,reference,merchant,entry_type,amount,currency,recorded_at\n/);
  await ctx.close();
});

test('run page shows real progress states: a queued run waits for a worker and a failed run says why', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await app.reset();
  const api = await app.as('analyst');
  await worker.stop();                                       // no worker: the run must stay queued
  const g = generateScenario('clean-day', { size: 'small' });
  const l = await api.upload('ledger', 'l.csv', g.ledgerCsv); const s = await api.upload('settlement', 's.csv', g.settlementCsv);
  const run = (await api.post('/api/runs', { ledgerFileId: l.body.data.file.id, settlementFileId: s.body.data.file.id })).body.data;
  const { ctx, page } = await open('analyst');
  await page.goto(`${app.base}/#/runs/${run.id}`); await settle(page);
  assert.equal(await page.locator('.badge:has-text("Queued")').count(), 1);
  assert.equal(await page.locator('.alert:has-text("Waiting for a worker")').count(), 1);
  assert.equal(await page.locator('.figures').count(), 0, 'no results are shown before there are any');
  assert.equal(await page.locator('progress, [role=progressbar]').count(), 0, 'no invented percentage');
  await app.pool.query("UPDATE reconciliation_runs SET status = 'running', started_at = now(), attempts = 1, locked_by = 'x', lease_expires_at = now() + interval '1 minute' WHERE id = $1", [run.id]);
  await app.pool.query("UPDATE reconciliation_runs SET status = 'failed', finished_at = now(), error_code = 'ENGINE_ERROR', error_message = 'Simulated failure for the test', locked_by = NULL, lease_expires_at = NULL WHERE id = $1", [run.id]);
  await page.waitForSelector('.alert:has-text("This run failed")', { timeout: 8000 });
  assert.match(await page.locator('.alert:has-text("This run failed")').textContent(), /Simulated failure for the test/);
  await page.goto(`${app.base}/#/`); await settle(page);
  assert.equal(await page.locator('.alert:has-text("failed in the last 7 days")').count(), 1, 'the home page surfaces the failure');
  await ctx.close();
  worker = app.worker(); worker.start();
});

test('roles: each role sees exactly the controls it may use, and the server refuses the rest', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await app.reset();
  const analystApi = await app.as('analyst');
  await loadScenario(analystApi, 'break-storm', 'small');
  const b = (await analystApi.get('/api/breaks?type=FEE_VARIANCE')).body.data[0];
  await analystApi.post(`/api/breaks/${b.id}/proposals`, { resolutionCode: 'DISPUTE_WITH_PROCESSOR', note: 'Fee above the contracted rate.', breakVersion: b.version });
  const other = (await analystApi.get('/api/breaks?status=open')).body.data[0];
  assert.ok(other && other.id !== b.id, 'the scenario has a second open break to use');

  const s = await open('supervisor');
  await s.page.goto(`${app.base}/#/breaks/${b.id}`); await s.page.waitForSelector('button:has-text("Approve")'); await settle(s.page);
  assert.equal(await s.page.locator('button:has-text("Reject")').count(), 1);
  await s.page.goto(`${app.base}/#/breaks/${other.id}`); await settle(s.page);
  assert.equal(await s.page.locator('button:has-text("Submit for review")').count(), 0, 'a supervisor cannot propose');
  assert.equal(await s.page.locator('textarea[aria-label="New note"]').count(), 0, 'a supervisor cannot add investigation notes');
  assert.equal(await s.page.evaluate(async (id) => (await fetch(`/api/breaks/${id}/proposals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, other.id), 403);
  await s.ctx.close();

  const a = await open('analyst');
  await a.page.goto(`${app.base}/#/breaks/${b.id}`); await settle(a.page);
  assert.equal(await a.page.locator('button:has-text("Approve")').count(), 0, 'an analyst cannot decide');
  assert.match(await a.page.locator('text=/A supervisor will review|different supervisor/').first().textContent(), /supervisor/);
  await a.page.goto(`${app.base}/#/breaks/${other.id}`); await settle(a.page);
  assert.equal(await a.page.locator('button:has-text("Submit for review")').count(), 1);
  assert.equal(await a.page.locator('a.nav-link:has-text("Audit log")').count(), 0, 'no audit link for analysts');
  await a.page.goto(`${app.base}/#/audit`); await a.page.waitForSelector('text=Not available for your role');
  await a.ctx.close();

  const u = await open('auditor');
  await u.page.goto(`${app.base}/#/breaks/${other.id}`); await settle(u.page);
  assert.equal(await u.page.locator('button:has-text("Submit for review"), button:has-text("Approve"), button:has-text("Add note")').count(), 0);
  await u.page.goto(`${app.base}/#/runs`); await settle(u.page);
  assert.equal(await u.page.locator('button:has-text("New run")').count(), 0);
  await u.ctx.close();
});

test('confirmations: submitting and deciding are two deliberate steps; cancelling changes nothing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await app.reset();
  const analystApi = await app.as('analyst');
  await loadScenario(analystApi, 'fee-variances', 'small');
  const b = (await analystApi.get('/api/breaks?type=FEE_VARIANCE')).body.data[0];
  const a = await open('analyst');
  await a.page.goto(`${app.base}/#/breaks/${b.id}`); await a.page.waitForSelector('select'); await settle(a.page);
  // validation messages before anything is sent
  await a.page.click('button:has-text("Submit for review")');
  assert.equal(await a.page.locator('.alert:has-text("Choose a resolution")').count(), 1);
  await a.page.selectOption('select >> nth=0', 'DISPUTE_WITH_PROCESSOR'); await a.page.fill('textarea >> nth=0', 'short');
  await a.page.click('button:has-text("Submit for review")');
  assert.equal(await a.page.locator('.alert:has-text("at least 10 characters")').count(), 1);
  await a.page.fill('textarea >> nth=0', 'Fee above the contracted rate; raised with processor.');
  await a.page.click('button:has-text("Submit for review")');
  await a.page.waitForSelector('dialog[open]');
  assert.equal((await analystApi.get(`/api/breaks/${b.id}`)).body.data.proposals.length, 0, 'nothing is stored while the dialog is open');
  await a.page.click('dialog button:has-text("Cancel")');
  assert.equal((await analystApi.get(`/api/breaks/${b.id}`)).body.data.proposals.length, 0, 'cancel leaves no proposal');
  await a.page.click('button:has-text("Submit for review")'); await a.page.click('dialog button[type=submit]');
  await a.page.waitForSelector('text=Awaiting review'); 
  assert.equal((await analystApi.get(`/api/breaks/${b.id}`)).body.data.proposals.length, 1);
  await a.ctx.close();

  const s = await open('supervisor');
  await s.page.goto(`${app.base}/#/breaks/${b.id}`); await s.page.waitForSelector('button:has-text("Reject")'); await settle(s.page);
  await s.page.click('button:has-text("Reject")'); await s.page.waitForSelector('dialog[open]');
  await s.page.click('dialog button[type=submit]');                               // reason is mandatory for a rejection
  assert.match(await s.page.locator('dialog .field-error').textContent(), /at least 5 characters/);
  await s.page.click('dialog button:has-text("Cancel")');
  assert.equal((await analystApi.get(`/api/breaks/${b.id}`)).body.data.status, 'pending_review', 'still awaiting review');
  await s.ctx.close();
});

test('failure handling: an API outage shows a recoverable error state, not a blank page', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const before = issues.length;
  const { ctx, page } = await open('analyst');
  await page.route('**/api/breaks?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Something went wrong on our side.', requestId: 'req-test-1' } }) }));
  await page.goto(`${app.base}/#/breaks`);
  await page.waitForSelector('[role=alert]:has-text("This could not be loaded")');
  assert.equal(await page.locator('text=Reference req-test-1').count(), 1, 'the request id is shown so it can be reported');
  await page.unroute('**/api/breaks?*');
  await page.click('button:has-text("Try again")'); await settle(page);
  assert.equal(await page.locator('table.data-table').count(), 1);
  await ctx.close();
  const issuesHere = issues.slice(before).filter((i) => !/status of (403|409|500)/.test(i));
  assert.deepEqual(issuesHere, []);
});

test('session expiry: a lapsed session returns to the sign-in screen with an explanation', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ctx, page } = await open('analyst');
  await app.pool.query('DELETE FROM sessions');
  await page.goto(`${app.base}/#/breaks`);
  await page.waitForSelector('input[name=password]');
  assert.equal(await page.locator('text=Your session has ended').count(), 1);
  await ctx.close();
});
