import { expect, test, type Page } from '@playwright/test';
import { SECTION_IDS, SECTION_NAMES } from '../../src/domain/design.ts';

const answer = {
  requirements: 'Admit vehicles only when a matching spot is available.',
  responsibilities: 'ParkingLot coordinates entry. Spot owns occupancy. PricingPolicy calculates fees.',
  interactions: 'Entry reserves a matching spot before issuing a ticket. Exit pays before releasing it.',
  edgeCases: 'Test full capacity, duplicate entry, failed payment, and repeated exit.',
  tradeOffs: 'Separate pricing from allocation to support a new pricing policy without changing entry.',
};

async function start(page: Page) {
  await page.goto('/');
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Parking Lot', exact: true }) });
  await card.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByLabel(SECTION_NAMES.requirements, { exact: true })).toBeVisible();
}

async function fill(page: Page, requirements = answer.requirements) {
  for (const section of SECTION_IDS) {
    await page
      .getByLabel(SECTION_NAMES[section], { exact: true })
      .fill(section === 'requirements' ? requirements : answer[section]);
  }
}

test('collection renders all problems, declares simulated feedback, and protects private paths', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Good design starts/ })).toBeVisible();
  for (const title of ['Parking Lot', 'Vending Machine', 'Library Management'])
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByText('Feedback is simulated. No AI quota is used.', { exact: false })).toBeVisible();
  expect((await request.get('/.env')).status()).toBe(404);
  expect((await request.get('/api/not-a-route')).headers()['content-type']).toContain('application/json');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'outputs/ui-problems.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('draft saving, history filtering, resuming and page reload preserve all five answers', async ({
  page,
}) => {
  await start(page);
  await fill(page);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved/ })).toBeVisible();
  const url = page.url();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'History' })
    .click();
  await page.getByLabel('Filter by problem').selectOption('parking-lot');
  await page.locator('.history-row').first().getByRole('button', { name: 'Resume draft' }).click();
  await expect(page).toHaveURL(url);
  await page.reload();
  for (const section of SECTION_IDS)
    await expect(page.getByLabel(SECTION_NAMES[section], { exact: true })).toHaveValue(answer[section]);
  await page.getByText('What your feedback covers', { exact: false }).click();
  await expect(page.getByText('Requirements coverage', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector('.problem-panel')?.scrollTo(0, 0);
  });
  await page.screenshot({ path: 'outputs/ui-practice.png', fullPage: true });
});

test('local validation blocks empty and over-budget submission while allowing an over-budget draft save', async ({
  page,
}) => {
  let submissions = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/submit')) submissions++;
  });
  await start(page);
  await page.getByRole('button', { name: 'Submit for feedback' }).click();
  await expect(page.getByRole('alert')).toContainText('Complete all five sections');
  await expect(page.getByLabel(SECTION_NAMES.requirements, { exact: true })).toBeFocused();
  await fill(page, 'x'.repeat(6001));
  await expect(page.getByRole('button', { name: 'Submit for feedback' })).toBeDisabled();
  await expect(page.getByText(/Shorten your answer to 6,000 characters/)).toBeVisible();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved/ })).toBeVisible();
  expect(submissions).toBe(0);
});

test('submitting unsaved edits saves them, shows feedback, and creates an independent prefilled revision', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await start(page);
  await fill(page);
  const originalUrl = page.url();
  await page.getByRole('button', { name: 'Submit for feedback' }).click();
  await expect(page.getByText(/Your design is in the queue|Looking through your design/)).toBeVisible();
  await expect(page.locator('.assessment')).toHaveCount(5);
  await expect(page.locator('.assessment').first()).toContainText('Strong');
  await expect(page.locator('.assessment blockquote').first()).toContainText(answer.requirements);
  await expect(page.getByRole('heading', { name: 'Where to go from here' })).toBeVisible();
  await expect(page.getByLabel(SECTION_NAMES.requirements, { exact: true })).toHaveJSProperty(
    'readOnly',
    true,
  );
  await page.screenshot({ path: 'outputs/ui-feedback.png', fullPage: true });
  await page.getByRole('button', { name: 'Revise design' }).click();
  await expect(page).not.toHaveURL(originalUrl);
  for (const section of SECTION_IDS)
    await expect(page.getByLabel(SECTION_NAMES[section], { exact: true })).toHaveValue(answer[section]);
  await expect(page.getByLabel(SECTION_NAMES.requirements, { exact: true })).toHaveJSProperty(
    'readOnly',
    false,
  );
  await page.getByRole('link', { name: 'View the original attempt' }).click();
  await expect(page).toHaveURL(originalUrl);
  await expect(page.getByLabel(SECTION_NAMES.requirements, { exact: true })).toHaveValue(answer.requirements);
  expect(errors).toEqual([]);
});

