const { existsSync } = require('fs');
if (!existsSync('auth.json')) {
  console.error('Missing auth.json! Run `npm login` to login and create this file by closing the opened browser.');
}

// npm i playwright playwright-extra@next @extra/recaptcha@next
const { chromium } = require('playwright-extra')

// add recaptcha plugin and provide it your 2captcha token (= their apiKey)
// Please note: You need to add funds to your 2captcha account for this to work
// https://2captcha.com?from=13225256
const RecaptchaPlugin = require('@extra/recaptcha')
const RecaptchaOptions = {
  visualFeedback: true, // colorize reCAPTCHAs (violet = detected, green = solved)
  provider: {
    id: '2captcha',
    token: process.env.API_KEY, // put your API_KEY=... in .env
  },
}
chromium.use(RecaptchaPlugin(RecaptchaOptions));

(async () => {
  const browser = await chromium.launch({
    headless: false,
    executablePath: 'node_modules/puppeteer/.local-chromium/mac-938248/chrome-mac/Chromium.app/Contents/MacOS/Chromium', // why does it fail without?
  });
  const context = await browser.newContext({
    storageState: 'auth.json',
    viewport: { width: 1280, height: 1280 },
  });
  const page = await context.newPage();
  await page.goto('https://www.epicgames.com/store/en-US/free-games');
  // await expect(page.locator('a[role="button"]:has-text("Sign In")')).toHaveCount(0);
  await page.click('#onetrust-accept-btn-handler'); // accept cookies to not waste screen space
  await page.click('[data-testid="offer-card-image-landscape"]');
  // TODO check if already claimed
  await page.click('[data-testid="purchase-cta-button"]');
  await page.click('div[data-component=makePlatformUnsupportedWarningStep] > button');
  // it then creates an iframe for the rest
  // await page.frame({ url: /.*store\/purchase.*/ }).click('button:has-text("Place Order")'); // not found because it does not wait for iframe
  const iframe = page.frameLocator('.webPurchaseContainer iframe')
  await iframe.locator('button:has-text("Place Order")').click();
  await iframe.locator('button:has-text("I Agree")').click();
  await page.solveRecaptchas();
  await page.pause();
  await context.close();
  await browser.close();
})();
