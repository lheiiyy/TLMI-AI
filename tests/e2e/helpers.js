'use strict';
const { expect } = require('@playwright/test');

const NAMES = {
  officer: 'Olivia Tester',
  supervisor: 'Sam Supervisor',
  manager: 'Mia Manager',
  senior: 'Sean Senior',
  admin: 'Ada Admin',
};
// Employee numbers and the password of the invented dev users (tools/dev-env.js). Test code only.
const NUMBERS = { officer: '9101', supervisor: '9102', manager: '9103', senior: '9104', admin: '9105', temporary: '9106' };
const PASSWORD = 'TEST-ONLY-Pass-1';
const ROLE_LABEL = {
  officer: 'Training Officer', supervisor: 'Training Supervisor', manager: 'Training Manager',
  senior: 'Senior Training Manager', admin: 'Admin',
};
const WIDTHS = [1280, 768, 375];

// Starts every test from the same invented data, and records console errors and failed requests.
async function fresh(page, opts) {
  const problems = { console: [], requests: [] };
  page.on('console', (m) => { if (m.type() === 'error') problems.console.push(m.text()); });
  page.on('pageerror', (e) => problems.console.push(String(e)));
  page.on('requestfailed', (r) => problems.requests.push(r.url() + ' ' + (r.failure() && r.failure().errorText)));
  page.on('response', (r) => { if (r.status() >= 400) problems.requests.push(r.url() + ' ' + r.status()); });
  await page.request.post('/__reset');
  if (opts && opts.width) await page.setViewportSize({ width: opts.width, height: 900 });
  await page.goto('/');
  await expect(page.locator('#signin-employee')).toBeVisible();
  return problems;
}

// Fills the form and submits it, and waits until the screen has handled the answer. Without the wait, the next call
// could fill the password before the page clears it after a failure, and the form would be submitted empty.
async function signIn(page, who, password) {
  await page.fill('#signin-employee', NUMBERS[who]);
  await page.fill('#signin-password', password === undefined ? PASSWORD : password);
  const answered = page.waitForResponse((r) => r.url().endsWith('/api') && (r.request().postData() || '').includes('auth.signIn'));
  await page.click('#signin-submit');
  await answered;
  await expect(page.locator('#signin-submit')).toBeEnabled();
}

async function signInAs(page, who) {
  await signIn(page, who);
  await expect(page.locator('#screen-app')).toBeVisible();
  await expect(page.locator('#who')).toContainText(NAMES[who] || '');
}

async function nav(page, id) {
  await page.click('[data-nav="' + id + '"]');
  await expect(page.locator('[data-nav="' + id + '"]')).toHaveAttribute('aria-current', 'page');
}

// Calls the real API from the page, with the page's own token, to prove the server (not the menu) decides.
async function apiFromPage(page, method, params) {
  return page.evaluate(async ([m, p]) => {
    try { return { ok: true, data: await window.Api.call(m, p) }; } catch (e) { return { ok: false, error: e }; }
  }, [method, params || {}]);
}

async function noHorizontalScroll(page) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(wide).toBe(false);
}

module.exports = { NAMES, NUMBERS, PASSWORD, ROLE_LABEL, WIDTHS, fresh, signIn, signInAs, nav, apiFromPage, noHorizontalScroll };