test('failed evaluations retry manually and keep both runs on the same submission', async ({
  page,
  request,
}) => {
  await start(page);
  await fill(page, answer.requirements + ' [preview-failure]');
  const attemptId = decodeURIComponent(page.url().split('/practice/')[1]!);
  await page.getByRole('button', { name: 'Submit for feedback' }).click();
  await expect(page.getByRole('button', { name: 'Retry evaluation' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry evaluation' }).click();
  await expect(page.locator('.assessment')).toHaveCount(5);
  const details = (await (await request.get(`/api/attempts/${attemptId}`)).json()).data;
  expect(details.evaluations).toHaveLength(2);
  expect(details.evaluations.map((run: { status: string }) => run.status)).toEqual(['failed', 'completed']);
  expect(details.evaluations[0].submissionId).toBe(details.evaluations[1].submissionId);
  await page.getByLabel('Evaluation run', { exact: true }).selectOption(details.evaluations[0].id);
  await expect(page.getByText('This is an earlier run.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry evaluation' })).toHaveCount(0);
});

test('a stale save keeps local text and offers an explicit reload of the saved draft', async ({
  page,
  request,
}) => {
  await start(page);
  const attemptId = decodeURIComponent(page.url().split('/practice/')[1]!);
  await request.patch(`/api/attempts/${attemptId}/draft`, {
    data: { expectedRevision: 0, patch: { requirements: 'Saved from another tab.' } },
  });
  await page
    .getByLabel(SECTION_NAMES.requirements, { exact: true })
    .fill('My local edits are still valuable.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Reload');
  await expect(page.getByLabel(SECTION_NAMES.requirements, { exact: true })).toHaveValue(
    'My local edits are still valuable.',
  );
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Reload saved attempt' }).click();
  await expect(page.getByLabel(SECTION_NAMES.requirements, { exact: true })).toHaveValue(
    'Saved from another tab.',
  );
});

test('a polling failure can be retried without submitting or evaluating again', async ({ page, request }) => {
  await start(page);
  await fill(page);
  const attemptId = decodeURIComponent(page.url().split('/practice/')[1]!);
  await page.route('**/api/evaluations/*', (route) =>
    route.request().method() === 'GET' ? route.abort() : route.continue(),
  );
  await page.getByRole('button', { name: 'Submit for feedback' }).click();
  await expect(page.getByRole('button', { name: 'Check status again' })).toBeVisible();
  await page.unroute('**/api/evaluations/*');
  await page.getByRole('button', { name: 'Check status again' }).click();
  await expect(page.locator('.assessment')).toHaveCount(5);
  expect((await (await request.get(`/api/attempts/${attemptId}`)).json()).data.evaluations).toHaveLength(1);
});

test('unsaved navigation can be cancelled without losing text', async ({ page }) => {
  await start(page);
  const url = page.url();
  await page.getByLabel(SECTION_NAMES.requirements, { exact: true }).fill('Keep these unsaved thoughts.');
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'History' })
    .click();
  await expect(page).toHaveURL(url);
  await expect(page.getByLabel(SECTION_NAMES.requirements, { exact: true })).toHaveValue(
    'Keep these unsaved thoughts.',
  );
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved/ })).toBeVisible();
});

test('mobile collection, editor and history fit the viewport and remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Parking Lot', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'outputs/ui-mobile.png', fullPage: true });
  await start(page);
  await fill(page);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'History' })
    .click();
  await expect(page.getByRole('heading', { name: /Every attempt is a step forward/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
