// Does the app actually save anything?
//
// Every other test in this repo stubs the storage layer, which is the right
// call for unit tests and means none of them would notice if the seam between
// the reducer, the storage adapter and the browser came apart. The unit tests
// for src/storage/storage.ts prove each branch in isolation; this proves the
// whole chain — form, reducer, adapter, localStorage, reload, rehydrate —
// against the bundle that ships.
//
// It is deliberately one test. A single honest end-to-end path is worth more
// than a suite of them re-asserting what the unit tests already cover, and
// slow browser tests that duplicate fast ones get deleted eventually.

import { test, expect } from '@playwright/test';

// No keyword in it, so the auto-categoriser cannot quietly pick a category and
// make the explicit selection below look like it worked when it did not.
const MERCHANT = 'E2E Ledger Check';
const AMOUNT = '42.50';

test('a transaction survives a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');

  // A fresh browser profile: nothing has been saved, so the month total is
  // zero. This is the baseline the assertions below are measured against.
  const spent = page.getByText(/SPENT THIS MONTH/i).locator('..');
  await expect(spent).toContainText('$0.00');

  // Dismissing the form is not a save. The toast used to hang off the close
  // handler, which fires on Cancel, the X and Escape as well — so abandoning
  // the form congratulated you on adding a transaction that was never written.
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  // Read once, deliberately, rather than with a retrying matcher. Toasts clear
  // themselves after a few seconds, and `expect(...).toBeEmpty()` retries for
  // five — so it waits out the very message it is supposed to catch and passes.
  // Asserting on the live region rather than on wording, because a message-text
  // check only catches a regression that reuses the same words.
  await page.waitForTimeout(250); // long enough for a toast to have rendered
  expect((await page.getByRole('status').innerText()).trim()).toBe('');
  await expect(spent).toContainText('$0.00');

  await page.getByRole('button', { name: 'Add transaction' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // By label, not by placeholder or CSS class. These labels were not wired to
  // their inputs until recently; querying through them keeps that fixed.
  await dialog.getByLabel('Amount').fill(AMOUNT);
  await dialog.getByLabel('Merchant / Description').fill(MERCHANT);
  await dialog.getByLabel('Category').selectOption('dining_out');
  await dialog.getByRole('button', { name: 'Add Transaction' }).click();

  await expect(dialog).toBeHidden();

  // …and a real save does announce itself, naming what was added.
  await expect(page.getByRole('status')).toContainText(MERCHANT);

  // The dashboard total is derived, not stored, so this also covers the
  // reducer having actually taken the transaction.
  await expect(spent).toContainText(`$${AMOUNT}`);

  // The real assertion. Everything above could pass with an app that never
  // writes anything; only a reload can tell the difference.
  await page.reload();

  await expect(spent).toContainText(`$${AMOUNT}`);
  await page.getByRole('button', { name: 'Everyday' }).click();
  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await expect(page.getByText(MERCHANT)).toBeVisible();

  expect(errors, `console errors during the run: ${errors.join(' | ')}`).toEqual([]);
});
