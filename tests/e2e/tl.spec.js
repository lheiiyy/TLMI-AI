'use strict';
const { test, expect } = require('@playwright/test');
const { NUMBERS, PASSWORD, WIDTHS, fresh, signInAs, nav, apiFromPage, noHorizontalScroll } = require('./helpers');

// Invented records from tools/dev-env.js ("today" in the fake clock is 2026-10-20):
// 0001 Ana Reyes Entry, 0002 Ben Santos Probationary, 0003 Carla Cruz Certification check (passing), 0004 Dino Lim Certified,
// 0005 Elena Tan Promoted, 0006 Felix Ocampo Failed, 0007 Gina Ramos Quit, 0008 Hector Villanueva Probationary and overdue,
// 0009 Iris Mendoza Extended. CFG-047 (extension limit) is not set.
const ID = { reyes: 'TLE-2026-0001', santos: 'TLE-2026-0002', cruz: 'TLE-2026-0003', lim: 'TLE-2026-0004', villanueva: 'TLE-2026-0008' };

function widthly(name, fn) {
  for (const width of WIDTHS) {
    test('width ' + width + ': ' + name, async ({ page }) => {
      const problems = await fresh(page, { width });
      await fn(page, width);
      await noHorizontalScroll(page);
      expect(problems.console).toEqual([]);
      expect(problems.requests).toEqual([]);
    });
  }
}

async function openTl(page, who, id) {
  await signInAs(page, who);
  await nav(page, 'tl');
  await expect(page.locator('[data-view="tl-list"] tbody tr').first()).toBeVisible();
  if (id) {
    await page.click('[data-open="' + id + '"]');
    await expect(page.locator('[data-view="tl-record"]')).toBeVisible();
  }
}

async function fillForm(page, values) {
  for (const [name, value] of Object.entries(values)) {
    const el = page.locator('form [name="' + name + '"]');
    if ((await el.evaluate((n) => n.tagName)) === 'SELECT') await el.selectOption(value); else await el.fill(String(value));
  }
}

// Admin changes a setting or a list outside the page under test (its own sign-in, no cookies involved).
async function adminApi(page, method, params) {
  const post = async (body) => (await page.request.post('/api', { data: Object.assign({ v: 1 }, body) })).json();
  const si = await post({ method: 'auth.signIn', params: { employee_id: NUMBERS.admin, password: PASSWORD } });
  const out = await post({ method: method, params: params, token: si.data.token });
  await post({ method: 'auth.signOut', params: {}, token: si.data.token });
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return out.data;
}

widthly('an officer enrolls a new person after the duplicate warning', async (page) => {
  await openTl(page, 'officer');
  await page.click('[data-slot="enroll"]');
  await expect(page.locator('[data-view="tl-enroll"]')).toBeVisible();
  await expect(page.locator('[data-slot="deadline-note"]')).toContainText('calculated by the server');
  await fillForm(page, {
    last_name: 'Reyes', first_name: 'Ana', mother_location_id: 'LOC-0001', station_id: 'STN-0001', batch_code: 'B-09', entry_date: '2026-10-19',
  });
  await page.click('[data-slot="save"]');
  await expect(page.locator('[data-slot="warning"]')).toContainText('Possible matches');
  await expect(page.locator('[data-slot="warning"]')).toContainText('Ana Reyes');
  await noHorizontalScroll(page);
  await page.click('[data-action="tl.enroll.confirm"]');
  await expect(page.locator('[data-view="tl-record"]')).toBeVisible();
  await expect(page.locator('[data-slot="header"]')).toContainText('Entry');
  // the deadline on the record is the server's value
  const id = await page.evaluate(() => window.Api.call('tl.list', { q: 'reyes', sort: '-entry_date', page_size: 5 }).then((r) => r.find((x) => x.entry_date === '2026-10-19').id));
  const got = await apiFromPage(page, 'tl.get', { id });
  expect(got.data.enrollment.deadline).toBe('2027-01-19');
  await expect(page.locator('[data-field-value="deadline"]')).toContainText('2027-01-19');
});

widthly('text from the server is shown as text, not as markup', async (page) => {
  await openTl(page, 'officer');
  await page.click('[data-slot="enroll"]');
  await fillForm(page, {
    last_name: '<b>Bold</b>', first_name: '<img src=x onerror=window.__hit=1>', mother_location_id: 'LOC-0001', station_id: 'STN-0001', entry_date: '2026-10-19',
  });
  await page.click('[data-slot="save"]');
  await expect(page.locator('[data-view="tl-record"] h1')).toContainText('<b>Bold</b>');
  expect(await page.locator('[data-view="tl-record"] h1 b').count()).toBe(0);
  expect(await page.evaluate(() => window.__hit)).toBeUndefined();
});

