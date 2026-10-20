'use strict';
const { test, expect } = require('@playwright/test');
const { fresh, signInAs, signIn, nav, apiFromPage } = require('./helpers');

const stores = (page) => page.locator('[data-manager="stores"]');
const row = (scope, text) => scope.locator('tbody tr', { hasText: text });

test.beforeEach(async ({ page }) => {
  await fresh(page);
  await signInAs(page, 'admin');
});

test('edits a store and sees it in the list', async ({ page }) => {
  await nav(page, 'stores');
  await expect(row(stores(page), 'TEST STORE ONE')).toBeVisible();
  await page.getByRole('button', { name: 'Edit TEST STORE ONE' }).click();
  await expect(page.locator('#f-locations-name')).toHaveValue('TEST STORE ONE');
  await page.fill('#f-locations-name', 'TEST STORE UNO');
  await page.selectOption('#f-locations-region_id', { label: 'Cebu Test' });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(stores(page)).toContainText('Saved.');
  await expect(row(stores(page), 'TEST STORE UNO')).toContainText('Cebu Test');
  await expect(stores(page).locator('tbody')).not.toContainText('TEST STORE ONE');
  // and the history shows exactly the two changed fields
  const rows = await apiFromPage(page, 'locations.list', { q: 'UNO' });
  const hist = await apiFromPage(page, 'history.get', { entity: 'locations', id: rows.data[0].id });
  expect(hist.data.map((h) => h.field).sort()).toEqual(['name', 'region_id']);
});

test('stale edit shows the conflict message', async ({ page }) => {
  await nav(page, 'stores');
  await page.getByRole('button', { name: 'Edit SECOND TEST STORE' }).click();
  const list = await apiFromPage(page, 'locations.list', { q: 'SECOND' });
  const changed = await apiFromPage(page, 'locations.update', { id: list.data[0].id, row_version: list.data[0].row_version, patch: { name: 'CHANGED ELSEWHERE' } });
  expect(changed.ok).toBe(true);
  await page.fill('#f-locations-name', 'MY OWN CHANGE');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(stores(page)).toContainText('Changed by Ada Admin, reload.');
  await expect(stores(page).locator('form')).toHaveCount(0);
  await stores(page).getByRole('button', { name: 'Reload' }).click();
  await expect(stores(page)).toContainText('Reloaded.');
  await expect(row(stores(page), 'CHANGED ELSEWHERE')).toBeVisible();
  await expect(stores(page).locator('tbody')).not.toContainText('MY OWN CHANGE');
});

test('a duplicate store name shows the problem next to the name', async ({ page }) => {
  await nav(page, 'stores');
  await page.getByRole('button', { name: 'Add store' }).click();
  await page.fill('#f-locations-name', '  test store one ');
  await page.selectOption('#f-locations-location_type', { label: 'Store' });
  await page.selectOption('#f-locations-brand_id', { label: "Angel's Pizza" });
  await page.getByRole('button', { name: 'Add store' }).last().click();
  await expect(page.locator('[data-field="name"] .error-text')).toContainText('This value already exists.');
  await expect(page.locator('form [role="alert"]')).toContainText('Check the marked fields.');
  await page.fill('#f-locations-name', 'BRAND NEW STORE');
  await page.getByRole('button', { name: 'Add store' }).last().click();
  await expect(stores(page)).toContainText('Added.');
  await expect(row(stores(page), 'BRAND NEW STORE')).toBeVisible();
});

test('search narrows a list and says when nothing matches', async ({ page }) => {
  await nav(page, 'stores');
  await page.fill('[data-manager="stores"] input[type="search"]', 'provincial');
  await expect(stores(page).locator('tbody tr')).toHaveCount(1);
  await page.fill('[data-manager="stores"] input[type="search"]', 'zzz');
  await expect(stores(page)).toContainText('No match. Clear the search.');
});

