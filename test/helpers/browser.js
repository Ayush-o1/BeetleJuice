'use strict';
// Shared plumbing for the Chrome tests: launch, role sign-in, scenario loading through the real API, axe.
const fs = require('node:fs');
const { generateScenario } = require('../../scripts/lib/scenario-library');

async function launch() {
  try {
    const { chromium } = require('playwright-core');
    return { browser: await chromium.launch({ channel: 'chrome', headless: true }), skipReason: null };
  } catch (err) {
    return { browser: null, skipReason: `Chrome not available for browser tests (${err.message.split('\n')[0]})` };
  }
}

/** Opens a page for `role` signed in through the real login form. Console errors and page errors are collected. */
async function openAs(browser, app, role, { viewport = { width: 1440, height: 900 }, colorScheme = 'light', issues = [], password } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') issues.push(`[${role}] console: ${m.text()}`); });
  page.on('pageerror', (e) => issues.push(`[${role}] pageerror: ${e.message}`));
  await page.goto(app.base);
  await page.fill('input[name=username]', role);
  await page.fill('input[name=password]', password);
  await page.click('button[type=submit]');
  await page.waitForSelector('.shell');
  return { ctx, page };
}

/** Uploads a scenario as `analystClient`, queues a run and waits (polling the API) until the worker finishes it. */
async function loadScenario(analystClient, name, size = 'normal') {
  const g = generateScenario(name, { size });
  const l = await analystClient.upload('ledger', `${name}-${size}-ledger.csv`, g.ledgerCsv);
  const s = await analystClient.upload('settlement', `${name}-${size}-settlement.csv`, g.settlementCsv);
  if (l.status !== 201 || s.status !== 201) throw new Error(`scenario upload failed ${l.status}/${s.status}`);
  const run = await analystClient.post('/api/runs', { ledgerFileId: l.body.data.file.id, settlementFileId: s.body.data.file.id, asOfDate: g.expected.asOfDate });
  if (run.status !== 202) throw new Error(`run create failed ${run.status}`);
  for (let i = 0; i < 100; i++) {
    const d = (await analystClient.get(`/api/runs/${run.body.data.id}`)).body.data;
    if (d.status === 'completed') return { g, runId: run.body.data.id, ledgerFileId: l.body.data.file.id, settlementFileId: s.body.data.file.id };
    if (d.status === 'failed') throw new Error(`run failed: ${d.errorCode}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('run did not complete in time');
}

let axeSource;
/** Runs axe-core (WCAG 2.0/2.1/2.2 A+AA and best-practice rules) on the current page; returns readable violations. */
async function axeViolations(page) {
  axeSource ||= fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  await page.evaluate(axeSource);       // evaluate (not a <script> tag) so the page's strict CSP is not involved
  return page.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }))
    .violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')} — ${v.help}`));
}

module.exports = { launch, openAs, loadScenario, axeViolations };