widthly('five entry grades move the record to Probationary', async (page) => {
  await openTl(page, 'officer', ID.reyes);
  await expect(page.locator('[data-slot="header"]')).toContainText('Entry');
  await expect(page.locator('[data-slot="entry-grades"] [data-action="tl.recordEntryGrade"]')).toHaveCount(5);
  for (let i = 1; i <= 5; i += 1) {
    await page.locator('[data-slot="entry-grades"] button:has-text("Record")').first().click();
    await fillForm(page, { score: 88, assessed_on: '2026-10-16' });
    await page.click('[data-form="tl.recordEntryGrade"] button[type="submit"]');
    await expect(page.locator('[data-slot="message"]')).toContainText('Grade saved.');
    if (i < 5) {
      await expect(page.locator('[data-slot="entry-grades"] .count').first()).toContainText(i + ' of 5 recorded');
      await expect(page.locator('[data-slot="header"]')).toContainText('Entry');
    }
    await noHorizontalScroll(page);
  }
  await expect(page.locator('[data-slot="header"]')).toContainText('Probationary');
  await expect(page.locator('[data-slot="header"]')).toContainText('88');
});

widthly('a certification check shows the computed final', async (page) => {
  await openTl(page, 'officer', ID.santos);
  await page.click('[data-action="tl.recordCertCheck"]');
  await fillForm(page, { assessed_on: '2026-10-18', checklist: 95, exam: 90, kitchen_feedback: 92, course_program: 95 });
  await page.click('[data-form="tl.recordCertCheck"] button[type="submit"]');
  await expect(page.locator('[data-slot="message"]')).toContainText('computed by the server');
  await expect(page.locator('[data-slot="header"]')).toContainText('Certification check');
  await expect(page.locator('[data-slot="header"]')).toContainText('92.1');
  await expect(page.locator('[data-slot="checks"]')).toContainText('92.1');
  await expect(page.locator('[data-slot="checks"]')).toContainText('Olivia Tester');
});

widthly('certify', async (page) => {
  await openTl(page, 'officer', ID.cruz);
  await page.click('[data-action="tl.certify"]');
  await page.click('[data-form="tl.certify"] button[type="submit"]');
  await expect(page.locator('[data-slot="header"]')).toContainText('Certified');
  await expect(page.locator('[data-action="tl.certify"]')).toHaveCount(0);
});

widthly('extend is refused until Admin sets CFG-047, then works', async (page) => {
  await openTl(page, 'officer', ID.santos);
  await page.click('[data-action="tl.recordCertCheck"]');
  await fillForm(page, { assessed_on: '2026-10-18', checklist: 50, exam: 50, kitchen_feedback: 50, course_program: 95 });
  await page.click('[data-form="tl.recordCertCheck"] button[type="submit"]');
  await expect(page.locator('[data-slot="header"]')).toContainText('Certification check');
  await expect(page.locator('[data-action="tl.certify"]')).toHaveCount(0);
  // The server does not offer Extend while the limit is missing, and a direct call is refused with CONFIG_MISSING.
  await expect(page.locator('[data-action="tl.extend"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="extensions"]')).toContainText('no limit is set yet');
  const rv = (await apiFromPage(page, 'tl.get', { id: ID.santos })).data.enrollment.row_version;
  const refused = await apiFromPage(page, 'tl.extend', { id: ID.santos, row_version: rv, reason: 'x' });
  expect(refused.ok).toBe(false);
  expect(refused.error.code).toBe('CONFIG_MISSING');
  await adminApi(page, 'settings.set', { setting_key: 'CFG-047', value: '2', reason: 'browser test' });
  await nav(page, 'tl');
  await page.click('[data-open="' + ID.santos + '"]');
  await page.click('[data-action="tl.extend"]');
  await fillForm(page, { reason: 'Needs more practice' });
  await page.click('[data-form="tl.extend"] button[type="submit"]');
  await expect(page.locator('[data-slot="header"]')).toContainText('Extended');
  await expect(page.locator('[data-slot="extensions"]')).toContainText('Needs more practice');
  await expect(page.locator('[data-slot="extensions"]')).toContainText('1 used of 2');
});