test('deactivates and reactivates a lookup value, and a system value is protected', async ({ page }) => {
  await nav(page, 'lookups');
  const lookups = page.locator('[data-manager="lookups"]');
  await page.getByRole('button', { name: 'Deactivate Commissary' }).click();
  await expect(row(lookups, 'Commissary')).toContainText('Inactive');
  await page.getByRole('button', { name: 'Reactivate Commissary' }).click();
  await expect(row(lookups, 'Commissary')).toContainText('Active');
  await page.getByRole('button', { name: 'Deactivate Store' }).first().click();
  await expect(lookups).toContainText('A system value cannot be disabled.');
  await expect(row(lookups, 'Store').first()).toContainText('System');
});

test('brands and regions share one screen, and the brand code is fixed', async ({ page }) => {
  await nav(page, 'brands-regions');
  await expect(page.locator('[data-manager="brands"]')).toContainText("Angel's Pizza");
  await expect(page.locator('[data-manager="regions"]')).toContainText('NCR');
  await page.getByRole('button', { name: "Edit Angel's Pizza" }).click();
  await expect(page.locator('#f-brands-code')).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Add region' }).click();
  await page.fill('#f-regions-name', 'Visayas Test');
  await page.getByRole('button', { name: 'Add region' }).last().click();
  await expect(page.locator('[data-manager="regions"]')).toContainText('Visayas Test');
});

test('stations and components', async ({ page }) => {
  await nav(page, 'stations');
  await expect(page.locator('[data-manager="stations"]')).toContainText('Dough Maker');
  await nav(page, 'components');
  const comps = page.locator('[data-manager="components"]');
  await expect(comps).toContainText('Checklist');
  await expect(page.getByRole('button', { name: 'Add component' })).toBeHidden();
  await expect(comps.locator('[data-action="deactivate"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit Checklist' }).click();
  await page.fill('#f-components-name', 'Checklist grade');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(comps).toContainText('Saved.');
  await expect(row(comps, 'Checklist grade')).toBeVisible();
});

test('adds a user who can then sign in', async ({ page }) => {
  await nav(page, 'users');
  const users = page.locator('[data-manager="users"]');
  await page.getByRole('button', { name: 'Add user' }).click();
  await page.fill('#f-users-display_name', 'Pia Newhire');
  await page.selectOption('#f-users-role', { label: 'Training Officer' });
  await page.fill('#f-users-hr_employee_no', '9777');
  await page.getByRole('button', { name: 'Add user' }).last().click();
  await expect(users).toContainText('Added.');
  await expect(row(users, 'Pia Newhire')).toContainText('Training Officer');
  await expect(row(users, 'Pia Newhire')).toContainText('9777');
  // the list never shows hash or salt
  await expect(page.locator('#main')).not.toContainText('hmac-sha256');
  await page.click('#signout');
  await expect(page.locator('#signin-user option', { hasText: 'Pia Newhire' })).toHaveCount(1);
  await page.selectOption('#signin-user', { label: 'Pia Newhire' });
  await page.click('#signin-submit');
  await expect(page.locator('#who')).toContainText('Pia Newhire');
});

test('the last Admin cannot be deactivated, and a user cannot change their own role', async ({ page }) => {
  await nav(page, 'users');
  const users = page.locator('[data-manager="users"]');
  await page.getByRole('button', { name: 'Deactivate Ada Admin' }).click();
  await expect(users).toContainText('The last active Admin cannot be removed.');
  await page.getByRole('button', { name: 'Edit Ada Admin' }).click();
  await page.selectOption('#f-users-role', { label: 'Training Officer' });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(users).toContainText('You cannot change your own role.');
});

