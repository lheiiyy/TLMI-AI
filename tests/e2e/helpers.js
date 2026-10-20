'use strict';
const { expect } = require('@playwright/test');

const NAMES = {
  officer: 'Olivia Tester',
  supervisor: 'Sam Supervisor',
  manager: 'Mia Manager',
  senior: 'Sean Senior',
  admin: 'Ada Admin',
};
const ROLE_LABEL = {
  officer: 'Training Officer', supervisor: 'Training Supervisor', manager: 'Training Manager',
  senior: 'Senior Training Manager', admin: 'Admin',
};
const ADMIN_PIN = 'TEST-ONLY-PIN-1';
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
  await expect(page.locator('#signin-user')).toBeVisible();
  return problems;
}

async function signIn(page, who, pin) {
  await page.selectOption('#signin-user', { label: NAMES[who] });
  if (pin !== undefined) await page.fill('#signin-pin', pin);
  await page.click('#signin-submit');
}

async function signInAs(page, who) {
  await signIn(page, who, who === 'admin' ? ADMIN_PIN : undefined);
  await expect(page.locator('#screen-app')).toBeVisible();
  await expect(page.locator('#who')).toContainText(NAMES[who]);
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

module.exports = { NAMES, ROLE_LABEL, ADMIN_PIN, WIDTHS, fresh, signIn, signInAs, nav, apiFromPage, noHorizontalScroll };