widthly('quit needs a reason from the list', async (page) => {
  await openTl(page, 'officer', ID.reyes);
  await page.click('[data-action="tl.quit"]');
  await fillForm(page, { quit_date: '2026-10-19' });
  await page.click('[data-form="tl.quit"] button[type="submit"]');
  await expect(page.locator('[data-form="tl.quit"] [data-slot="form-message"]')).toContainText('Check the marked fields');
  await expect(page.locator('[data-slot="header"]')).toContainText('Entry');
  await fillForm(page, { quit_reason_lookup_id: { label: 'Resigned' } });
  await page.click('[data-form="tl.quit"] button[type="submit"]');
  await expect(page.locator('[data-slot="header"]')).toContainText('Quit');
  await expect(page.locator('[data-slot="actions"]')).toContainText('No action is open');
});

widthly('a Supervisor promotes; an officer has no Promote button and a direct call is FORBIDDEN', async (page) => {
  await openTl(page, 'officer', ID.lim);
  await expect(page.locator('[data-action="tl.promote"]')).toHaveCount(0);
  const rv = (await apiFromPage(page, 'tl.get', { id: ID.lim })).data.enrollment.row_version;
  const denied = await apiFromPage(page, 'tl.promote', { id: ID.lim, row_version: rv, promoted_on: '2026-10-20' });
  expect(denied.ok).toBe(false);
  expect(denied.error.code).toBe('FORBIDDEN');
  await page.click('#signout');
  await signInAs(page, 'supervisor');
  await nav(page, 'tl');
  await page.click('[data-open="' + ID.lim + '"]');
  await page.click('[data-action="tl.promote"]');
  await fillForm(page, { promoted_on: '2026-10-20' });
  await page.click('[data-form="tl.promote"] button[type="submit"]');
  await expect(page.locator('[data-slot="header"]')).toContainText('Promoted');
});

widthly('Admin has no Return to probation or Promote button', async (page) => {
  await openTl(page, 'admin', ID.lim);
  await expect(page.locator('[data-action="tl.promote"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="actions"]')).toContainText('No action is open');
  await page.click('[data-nav="tl"]');
  await page.click('[data-open="' + ID.cruz + '"]');
  await expect(page.locator('[data-action="tl.returnToProbation"]')).toHaveCount(0);
  await expect(page.locator('[data-action="tl.certify"]')).toHaveCount(1);
  const rv = (await apiFromPage(page, 'tl.get', { id: ID.cruz })).data.enrollment.row_version;
  const denied = await apiFromPage(page, 'tl.returnToProbation', { id: ID.cruz, row_version: rv, note: 'x' });
  expect(denied.error.code).toBe('FORBIDDEN');
});

widthly('a Supervisor returns a record from Certification check to probation', async (page) => {
  await openTl(page, 'supervisor', ID.cruz);
  await page.click('[data-action="tl.returnToProbation"]');
  await fillForm(page, { note: 'Needs a second visit' });
  await page.click('[data-form="tl.returnToProbation"] button[type="submit"]');
  await expect(page.locator('[data-slot="header"]')).toContainText('Probationary');
});

widthly('a stale action shows "Changed by ..., reload."', async (page) => {
  await openTl(page, 'officer', ID.santos);
  // someone else changes the record after this screen was loaded
  const post = async (body) => (await page.request.post('/api', { data: Object.assign({ v: 1 }, body) })).json();
  const si = await post({ method: 'auth.signIn', params: { employee_id: NUMBERS.supervisor, password: PASSWORD } });
  const rv = (await apiFromPage(page, 'tl.get', { id: ID.santos })).data.enrollment.row_version;
  const upd = await post({ method: 'tl.update', params: { id: ID.santos, row_version: rv, patch: { remarks: 'Moved to the next batch' } }, token: si.data.token });
  expect(upd.ok, JSON.stringify(upd)).toBe(true);
  await page.click('[data-action="tl.quit"]');
  await fillForm(page, { quit_date: '2026-10-19', quit_reason_lookup_id: { label: 'Resigned' } });
  await page.click('[data-form="tl.quit"] button[type="submit"]');
  await expect(page.locator('[data-form="tl.quit"] [data-slot="form-message"]')).toContainText('Changed by Sam Supervisor, reload.');
  await page.click('[data-action="reload"]');
  await expect(page.locator('[data-slot="header"]')).toContainText('Moved to the next batch');
  await expect(page.locator('[data-slot="header"]')).toContainText('Probationary');
});

