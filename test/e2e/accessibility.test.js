'use strict';
/**
 * Accessibility checks in real Chrome: axe-core over every screen in both themes and on a phone, plus the keyboard
 * behaviours that automated rules cannot judge. axe finds about a third of real problems; the keyboard tests below
 * cover the interaction patterns (one tab stop per row, dialogs, menus, skip link) that it cannot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, PASSWORD } = require('../helpers/app');
const { launch, openAs, loadScenario, axeViolations } = require('../helpers/browser');

let app; let browser; let skipReason; let worker; let scenario;
const issues = [];

test.before(async () => {
  ({ browser, skipReason } = await launch());
  if (skipReason) return;
  app = await startTestApp({ WORKER_POLL_MS: '100' });
  worker = app.worker(); worker.start();
  scenario = await loadScenario(await app.as('analyst'), 'break-storm', 'small');
  // leave a pending proposal so the review queue and the decision buttons exist
  const analyst = await app.as('analyst');
  const b = (await analyst.get('/api/breaks?type=AMOUNT_MISMATCH')).body.data[0];
  await analyst.post(`/api/breaks/${b.id}/proposals`, { resolutionCode: 'CORRECT_LEDGER', note: 'Receipt shows the processor amount is right.', breakVersion: b.version });
});
test.after(async () => { await worker?.stop(); await browser?.close(); await app?.close(); });

const open = (role, opts) => openAs(browser, app, role, { issues, password: PASSWORD, ...opts });
// "settled" = data loaded AND entry animations finished; axe measures contrast on whatever opacity is on screen, so a mid-fade frame is a false alarm
const settle = (page) => page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !document.querySelector('.skeleton') && document.getAnimations().every((a) => a.playState !== 'running'));

const SCREENS = ['/', '/breaks', '/breaks/1', '/review', '/sources', '/sources/1', '/runs', '/runs/1', '/audit', '/settings', '/trace?reference=PAY-2611-000001'];

for (const [label, opts] of [['light desktop', {}], ['dark desktop', { colorScheme: 'dark' }], ['light phone', { viewport: { width: 390, height: 844 } }], ['dark phone', { viewport: { width: 390, height: 844 }, colorScheme: 'dark' }]]) {
  test(`axe: no violations on any screen (${label}, supervisor)`, async (t) => {
    if (skipReason) return t.skip(skipReason);
    const { ctx, page } = await open('supervisor', opts);
    const found = [];
    for (const route of SCREENS) {
      await page.goto(`${app.base}/#${route}`);
      await page.waitForSelector('h1');
      await settle(page);
      for (const v of await axeViolations(page)) found.push(`${route}: ${v}`);
    }
    await ctx.close();
    assert.deepEqual(found, []);
  });
}

test('axe: login screen, an open modal dialog and the open Display menu are clean in both themes', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const found = [];
  for (const colorScheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ colorScheme }); const page = await ctx.newPage();
    await page.goto(app.base); await page.waitForSelector('input[name=password]');
    for (const v of await axeViolations(page)) found.push(`login/${colorScheme}: ${v}`);
    await ctx.close();
    const { ctx: c2, page: p2 } = await open('supervisor', { colorScheme });
    await settle(p2);
    await p2.click('button[aria-label="Display settings"]');
    await p2.waitForSelector('#display-menu:popover-open');
    for (const v of await axeViolations(p2)) found.push(`display-menu/${colorScheme}: ${v}`);
    await p2.keyboard.press('Escape');
    await p2.goto(`${app.base}/#/review`); await settle(p2);
    await p2.click('td a.ref');
    // exact name: the review queue's "Approved" tab also contains the text "Approve"
    await p2.getByRole('button', { name: 'Approve', exact: true }).click(); await p2.waitForSelector('dialog[open]'); await settle(p2);
    for (const v of await axeViolations(p2)) found.push(`dialog/${colorScheme}: ${v}`);
    await c2.close();
  }
  assert.deepEqual(found, []);
});

test('axe: analyst and auditor views (restricted controls) are clean', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const found = [];
  for (const role of ['analyst', 'auditor']) {
    const { ctx, page } = await open(role);
    for (const route of ['/', '/breaks/1', '/sources', '/settings', ...(role === 'auditor' ? ['/audit'] : [])]) {
      await page.goto(`${app.base}/#${route}`); await page.waitForSelector('h1'); await settle(page);
      for (const v of await axeViolations(page)) found.push(`${role} ${route}: ${v}`);
    }
    await ctx.close();
  }
  assert.deepEqual(found, []);
});

test('keyboard: the skip link is the first tab stop and moves focus to the main content', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ctx, page } = await open('analyst');
  await page.goto(`${app.base}/#/breaks`); await settle(page);
  await page.reload(); await page.waitForSelector('main h1'); await settle(page);   // a fresh page load: focus starts at the top of the document
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  // the link must not be read as a route: the page stays where it was
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => location.hash), '#/breaks', 'the skip link leaves the address alone');
  assert.equal(await page.locator('main h1').innerText(), 'Breaks', 'the skip link does not replace the page');
  await ctx.close();
});

test('keyboard: a table row is one tab stop (its link), not two', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ctx, page } = await open('analyst');
  await page.goto(`${app.base}/#/breaks`); await settle(page);
  const stops = await page.evaluate(() => {
    const row = document.querySelector('tbody tr');
    return [...row.querySelectorAll('a, button, input, select, textarea, [tabindex]')].filter((e) => e.tabIndex >= 0).length + (row.tabIndex >= 0 ? 1 : 0);
  });
  assert.equal(stops, 1);
  await page.focus('tbody tr a.ref');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.queue-nav');
  assert.match(await page.evaluate(() => location.hash), /^#\/breaks\/\d+$/);
  await ctx.close();
});

test('keyboard: the Display menu opens with Enter, changes the theme with the arrow keys and closes with Escape', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ctx, page } = await open('analyst');
  await page.focus('button[aria-label="Display settings"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#display-menu:popover-open');
  await page.focus('input[name=theme][value=system]');
  await page.keyboard.press('ArrowDown');       // radio group: moves to "Light"
  await page.keyboard.press('ArrowDown');       // "Dark"
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#display-menu:popover-open').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Display settings', 'focus returns to the control that opened the menu');
  await ctx.close();
});

test('keyboard: a decision dialog traps focus, Escape cancels without deciding, and focus returns to the button', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ctx, page } = await open('supervisor');
  await page.goto(`${app.base}/#/review`); await settle(page);
  await page.click('td a.ref'); await page.waitForFunction(() => /^#\/breaks\/\d+/.test(location.hash)); await settle(page);
  // exact name: the review queue's "Approved" tab also contains the text "Approve"
  const approve = page.getByRole('button', { name: 'Approve', exact: true });
  await approve.waitFor();
  await approve.focus();
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
  assert.match(focused || '', /Approve/, `the Approve button must hold focus before Enter (active element: ${focused})`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog[open]', { timeout: 5000 }).catch(async (e) => {
    const state = await page.evaluate(() => ({ hash: location.hash, active: document.activeElement?.outerHTML?.slice(0, 120), buttons: [...document.querySelectorAll('button')].map((b) => `${b.textContent.trim()}${b.disabled ? '(disabled)' : ''}${b.dataset.busy ? '(busy)' : ''}`).join('|'), dialogs: document.querySelectorAll('dialog').length }));
    throw new Error(`Enter on Approve did not open the dialog: ${JSON.stringify(state)} / ${e.message}`);
  });
  // A native modal makes the page behind it inert. Tabbing past the last control may hand focus to the browser's own
  // UI (document.body here), but it must never land on anything behind the dialog.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement === document.body || Boolean(document.activeElement.closest('dialog'))), true, 'focus never reaches the inert page behind the dialog');
  }
  await page.focus('dialog textarea');             // tabbing may have moved focus to the browser UI; Escape needs focus inside the page
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog'));
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Approve/);
  assert.equal(await approve.count(), 1, 'nothing was decided');
  await ctx.close();
});

test('keyboard: the reference search is reachable with "/" and ignores the key while typing in a field', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ctx, page } = await open('analyst');
  await page.goto(`${app.base}/#/breaks`); await settle(page);
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Find a reference');
  await page.keyboard.type('a/b');
  assert.equal(await page.inputValue('input[aria-label="Find a reference"]'), 'a/b', '"/" typed into a field is text, not a shortcut');
  await ctx.close();
});

test('motion: with prefers-reduced-motion nothing animates or transitions for longer than a frame', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const ctx = await browser.newContext({ reducedMotion: 'reduce' }); const page = await ctx.newPage();
  await page.goto(app.base);
  const ms = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.btn')); return [parseFloat(s.transitionDuration) * 1000, parseFloat(s.animationDuration) * 1000]; });
  assert.ok(ms[0] <= 1 && ms[1] <= 1, `durations under reduced motion: ${ms}`);
  await ctx.close();
});

test('zoom: at 200% (720 CSS px wide) and 400% (360 CSS px) the page does not need horizontal scrolling', async (t) => {
  if (skipReason) return t.skip(skipReason);
  for (const width of [720, 360]) {
    const { ctx, page } = await open('supervisor', { viewport: { width, height: 700 } });
    for (const route of ['/', '/breaks', '/breaks/1', '/review', '/runs/1', '/audit']) {
      await page.goto(`${app.base}/#${route}`); await page.waitForSelector('h1'); await settle(page);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 1, `${route} at ${width}px overflows by ${over}px`);
    }
    await ctx.close();
  }
});

test('target size (WCAG 2.2 AA 2.5.8): every button, field, select and summary is at least 24 x 24 CSS px', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ctx, page } = await open('supervisor');
  const small = [];
  for (const route of ['/', '/breaks?type=AMOUNT_MISMATCH', '/breaks/1', '/review', '/sources', '/runs/1', '/audit', '/settings']) {
    await page.goto(`${app.base}/#${route}`); await page.waitForSelector('h1'); await settle(page);
    small.push(...(await page.evaluate(() => [...document.querySelectorAll('button, select, textarea, summary, input:not([type=checkbox]):not([type=radio]):not([type=file])')]
      .filter((e) => e.getBoundingClientRect().width > 0 && !e.closest('.sr-only'))
      .map((e) => { const r = e.getBoundingClientRect(); return { el: `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`, w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((x) => x.w < 24 || x.h < 24))).map((x) => `${route}: ${x.el} ${x.w}x${x.h}`));
  }
  await ctx.close();
  assert.deepEqual([...new Set(small)], []);
});

test('focus is never hidden behind the sticky top bar when tabbing down a long list (WCAG 2.2 AA 2.4.11)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ctx, page } = await open('auditor');
  await page.goto(`${app.base}/#/audit`); await page.waitForSelector('tbody a'); await settle(page);
  await page.focus('tbody a >> nth=0');
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const covered = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); const bar = document.querySelector('.topbar').getBoundingClientRect(); return r.height > 0 && r.top < bar.bottom - 1 && r.bottom > bar.top; });
    assert.equal(covered, false, `focus reached an element under the top bar on tab ${i + 1}`);
  }
  await ctx.close();
});

test('no unexpected browser console errors during the accessibility run', (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.deepEqual(issues.filter((i) => !/status of (403|409)/.test(i)), []);
});
