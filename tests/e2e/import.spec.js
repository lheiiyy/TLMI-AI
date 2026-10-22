'use strict';
const { test, expect } = require('@playwright/test');
const { WIDTHS, fresh, signInAs, nav, apiFromPage, noHorizontalScroll } = require('./helpers');

// The legacy import screen over the invented MASTER_LOG of tests/fixtures (11 rows). With the invented officer decisions
// (tests/fixtures/review-decisions.js): rows 2 to 9 are ready, row 11 and row 12 are not. "Today" in the fake clock is 2026-10-20.
const TODAY = '2026-10-20';

for (const width of [1280, 375]) {
  test('width ' + width + ': Admin checks, skips a row with a reason, commits with today\'s backup date and sees the batch reconciled', async ({ page }) => {
    const problems = await fresh(page, { width });
    await page.request.post('/__review-decisions');
    await signInAs(page, 'admin');
    await nav(page, 'legacy-import');
    await expect(page.locator('#main h1')).toHaveText('Legacy import');
    await page.getByRole('button', { name: 'Check the legacy rows' }).click();
    await expect(page.locator('#main')).toContainText('The check is done');
    await expect(page.locator('#main')).toContainText('The person is not confirmed in the review sheet');
    await expect(page.locator('#main')).not.toContainText('PERSON_UNCONFIRMED');
    await expect(page.locator('#main')).toContainText('Nothing was imported yet.');

    // a ready row with a warning shows its note, marked as a note
    await page.selectOption('[name="result"]', 'READY');
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page.locator('#main [data-note]').first()).toContainText('Note: ');

    // a not ready row is skipped, and the reason is required
    await page.selectOption('[name="result"]', 'NOT_READY');
    await page.getByRole('button', { name: 'Show' }).click();
    await page.locator('[data-skip]').first().click();
    await page.getByRole('button', { name: 'Skip this row' }).click();
    await expect(page.locator('#main')).toContainText('Check the marked fields');
    await page.fill('[name="skip_reason"]', 'Duplicate of a record kept in the paper file');
    await page.getByRole('button', { name: 'Skip this row' }).click();
    await expect(page.locator('#main')).toContainText('is skipped.');
    // the other not ready row is skipped too, so that nothing needs action
    await page.getByRole('button', { name: 'Show' }).click();
    while (await page.locator('[data-skip]').count() > 0) {
      await page.locator('[data-skip]').first().click();
      await page.fill('[name="skip_reason"]', 'Kept in the paper file');
      await page.getByRole('button', { name: 'Skip this row' }).click();
      await expect(page.locator('#main')).toContainText('is skipped.');
      await page.getByRole('button', { name: 'Show' }).click();
    }

    // the backup date must be today
    await page.fill('[name="backup_date"]', '2026-10-01');
    await page.getByRole('button', { name: 'Commit the ready rows' }).click();
    await expect(page.locator('#main [role="status"]').first()).toContainText(/backup/i);
    await expect(page.locator('#main')).toContainText('proves nothing');
    await page.fill('[name="backup_date"]', TODAY);
    await page.getByRole('button', { name: 'Commit the ready rows' }).click();
    await expect(page.locator('#main')).toContainText('The commit is complete.');
    await expect(page.locator('[data-slot="batch-facts"]')).toContainText('Committed');
    await expect(page.locator('[data-slot="commit-form"]')).toBeHidden();

    await expect(page.locator('[data-slot="reconciled"]')).toHaveText('Yes');
    await page.getByRole('button', { name: 'Check the legacy rows' }).click();
    await expect(page.locator('#main')).toContainText('The check is done');
    await expect(page.locator('[data-slot="by-result"]')).toContainText(/Already committed\s*8/);

    // the rows are now listed as already committed and the batch is Committed
    await page.selectOption('[name="result"]', 'ALREADY_COMMITTED');
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page.locator('#main table').last().locator('tbody tr').first()).toContainText('Already committed');
    await noHorizontalScroll(page);
    expect(problems.console).toEqual([]);
    expect(problems.requests).toEqual([]);
  });
}

test('other roles have no Legacy import menu entry, and the server refuses them', async ({ page }) => {
  await fresh(page, { width: WIDTHS[0] });
  for (const who of ['officer', 'supervisor', 'manager', 'senior']) {
    await signInAs(page, who);
    await expect(page.locator('[data-nav="legacy-import"]')).toHaveCount(0);
    for (const m of ['import.validate', 'import.get', 'import.rows.list', 'import.rows.skip', 'import.commit']) {
      const res = await apiFromPage(page, m, {});
      expect(res.ok).toBe(false);
      expect(res.error.code, m).toBe('FORBIDDEN');
    }
    await page.click('#signout');
    await expect(page.locator('#screen-signin')).toBeVisible();
  }
});
