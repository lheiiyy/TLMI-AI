'use strict';
const { test, expect } = require('@playwright/test');
const { NAMES, NUMBERS, PASSWORD, fresh, signIn, signInAs, noHorizontalScroll } = require('./helpers');

const GENERIC = 'Sign-in failed. Check the employee ID and the password.';

test('the sign-in screen asks for an employee ID and a password, with no name list and no PIN', async ({ page }) => {
  await fresh(page);
  await expect(page.locator('#signin-employee')).toBeVisible();
  await expect(page.locator('#signin-password')).toBeVisible();
  await expect(page.locator('#signin-user')).toHaveCount(0);
  await expect(page.locator('#screen-signin')).not.toContainText('PIN');
  // nothing about who exists is shown before sign-in
  await expect(page.locator('#screen-signin')).not.toContainText(NAMES.officer);
});

test('an officer signs in with employee ID and password', async ({ page }) => {
  const problems = await fresh(page);
  await signIn(page, 'officer');
  await expect(page.locator('#screen-app')).toBeVisible();
  await expect(page.locator('#who')).toContainText('Olivia Tester');
  await expect(page.locator('#who')).toContainText('Training Officer');
  await expect(page.locator('#screen-signin')).toBeHidden();
  expect(problems.console).toEqual([]);
  expect(problems.requests).toEqual([]);
});

test('Admin signs in the same way, with no PIN', async ({ page }) => {
  await fresh(page);
  await signInAs(page, 'admin');
  await expect(page.locator('#who')).toContainText('Admin');
});

test('a wrong password and an unknown ID show the same message, and the password field is emptied', async ({ page }) => {
  await fresh(page);
  await signIn(page, 'officer', 'not-the-password-1');
  const msg = page.locator('#signin-message');
  await expect(msg).toContainText(GENERIC);
  await expect(msg).not.toContainText('not-the-password-1');
  await expect(page.locator('#signin-password')).toHaveValue('');
  await expect(page.locator('#screen-app')).toBeHidden();
  await page.fill('#signin-employee', '424242');
  await page.fill('#signin-password', PASSWORD);
  await page.click('#signin-submit');
  await expect(msg).toContainText(GENERIC);
});

test('the employee ID must be digits, and both fields are needed', async ({ page }) => {
  await fresh(page);
  await page.click('#signin-submit');
  await expect(page.locator('#signin-message')).toContainText('Type your employee ID and your password.');
  await page.fill('#signin-employee', 'abc');
  await page.fill('#signin-password', 'x');
  await page.click('#signin-submit');
  await expect(page.locator('#signin-message')).toContainText('The employee ID is digits only.');
});

test('five wrong passwords pause that user and say how long, and another user is not affected', async ({ page }) => {
  await fresh(page);
  for (let i = 0; i < 5; i++) await signIn(page, 'officer', 'wrong-pass-' + i);
  await expect(page.locator('#signin-message')).toContainText('Too many tries. Try again in 15 minutes.');
  await signIn(page, 'officer');
  await expect(page.locator('#signin-message')).toContainText('Too many tries');
  await expect(page.locator('#screen-app')).toBeHidden();
  await signIn(page, 'supervisor');
  await expect(page.locator('#screen-app')).toBeVisible();
});

