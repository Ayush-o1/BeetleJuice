'use strict';

/**
 * Captures the README/documentation screenshots from the REAL running application (nothing is mocked or drawn).
 *
 *   npm run demo:reset -- --yes --load-sample      # a clean demo database (dev only)
 *   npm run dev                                    # in another terminal
 *   npm run screenshots [-- --upload]
 *
 * Requires Chrome (via playwright-core). Only talks to localhost and signs in with the documented demo accounts.
 * --upload also uploads one generated invalid-rows ledger to capture the upload report; that adds a file to the
 * demo database, so run `demo:reset` again afterwards if you want the pristine data back.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { DEMO_PASSWORD } = require('./lib/demo-users');
const { generateScenario } = require('./lib/scenario-library');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error('Refusing to use demo credentials against a non-local URL.'); process.exit(1); }
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

const SHOTS = [
  // [file, role, route, {w,h,scheme,wait,after}]
  ['overview.png', 'supervisor', '/', { h: 1000 }],
  ['breaks.png', 'analyst', '/breaks', { h: 860 }],
  ['break-detail.png', 'analyst', '/breaks/5', { h: 1040 }],
  ['review.png', 'supervisor', '/review', { h: 420 }],
  ['run.png', 'analyst', '/runs/1', { h: 900 }],
  ['audit.png', 'auditor', '/audit', { h: 900, after: async (p) => { await p.check('input[type=checkbox]'); await p.waitForTimeout(500); } }],
  ['trace.png', 'analyst', '/trace?reference=PAY-2611-00296', { h: 860 }],
  ['overview-dark.png', 'supervisor', '/', { h: 1000, scheme: 'dark' }],
  ['break-detail-dark.png', 'supervisor', '/breaks/19', { h: 1040, scheme: 'dark' }],
  ['mobile-queue.png', 'analyst', '/breaks', { w: 390, h: 844 }],
  ['mobile-break.png', 'analyst', '/breaks/5', { w: 390, h: 844 }],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const contexts = new Map();
  const pageFor = async (role, w, h, scheme) => {
    const key = `${role}|${w}|${h}|${scheme}`;
    if (contexts.has(key)) return contexts.get(key);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme || 'light', deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(BASE); await page.fill('input[name=username]', role); await page.fill('input[name=password]', DEMO_PASSWORD);
    await page.click('button[type=submit]'); await page.waitForSelector('.shell');
    contexts.set(key, page); return page;
  };
  const settle = (page) => page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !document.querySelector('.skeleton') && document.getAnimations().every((a) => a.playState !== 'running'));

  // login screen first (signed out)
  { const ctx = await browser.newContext({ viewport: { width: 1440, height: 760 } }); const p = await ctx.newPage(); await p.goto(BASE); await p.waitForSelector('input[name=password]'); await p.screenshot({ path: path.join(OUT, 'login.png') }); await ctx.close(); }

  for (const [file, role, route, o = {}] of SHOTS) {
    const page = await pageFor(role, o.w || 1440, o.h || 900, o.scheme);
    await page.goto(`${BASE}/#${route}`);
    await page.waitForSelector('h1'); await settle(page);
    if (o.after) await o.after(page);
    await settle(page);
    await page.screenshot({ path: path.join(OUT, file) });
    console.log(`wrote docs/screenshots/${file}`);
  }

  if (process.argv.includes('--upload')) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bj-shot-')); const f = path.join(tmp, 'ledger-invalid-rows.csv');
    fs.writeFileSync(f, generateScenario('invalid-rows', { size: 'normal' }).ledgerCsv);
    const page = await pageFor('analyst', 1440, 1000);
    await page.goto(`${BASE}/#/sources?upload=1`); await page.waitForSelector('#file-input', { state: 'attached' });
    await page.setInputFiles('#file-input', f); await page.click('button:has-text("Upload and validate")');
    await page.waitForSelector('.result-figures'); await settle(page);
    await page.evaluate(() => { const a = [...document.querySelectorAll('.panel-body .alert')].pop(); window.scrollBy(0, a.getBoundingClientRect().top - 150); });   // headline of the report just under the top bar
    await page.screenshot({ path: path.join(OUT, 'upload-result.png') });
    console.log('wrote docs/screenshots/upload-result.png'); fs.rmSync(tmp, { recursive: true, force: true });
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
