import { test, expect } from '@playwright/test'; // only npm dep needed for this file
import { existsSync } from 'fs';

if (!existsSync('auth.json')) {
  console.error('Missing auth.json! Use `npm run login` to login and create this file by closing the opened browser.');
}
test.use({
  storageState: 'auth.json',
  viewport: { width: 1280, height: 1280 },
});

test('claim game', async ({ page }) => {
  await page.goto('https://www.epicgames.com/store/en-US/free-games');
  await expect(page.locator('a[role="button"]:has-text("Sign In")')).toHaveCount(0);
  await page.click('button:has-text("Accept All Cookies")'); // to not waste screen space in --debug
  await page.click('[data-testid="offer-card-image-landscape"]');
  // TODO check if already claimed
  await page.click('[data-testid="purchase-cta-button"]');
  await page.click('button:has-text("Continue")');
  // it then creates an iframe for the rest
  // await page.frame({ url: /.*store\/purchase.*/ }).click('button:has-text("Place Order")'); // not found because it does not wait for iframe
  const iframe = page.frameLocator('.webPurchaseContainer iframe')
  await iframe.locator('button:has-text("Place Order")').click();
  await iframe.locator('button:has-text("I Agree")').click();
  await page.pause();
});