test('a temporary password sends the user to the change-password screen, and nothing else opens until it is changed', async ({ page }) => {
  const problems = await fresh(page);
  await signIn(page, 'temporary');
  await expect(page.locator('#screen-password')).toBeVisible();
  await expect(page.locator('#screen-app')).toBeHidden();
  await expect(page.locator('#pw-lead')).toContainText('temporary');
  await expect(page.locator('#pw-cancel')).toBeHidden();
  // the rule is stated, and the server's refusal is shown
  await expect(page.locator('#screen-password')).toContainText('At least 8 characters');
  await page.fill('#pw-current', PASSWORD);
  await page.fill('#pw-new', 'short1');
  await page.fill('#pw-repeat', 'short1');
  await page.click('#pw-submit');
  await expect(page.locator('#pw-message')).toContainText('Use at least 8 characters.');
  await expect(page.locator('#screen-app')).toBeHidden();
  await page.fill('#pw-current', PASSWORD);
  await page.fill('#pw-new', 'lettersonlyhere');
  await page.fill('#pw-repeat', 'lettersonlyhere');
  await page.click('#pw-submit');
  await expect(page.locator('#pw-message')).toContainText('Use at least one digit.');
  await page.fill('#pw-current', PASSWORD);
  await page.fill('#pw-new', 'my-own-pass-88');
  await page.fill('#pw-repeat', 'something-else-9');
  await page.click('#pw-submit');
  await expect(page.locator('#pw-message')).toContainText('The two new passwords are not the same.');
  await page.fill('#pw-current', 'wrong-current-1');
  await page.fill('#pw-new', 'my-own-pass-88');
  await page.fill('#pw-repeat', 'my-own-pass-88');
  await page.click('#pw-submit');
  await expect(page.locator('#pw-message')).toContainText('current password is not correct');
  await page.fill('#pw-current', PASSWORD);
  await page.fill('#pw-new', 'my-own-pass-88');
  await page.fill('#pw-repeat', 'my-own-pass-88');
  await page.click('#pw-submit');
  await expect(page.locator('#screen-app')).toBeVisible();
  await expect(page.locator('#who')).toContainText('Tina Temporary');
  await expect(page.locator('[data-section="brands"]')).toContainText("Angel's Pizza");
  // the new password works, the old one does not
  await page.click('#signout');
  await page.fill('#signin-employee', NUMBERS.temporary);
  await page.fill('#signin-password', PASSWORD);
  await page.click('#signin-submit');
  await expect(page.locator('#signin-message')).toContainText(GENERIC);
  await page.fill('#signin-employee', NUMBERS.temporary);
  await page.fill('#signin-password', 'my-own-pass-88');
  await page.click('#signin-submit');
  await expect(page.locator('#screen-app')).toBeVisible();
  expect(problems.console).toEqual([]);
  expect(problems.requests).toEqual([]);
});

test('any user can change the password from the top bar, and can cancel', async ({ page }) => {
  await fresh(page);
  await signInAs(page, 'officer');
  await page.click('#change-password');
  await expect(page.locator('#screen-password')).toBeVisible();
  await expect(page.locator('#pw-cancel')).toBeVisible();
  await page.click('#pw-cancel');
  await expect(page.locator('#screen-app')).toBeVisible();
  await page.click('#change-password');
  await page.fill('#pw-current', PASSWORD);
  await page.fill('#pw-new', PASSWORD);
  await page.fill('#pw-repeat', PASSWORD);
  await page.click('#pw-submit');
  await expect(page.locator('#pw-message')).toContainText('different from the current one');
  await page.fill('#pw-current', PASSWORD);
  await page.fill('#pw-new', 'fresh-start-77');
  await page.fill('#pw-repeat', 'fresh-start-77');
  await page.click('#pw-submit');
  await expect(page.locator('#screen-app')).toBeVisible();
  await expect(page.locator('#who')).toContainText('Olivia Tester');
});

test('the token is not kept in storage or in the address', async ({ page }) => {
  await fresh(page);
  await signInAs(page, 'officer');
  const kept = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie, location.href]));
  expect(kept).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  expect(kept).not.toContain(PASSWORD);
});

test('sign out returns to the sign-in screen and the old token is useless', async ({ page }) => {
  await fresh(page);
  await signInAs(page, 'officer');
  await page.click('#signout');
  await expect(page.locator('#screen-signin')).toBeVisible();
  await expect(page.locator('#signin-message')).toContainText('You are signed out.');
  const res = await page.evaluate(async () => { try { await window.Api.call('auth.me'); return 'allowed'; } catch (e) { return e.code; } });
  expect(res).toBe('AUTH_REQUIRED');
});

for (const width of [1280, 768, 375]) {
  test('sign-in and change-password layouts have no horizontal scroll at ' + width, async ({ page }) => {
    await fresh(page, { width });
    await noHorizontalScroll(page);
    await expect(page.locator('#signin-submit')).toBeVisible();
    await signIn(page, 'temporary');
    await expect(page.locator('#pw-submit')).toBeVisible();
    await noHorizontalScroll(page);
  });
}
