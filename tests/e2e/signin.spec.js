'use strict';
const { test, expect } = require('@playwright/test');
const { NAMES, ADMIN_PIN, fresh, signIn, noHorizontalScroll } = require('./helpers');

test('lists active officers', async ({ page }) => {
  await fresh(page);
  const names = await page.locator('#signin-user option').allTextContents();
  expect(names[0]).toBe('Choose your name');
  for (const n of Object.values(NAMES)) expect(names).toContain(n);
  expect(names).toContain('Marco Sample');
  expect(names).not.toContain('Pat Retired');
  // the list never shows roles, numbers or ids
  expect(names.join(' ')).not.toMatch(/Admin PIN|9101|USR-/);
});

test('lists active officers even when the name list is slow', async ({ page }) => {
  await fresh(page, { delayList: 600 });
  const names = await page.locator('#signin-user option').allTextContents();
  expect(names).toContain(NAMES.officer);
});

test('officer signs in without a PIN', async ({ page }) => {
  const problems = await fresh(page);
  await signIn(page, 'officer');
  await expect(page.locator('#screen-app')).toBeVisible();
  await expect(page.locator('#who')).toContainText('Olivia Tester');
  await expect(page.locator('#who')).toContainText('Training Officer');
  await expect(page.locator('#screen-signin')).toBeHidden();
  expect(problems.console).toEqual([]);
  expect(problems.requests).toEqual([]);
});

test('Admin must give the PIN', async ({ page }) => {
  await fresh(page);
  await signIn(page, 'admin');
  await expect(page.locator('#signin-message')).toContainText('Sign-in failed. Check the name and the PIN.');
  await expect(page.locator('#screen-app')).toBeHidden();
  await signIn(page, 'admin', ADMIN_PIN);
  await expect(page.locator('#screen-app')).toBeVisible();
  await expect(page.locator('#who')).toContainText('Admin');
});

test('wrong PIN shows the generic message and the PIN field is emptied', async ({ page }) => {
  await fresh(page);
  await signIn(page, 'admin', 'not-the-pin-1');
  const msg = page.locator('#signin-message');
  await expect(msg).toContainText('Sign-in failed. Check the name and the PIN.');
  await expect(msg).not.toContainText('not-the-pin-1');
  await expect(page.locator('#signin-pin')).toHaveValue('');
  await expect(page.locator('#screen-app')).toBeHidden();
});

test('five wrong PINs lock the Admin and say how long', async ({ page }) => {
  await fresh(page);
  for (let i = 0; i < 5; i++) await signIn(page, 'admin', 'wrong-pin-' + i);
  await expect(page.locator('#signin-message')).toContainText('Too many tries. Try again in 15 minutes.');
  await signIn(page, 'admin', ADMIN_PIN);
  await expect(page.locator('#signin-message')).toContainText('Too many tries');
  await expect(page.locator('#screen-app')).toBeHidden();
});

test('the token is not kept in storage or in the address', async ({ page }) => {
  await fresh(page);
  await signIn(page, 'officer');
  await expect(page.locator('#screen-app')).toBeVisible();
  const kept = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie, location.href]));
  expect(kept).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
});

test('sign out returns to the sign-in screen and the old token is useless', async ({ page }) => {
  await fresh(page);
  await signIn(page, 'officer');
  await expect(page.locator('#screen-app')).toBeVisible();
  await page.click('#signout');
  await expect(page.locator('#screen-signin')).toBeVisible();
  await expect(page.locator('#signin-message')).toContainText('You are signed out.');
  const res = await page.evaluate(async () => { try { await window.Api.call('auth.me'); return 'allowed'; } catch (e) { return e.code; } });
  expect(res).toBe('AUTH_REQUIRED');
});

for (const width of [1280, 768, 375]) {
  test('sign-in layout has no horizontal scroll at ' + width, async ({ page }) => {
    await fresh(page, { width });
    await noHorizontalScroll(page);
    await expect(page.locator('#signin-submit')).toBeVisible();
  });
}