test('changes a setting with a reason and the old version stays in history', async ({ page }) => {
  await nav(page, 'settings');
  const table = page.locator('#main table').first();
  await expect(row(table, 'Certification pass mark')).toContainText('85');
  await page.getByRole('button', { name: 'Change Certification pass mark' }).click();
  await page.fill('#s-value', '80');
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.locator('[data-field="reason"] .error-text')).toBeVisible();
  await page.fill('#s-reason', 'Lower the mark for the test intake');
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.locator('#main')).toContainText('Saved as a new version.');
  await expect(row(table, 'Certification pass mark')).toContainText('80');
  await expect(row(table, 'Certification pass mark')).toContainText('2');
  await page.getByRole('button', { name: 'History of Certification pass mark' }).click();
  const history = page.locator('[data-section="history"]');
  await expect(history.locator('tbody tr')).toHaveCount(2);
  await expect(history).toContainText('Lower the mark for the test intake');
  await expect(history.locator('tbody tr').nth(1)).toContainText('85');
  await expect(history.locator('tbody tr').nth(1)).toContainText('Initial seed');
});

test('weights must total 100', async ({ page }) => {
  await nav(page, 'settings');
  await page.getByRole('button', { name: 'Change Certification weights: checklist / exam / feedback' }).click();
  await page.fill('#s-value', '30/40/20');
  await page.fill('#s-reason', 'test');
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.locator('[data-field="value"] .error-text')).toContainText('The weights must total 100.');
});

test('a stale settings change shows the conflict message', async ({ page }) => {
  await nav(page, 'settings');
  await page.getByRole('button', { name: 'Change Extension length (days)' }).click();
  const cur = await apiFromPage(page, 'settings.get', { setting_key: 'CFG-042' });
  const r = await apiFromPage(page, 'settings.set', { setting_key: 'CFG-042', value: '45', supersedes_id: cur.data.id, reason: 'elsewhere' });
  expect(r.ok).toBe(true);
  await page.fill('#s-value', '60');
  await page.fill('#s-reason', 'my change');
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.locator('#main')).toContainText('Changed by Ada Admin, reload.');
});

test('runs the seed dry run then the seed', async ({ page }) => {
  await nav(page, 'seed');
  const run = page.getByRole('button', { name: 'Run the seed' });
  await expect(run).toBeDisabled();
  await page.getByRole('button', { name: 'Check the seed' }).click();
  await expect(page.locator('#main')).toContainText('Check result: what the seed would create');
  await expect(run).toBeEnabled();
  await expect(page.locator('#main table').first()).toContainText('locations');
  await run.click();
  await expect(page.locator('#main')).toContainText(/The seed ran\. Batch IMP-\d{4}\./);
  await expect(page.locator('#main')).toContainText('Seed done: what was created');
  await expect(run).toBeDisabled();
});

test('runs import review and sees six tabs counts', async ({ page }) => {
  await nav(page, 'import');
  await page.getByRole('button', { name: 'Run the import review' }).click();
  await expect(page.locator('#main')).toContainText('Run finished');
  await expect(page.locator('[data-slot="status"]')).toHaveText('Done');
  const tabs = page.locator('#main table tbody tr');
  await expect(tabs).toHaveCount(6);
  const rowFor = (name) => tabs.filter({ hasText: name });
  await expect(rowFor('persons_proposed')).toContainText('9');
  await expect(rowFor('possible_duplicates')).toContainText('1');
  for (const t of ['name_mapping', 'bad_values', 'uniform_split', 'summary']) await expect(rowFor(t)).toBeVisible();
  await expect(rowFor('summary')).toContainText(/\d+/);
  await expect(page.locator('#main')).toContainText('MASTER_LOG rows');
  // the page names no sheet, id or link
  await expect(page.locator('#main')).not.toContainText(/docs\.google|legacy-copy-id|dev-review/);
  // leaving and coming back shows the last run
  await nav(page, 'home');
  await nav(page, 'import');
  await expect(page.locator('#main')).toContainText('Last run');
});

test('stays signed in across screens and signs out cleanly', async ({ page }) => {
  for (const id of ['settings', 'audit', 'users', 'home']) await nav(page, id);
  await page.click('#signout');
  await expect(page.locator('#screen-signin')).toBeVisible();
  await signIn(page, 'officer');
  await expect(page.locator('[data-nav="users"]')).toHaveCount(0);
});
