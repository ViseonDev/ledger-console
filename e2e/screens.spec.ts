import { expect, test } from '@playwright/test';

test('badges fixture data in the header', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('fixture-badge')).toBeVisible();
  await expect(page.getByTestId('account-row').first()).toBeVisible();
});

test('shows a drifted cache as not matching the journal', async ({ page }) => {
  await page.goto(`/accounts/${encodeURIComponent('liabilities:customer:wallet:cus_demo_0904')}`);

  await expect(page.getByTestId('balances')).toHaveAttribute('data-state', 'unchecked');
  await page.getByTestId('check-balance').click();

  await expect(page.getByTestId('differs')).toContainText('€12.34 higher');
});

test('shows a balance above 2^53 to the cent', async ({ page }) => {
  await page.goto(`/accounts/${encodeURIComponent('liabilities:customer:wallet:cus_demo_0905')}`);

  await expect(page.getByTestId('cached-balance')).toHaveText('€90,071,992,547,409.93');
});

test('opens a transaction from the journal and shows it balanced', async ({ page }) => {
  await page.goto(`/accounts/${encodeURIComponent('liabilities:customer:wallet:cus_demo_0903')}`);

  await page.getByTestId('journal-row').first().getByRole('link').click();

  await expect(page).toHaveURL(/\/transactions\//);
  await expect(page.getByTestId('balanced')).toBeVisible();
});

test('falls back to lookup by code when there is no account list', async ({ page }) => {
  // what ledger-core does: POST-only route, so GET is a 405
  await page.route('**/v1/accounts?*', (route) => route.fulfill({ status: 405, body: '' }));
  await page.route('**/v1/payments?*', (route) => route.fulfill({ status: 404, body: '404 page not found' }));

  await page.goto('/');
  await expect(page.getByText('no account list endpoint')).toBeVisible();

  await page.getByLabel('Account code').fill('assets:cash:operating');
  await page.getByRole('button', { name: 'Open' }).click();

  await expect(page.getByRole('heading', { name: 'assets:cash:operating' })).toBeVisible();
});