widthly('the list filters overdue records and shows them in red', async (page) => {
  await openTl(page, 'manager');
  await expect(page.locator('[data-view="tl-list"] tbody tr')).toHaveCount(9);
  await page.check('[data-slot="filters"] [name="overdue"]');
  await expect(page.locator('[data-view="tl-list"] tbody tr')).toHaveCount(1);
  const row = page.locator('[data-view="tl-list"] tbody tr').first();
  await expect(row).toContainText('Hector Villanueva');
  await expect(row).toContainText('Overdue');
  await expect(row).toHaveClass(/overdue/);
  expect(await row.locator('td').first().evaluate((td) => getComputedStyle(td).color)).toBe('rgb(179, 50, 42)');
  await page.uncheck('[data-slot="filters"] [name="overdue"]');
  await page.selectOption('[data-slot="filters"] [name="status"]', 'Certified');
  await expect(page.locator('[data-view="tl-list"] tbody tr')).toHaveCount(1);
  await expect(page.locator('[data-view="tl-list"] tbody tr').first()).toContainText('Dino Lim');
  await page.selectOption('[data-slot="filters"] [name="status"]', '');
  await page.fill('[data-slot="filters"] [name="q"]', 'santos');
  await expect(page.locator('[data-view="tl-list"] tbody tr')).toHaveCount(1);
  await expect(page.locator('[data-view="tl-list"] tbody tr').first()).toContainText('Ben Santos');
});

widthly('a correction is a new row with its reason, and the old row stays in the History', async (page) => {
  await openTl(page, 'officer', ID.santos);
  await page.click('[data-tab="history"]');
  const timeline = page.locator('[data-slot="timeline"]');
  await expect(timeline).toContainText('Typed 80, the sheet says 88');
  await expect(timeline).toContainText('ISTV 88');
  await expect(timeline).toContainText('ISTV 80');
  await expect(timeline.locator('li.corrected')).toHaveCount(1);
  // a new correction through the screen adds a third row; nothing is removed
  await page.click('[data-tab="record"]');
  await page.locator('[data-slot="entry-grades"] button:has-text("Correct")').first().click();
  await fillForm(page, { score: 90, assessed_on: '2026-09-13', correction_reason: 'Re-marked' });
  await page.click('[data-form="tl.recordEntryGrade"] button[type="submit"]');
  await expect(page.locator('[data-slot="message"]')).toContainText('Correction saved');
  await page.click('[data-tab="history"]');
  await expect(timeline).toContainText('Re-marked');
  await expect(timeline).toContainText('ISTV 80');
  await expect(timeline).toContainText('ISTV 88');
  await expect(timeline.locator('li.corrected')).toHaveCount(2);
});

widthly('a certification check is corrected with a reason and the final is recomputed', async (page) => {
  await openTl(page, 'supervisor', ID.cruz);
  const before = await apiFromPage(page, 'tl.get', { id: ID.cruz });
  const oldFinal = before.data.attempts[0].final_grade;
  const oldChecklist = before.data.attempts[0].scores.checklist;
  await page.click('[data-action="tl.recordCertCheck"]');
  // the form is the correction form: it asks for a reason
  await expect(page.locator('[data-form="tl.recordCertCheck"]')).toContainText('Correct the certification check');
  // the reason is required
  await fillForm(page, { checklist: 80 });
  await page.click('[data-form="tl.recordCertCheck"] button[type="submit"]');
  await expect(page.locator('[data-form="tl.recordCertCheck"] [data-slot="form-message"]')).toContainText('Check the marked fields');
  await fillForm(page, { correction_reason: 'Checklist re-marked by the supervisor' });
  await page.click('[data-form="tl.recordCertCheck"] button[type="submit"]');
  await expect(page.locator('[data-slot="message"]')).toContainText('Correction saved. The final grade was recomputed by the server.');
  // the server recomputed the final and kept the old row
  const after = await apiFromPage(page, 'tl.get', { id: ID.cruz });
  expect(after.data.attempts[0].scores.checklist).toBe(80);
  expect(after.data.attempts[0].final_grade).not.toBe(oldFinal);
  expect(after.data.attempts[0].corrections).toBeGreaterThan(0);
  expect(oldChecklist).not.toBe(80);
  await expect(page.locator('[data-slot="checks"]')).toContainText('80');
  await page.click('[data-tab="history"]');
  await expect(page.locator('[data-slot="timeline"]')).toContainText('Checklist re-marked by the supervisor');
});
