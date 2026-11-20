import { expect, test, type Locator, type Page } from '@playwright/test';

// Virtualisation and polling are browser questions: jsdom has no layout, so
// a component test would render every row and prove nothing.

const account = (ref: string) => `/accounts/${encodeURIComponent(`liabilities:customer:wallet:${ref}`)}`;

const LARGE = account('cus_demo_0901'); // 10,000 entries
const BUSY = account('cus_demo_0902'); // 450
const QUIET = account('cus_demo_0903'); // 3, never written to

async function count(locator: Locator): Promise<number> {
  return Number((await locator.innerText()).replace(/\D/g, ''));
}

/** The entry at the top edge of the journal viewport. */
function topVisibleEntry(page: Page): Promise<string | null> {
  return page.getByTestId('journal-scroll').evaluate((scroller) => {
    const box = scroller.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + 20, box.top + 5);
    return hit?.closest('[data-entry-id]')?.getAttribute('data-entry-id') ?? null;
  });
}

test('keeps the DOM small with ten thousand entries loaded', async ({ page }) => {
  await page.goto(`${LARGE}?buffer=12000&page=500`);

  await expect.poll(() => count(page.getByTestId('journal-count')), { timeout: 30_000 }).toBe(10_000);

  // 520px at 40px a row is 13, plus 8 overscan each side
  expect(await page.getByTestId('journal-row').count()).toBeLessThan(40);
});

test('scrolls through ten thousand rows without the node count growing', async ({ page }) => {
  await page.goto(`${LARGE}?buffer=12000&page=500`);
  await expect.poll(() => count(page.getByTestId('journal-count')), { timeout: 30_000 }).toBe(10_000);

  const scroller = page.getByTestId('journal-scroll');
  const before = await page.getByTestId('journal-row').count();

  for (let i = 0; i < 20; i += 1) {
    await scroller.evaluate((el) => el.scrollBy(0, 20_000));
    await page.waitForTimeout(20);
  }

  const after = await page.getByTestId('journal-row').count();
  expect(after).toBeLessThan(40);
  expect(Math.abs(after - before)).toBeLessThan(10);

  // and it really did get somewhere
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(300_000);
});

test('holds the reader in place when the buffer trims', async ({ page }) => {
  // Hold every request after the first until we've scrolled, so the trim
  // happens while someone is "reading" mid-list.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));

  await page.route('**/entries?*', async (route) => {
    if (new URL(route.request().url()).searchParams.has('after')) await gate;
    await route.continue();
  });

  await page.goto(`${BUSY}?buffer=300&page=200`);
  await expect.poll(() => count(page.getByTestId('journal-count'))).toBe(200);

  // row 180 at the top: well into the list, not at the bottom
  await page.getByTestId('journal-scroll').evaluate((el) => el.scrollTo(0, 180 * 40));
  await page.waitForTimeout(100);
  const anchor = await topVisibleEntry(page);
  expect(anchor).not.toBeNull();

  release();

  // 450 entries through a 300 buffer drops the oldest 150
  await expect(page.getByTestId('discarded')).toContainText('150 older entries');
  await expect.poll(() => count(page.getByTestId('journal-count'))).toBe(300);

  expect(await topVisibleEntry(page)).toBe(anchor);
});

test('polls at the configured interval and no faster', async ({ page }) => {
  // a timer restarted on every render still gets the data right, so count requests
  const requests: number[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/entries')) requests.push(Date.now());
  });

  await page.goto(`${QUIET}?interval=500`);
  await expect(page.getByTestId('journal-scroll')).toBeVisible();
  await page.waitForTimeout(5_000);

  // ~10 expected; the bug produces an order of magnitude more
  expect(requests.length).toBeGreaterThan(5);
  expect(requests.length).toBeLessThan(20);
});

test('sends a new cursor on each request and never repeats one with new data', async ({ page }) => {
  const cursors: (string | null)[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/entries')) cursors.push(new URL(request.url()).searchParams.get('after'));
  });

  await page.goto(`${BUSY}?page=100&interval=250`);
  await expect.poll(() => count(page.getByTestId('journal-count'))).toBe(450);

  // first request has no cursor; the catch-up ones each move it forward
  expect(cursors[0]).toBeNull();
  const advancing = cursors.slice(1, 5).map(Number);
  expect(advancing).toEqual([...advancing].sort((a, b) => a - b));
  expect(new Set(advancing).size).toBe(4);
});
