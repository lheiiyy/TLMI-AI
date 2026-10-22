'use strict';
const { test, expect } = require('@playwright/test');
const { NAMES, ROLE_LABEL, WIDTHS, fresh, signInAs, nav, apiFromPage, noHorizontalScroll } = require('./helpers');

const ROLES = ['officer', 'supervisor', 'manager', 'senior', 'admin'];
const ADMIN_ENTRIES = ['stores', 'stations', 'brands-regions', 'lookups', 'components', 'users', 'seed', 'import'];
const SETTINGS_ROLES = ['manager', 'senior', 'admin'];
const AUDIT_ROLES = ['senior', 'admin'];

for (const role of ROLES) {
  test(role + ': signs in and sees the master lists', async ({ page }) => {
    const problems = await fresh(page);
    await signInAs(page, role);
    await expect(page.locator('#who')).toContainText(ROLE_LABEL[role]);
    await expect(page.locator('[data-section="brands"]')).toContainText("Angel's Pizza");
    await expect(page.locator('[data-section="regions"]')).toContainText('NCR');
    await expect(page.locator('[data-section="stores"]')).toContainText('TEST STORE ONE');
    await expect(page.locator('[data-section="stores"]')).toContainText('DOÑA TEST');
    await expect(page.locator('[data-section="stations"]')).toContainText('Pizza Maker');
    await expect(page.locator('[data-section="lookups"]')).toContainText('Commissary');
    expect(problems.console).toEqual([]);
    expect(problems.requests).toEqual([]);
  });

  test(role + ': the menu follows the role, and the server decides', async ({ page }) => {
    await fresh(page);
    await signInAs(page, role);
    // Team Leaders is open to all five roles and is the first entry of the menu
    await expect(page.locator('[data-nav="tl"]')).toHaveCount(1);
    expect(await page.locator('#nav button').first().getAttribute('data-nav')).toBe('tl');
    for (const id of ADMIN_ENTRIES) {
      await expect(page.locator('[data-nav="' + id + '"]')).toHaveCount(role === 'admin' ? 1 : 0);
    }
    await expect(page.locator('[data-nav="settings"]')).toHaveCount(SETTINGS_ROLES.includes(role) ? 1 : 0);
    await expect(page.locator('[data-nav="audit"]')).toHaveCount(AUDIT_ROLES.includes(role) ? 1 : 0);
    // a direct call, as someone who ignores the menu
    const write = await apiFromPage(page, 'brands.create', { name: 'Sneaky Brand', code: 'SB' });
    const users = await apiFromPage(page, 'users.list', {});
    const seed = await apiFromPage(page, 'seed.run', { dry_run: true });
    const settings = await apiFromPage(page, 'settings.set', { setting_key: 'CFG-041', value: '50', reason: 'sneaky' });
    if (role === 'admin') {
      expect(write.ok).toBe(true);
      expect(users.ok).toBe(true);
    } else {
      for (const r of [write, users, seed, settings]) {
        expect(r.ok).toBe(false);
        expect(r.error.code).toBe('FORBIDDEN');
      }
      const list = await apiFromPage(page, 'brands.list', {});
      expect(list.ok).toBe(true);
      expect(list.data.map((b) => b.name)).not.toContain('Sneaky Brand');
    }
  });
}

test('Senior Training Manager sees the audit log, without HR numbers', async ({ page }) => {
  await fresh(page);
  await signInAs(page, 'senior');
  await nav(page, 'audit');
  const table = page.locator('#main table');
  await expect(table.locator('tbody tr').first()).toBeVisible();
  await expect(table).toContainText('AUTH.SIGNIN');
  // the invented Team Leader records fill the first page; the seed run is found with the event filter
  await page.fill('[name="event"]', 'SEED.RUN');
  await page.click('button:has-text("Show")');
  await expect(page.locator('#main table')).toContainText('SEED.RUN');
  await expect(table).not.toContainText('9105');
  await expect(page.locator('#main th', { hasText: 'HR number' })).toHaveCount(0);
});

test('Admin sees HR numbers in the audit log and can filter it', async ({ page }) => {
  await fresh(page);
  await signInAs(page, 'admin');
  await nav(page, 'audit');
  await expect(page.locator('#main th', { hasText: 'HR number' })).toHaveCount(1);
  await expect(page.locator('#main table')).toContainText('9105');
  await page.fill('[name="entity"]', 'locations');
  await page.click('button:has-text("Show")');
  await expect(page.locator('#main tbody tr').first()).toContainText('LOCATION.CREATED');
  await expect(page.locator('#main tbody')).not.toContainText('AUTH.SIGNIN');
});

test('Manager reads the settings but cannot change them', async ({ page }) => {
  await fresh(page);
  await signInAs(page, 'manager');
  await nav(page, 'settings');
  await expect(page.locator('#main table')).toContainText('Certification pass mark');
  await expect(page.locator('#main table')).toContainText('85');
  await expect(page.locator('#main [data-action="change"]')).toHaveCount(0);
  await expect(page.locator('#main [data-action="history"]').first()).toBeVisible();
});

test('a session that ended on the server returns to sign-in with a clear message', async ({ page }) => {
  await fresh(page);
  await signInAs(page, 'officer');
  await page.request.post('/__advance', { data: { minutes: 31 } });
  await page.evaluate(() => { window.Api.call('brands.list').catch(() => {}); });
  await expect(page.locator('#screen-signin')).toBeVisible();
  await expect(page.locator('#signin-message')).toContainText('Your session has ended. Sign in again.');
  await expect(page.locator('#screen-app')).toBeHidden();
});

for (const width of WIDTHS) {
  for (const role of ROLES) {
    test('width ' + width + ', ' + role + ': the main flow works with no console errors and no failed requests', async ({ page }) => {
      const problems = await fresh(page, { width });
      await signInAs(page, role);
      await expect(page.locator('[data-section="stores"]')).toContainText('SECOND TEST STORE');
      await noHorizontalScroll(page);
      const entries = ['tl', 'home'];
      if (SETTINGS_ROLES.includes(role)) entries.push('settings');
      if (AUDIT_ROLES.includes(role)) entries.push('audit');
      if (role === 'admin') entries.push(...ADMIN_ENTRIES);
      for (const id of entries) {
        await nav(page, id);
        await expect(page.locator('#main h1, #main h2').first()).toBeVisible();
        await expect(page.locator('#main .notice.error')).toHaveCount(0);
        await noHorizontalScroll(page);
        if (id === 'tl') {
          await expect(page.locator('[data-view="tl-list"] tbody tr').first()).toBeVisible();
          await page.click('[data-slot="enroll"]');
          await expect(page.locator('[data-view="tl-enroll"]')).toBeVisible();
          await noHorizontalScroll(page);
          await page.click('[data-slot="back"]');
          await expect(page.locator('[data-view="tl-list"] tbody tr').first()).toBeVisible();
          await page.click('[data-open="TLE-2026-0003"]');
          await expect(page.locator('[data-view="tl-record"] [data-slot="header"]')).toContainText('Certification check');
          await noHorizontalScroll(page);
        }
      }
      await page.click('#signout');
      await expect(page.locator('#screen-signin')).toBeVisible();
      expect(problems.console).toEqual([]);
      expect(problems.requests).toEqual([]);
      expect(Object.values(NAMES)).toContain(NAMES[role]);
    });
  }
}
