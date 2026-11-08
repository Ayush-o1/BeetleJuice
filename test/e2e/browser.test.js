'use strict';
/**
 * Real-browser end-to-end journey (Chrome via playwright-core): analyst uploads and runs, investigates and
 * proposes; supervisor approves; auditor inspects. Skipped (loudly) when no Chrome is installed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestApp, PASSWORD } = require('../helpers/app');
const { ledgerCsv, settlementCsv } = require('../helpers/scenario');

let chromium; let browser; let app; let worker; let tmp; let skipReason = null;
const issues = [];

test.before(async () => {
  try {
    ({ chromium } = require('playwright-core'));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (err) {
    skipReason = `Chrome not available for browser E2E (${err.message.split('\n')[0]})`;
    return;
  }
  app = await startTestApp({ WORKER_POLL_MS: '100' });
  worker = app.worker();
  worker.start();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bj-e2e-'));
  fs.writeFileSync(path.join(tmp, 'ledger-nov.csv'), ledgerCsv);
  fs.writeFileSync(path.join(tmp, 'settlement-nov.csv'), settlementCsv);
});
test.after(async () => {
  await worker?.stop();
  await browser?.close();
  await app?.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

async function open(role) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') issues.push(`[${role}] console: ${m.text()}`); });
  page.on('pageerror', (e) => issues.push(`[${role}] pageerror: ${e.message}`));
  await page.goto(app.base);
  return { ctx, page };
}
async function signIn(page, user, password = PASSWORD) {
  await page.fill('input[name=username]', user);
  await page.fill('input[name=password]', password);
  await page.click('button[type=submit]');
  await page.waitForSelector('.shell');
}

test('browser journey: analyst -> supervisor -> auditor', async (t) => {
  if (skipReason) return t.skip(skipReason);

  /* ---- analyst ---- */
  const a = await open('analyst');
  const { page } = a;
  await signIn(page, 'analyst');
  await page.waitForSelector('text=No reconciliation data yet');
  assert.equal(await page.locator('a.nav-link', { hasText: 'Audit log' }).count(), 0, 'analyst has no audit nav');

  await page.click('a.nav-link:has-text("Sources")');
  await page.click('button:has-text("Upload file")');
  await page.setInputFiles('#file-input', path.join(tmp, 'ledger-nov.csv'));
  await page.click('button:has-text("Upload and validate")');
  await page.waitForSelector('text=Upload contains invalid rows');
  assert.match(await page.locator('.figures').first().innerText(), /Accepted\s*7/);
  assert.match(await page.locator('.result-figures').innerText(), /AMOUNT_ZERO/);

  await page.locator('label.radio-card:has-text("Processor settlement")').click();
  await page.setInputFiles('#file-input', path.join(tmp, 'settlement-nov.csv'));
  await page.click('button:has-text("Upload and validate")');
  await page.waitForSelector('text=File ingested');

  await page.locator('label.radio-card:has-text("Internal ledger")').click();
  await page.setInputFiles('#file-input', path.join(tmp, 'ledger-nov.csv'));
  await page.click('button:has-text("Upload and validate")');
  await page.waitForSelector('text=This file was already uploaded');

  await page.click('a.nav-link:has-text("Runs")');
  await page.click('button:has-text("New run")');
  await page.waitForSelector('input[type=date]:not([value=""])');
  await page.click('button:has-text("Start run")');
  await page.waitForSelector('h1:has-text("Run #1")');
  await page.waitForSelector('.badge:has-text("Completed")', { timeout: 15000 });
  assert.match(await page.locator('.figures').innerText(), /Matched\s*3/);
  assert.match(await page.locator('.figures').innerText(), /Transaction breaks\s*5/);

  await page.click('a:has-text("View breaks")');
  await page.waitForFunction(() => location.hash.startsWith('#/breaks') && document.querySelectorAll('table.data-table tbody tr').length === 6);
  await page.fill('input[aria-label="Search reference"]', 'PAY-1002');
  await page.waitForFunction(() => document.querySelectorAll('table.data-table tbody tr').length === 1);
  await page.click('a:has-text("PAY-1002")');
  await page.waitForSelector('text=amounts differ');
  assert.match(await page.locator('.compare').innerText(), /₹1,200\.00[\s\S]*₹1,250\.00/);

  await page.fill('textarea[placeholder^="Record what"]', 'Called the processor, they confirm 1250.00 was charged.');
  await page.click('button:has-text("Add note")');
  await page.waitForSelector('text=Called the processor');

  await page.selectOption('select[required]', 'CORRECT_LEDGER');
  await page.fill('textarea[required]', 'Receipt shows 1250.00, ledger entry keyed wrongly.');
  await page.click('button:has-text("Submit for review")');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('.badge:has-text("Awaiting review")');
  assert.equal(await page.locator('button:has-text("Approve")').count(), 0, 'analyst cannot approve');
  await page.evaluate(() => { location.hash = '#/audit'; });
  await page.waitForSelector('text=Not available for your role');
  const forbidden = await page.evaluate(async () => (await fetch('/api/audit')).status);
  assert.equal(forbidden, 403);
  await a.ctx.close();

  /* ---- supervisor ---- */
  const s = await open('supervisor');
  await signIn(s.page, 'supervisor');
  await s.page.waitForSelector('.nav-count:has-text("1")');
  await s.page.click('a.nav-link:has-text("Review queue")');
  await s.page.click('a:has-text("PAY-1002")');
  await s.page.waitForSelector('text=Correct the ledger');
  await s.page.click('button:has-text("Approve")');
  await s.page.click('dialog button[type=submit]');
  await s.page.waitForSelector('text=Resolved: Correct the ledger');
  await s.page.click('a.nav-link:has-text("Settings")');
  assert.equal(await s.page.locator('button:has-text("Save as new version")').isEnabled(), true);
  await s.ctx.close();

  /* ---- auditor ---- */
  const u = await open('auditor');
  await signIn(u.page, 'auditor');
  await u.page.click('a.nav-link:has-text("Audit log")');
  await u.page.waitForSelector('td .tag:has-text("proposal.approved")');
  await u.page.click('a.nav-link:has-text("Sources")');
  assert.equal(await u.page.locator('button:has-text("Upload file")').count(), 0, 'auditor cannot upload');
  await u.page.evaluate(() => { location.hash = '#/breaks/1'; });
  await u.page.waitForSelector('h1');
  assert.equal(await u.page.locator('button:has-text("Submit for review")').count(), 0);
  await u.page.click('a.nav-link:has-text("Settings")');
  assert.equal(await u.page.locator('button:has-text("Save as new version")').count(), 0);
  assert.equal(await u.page.locator('main input').first().isDisabled(), true);
  const status = await u.page.evaluate(async () => (await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
  assert.equal(status, 403);
  await u.ctx.close();

  // The journey deliberately provokes a 409 (duplicate upload) and 403s (role checks); Chrome logs failed
  // fetches as console errors, so exactly those statuses are expected. Anything else fails the test.
  const unexpected = issues.filter((i) => !/status of (403|409)/.test(i));
  assert.deepEqual(unexpected, [], 'no unexpected browser console errors');
});

test('browser: login failure shows a generic message, sign-out ends the session', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ctx, page } = await open('login');
  await page.fill('input[name=username]', 'analyst');
  await page.fill('input[name=password]', 'wrong-password-123');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Invalid username or password');
  await signIn(page, 'analyst');
  await page.click('button:has-text("Sign out")');
  await page.waitForSelector('input[name=password]');
  assert.equal(await page.evaluate(async () => (await fetch('/api/auth/me')).status), 401);
  await ctx.close();
});

test('browser: responsive layout keeps primary navigation reachable on a phone', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(app.base);
  await signIn(page, 'auditor');
  await page.click('button[aria-label="Open navigation"]');
  await page.click('a.nav-link:has-text("Audit log")');
  await page.waitForSelector('h1:has-text("Audit log")');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `page should not scroll horizontally (overflow ${overflow}px)`);
  await ctx.close();
});
