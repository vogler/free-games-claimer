const { existsSync } = require('fs');
if (!existsSync('auth.json')) {
  console.error('Missing auth.json! Run `npm login` to login and create this file by closing the opened browser.');
}

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
  });
  // https://github.com/berstend/puppeteer-extra/issues/454#issuecomment-917437212
  const originalUserAgent = await (await (await browser.newContext()).newPage()).evaluate(() => { return navigator.userAgent });
  console.log(originalUserAgent);
  const context = await browser.newContext({
    storageState: 'auth.json',
    viewport: { width: 1280, height: 1280 },
    userAgent: originalUserAgent.replace("Headless", ""),
  });
  const enabledEvasions = [
    'chrome.app',
    'chrome.csi',
    'chrome.loadTimes',
    'chrome.runtime',
    'iframe.contentWindow',
    'media.codecs',
    'navigator.hardwareConcurrency',
    'navigator.languages',
    'navigator.permissions',
    'navigator.plugins',
    'navigator.webdriver',
    'sourceurl',
    // 'user-agent-override', // doesn't work since playwright has no page.browser()
    'webgl.vendor',
    'window.outerdimensions'
  ];
  const evasions = enabledEvasions.map(e => new require(`puppeteer-extra-plugin-stealth/evasions/${e}`));
  const stealth = {
      callbacks: [],
      async evaluateOnNewDocument(...args) {
          this.callbacks.push({ cb: args[0], a: args[1] })
      }
  }
  evasions.forEach(e => e().onPageCreated(stealth));
  for (let evasion of stealth.callbacks) {
      await context.addInitScript(evasion.cb, evasion.a);
  }

  const page = await context.newPage();
  await page.goto('https://www.epicgames.com/store/en-US/free-games');
  // await expect(page.locator('a[role="button"]:has-text("Sign In")')).toHaveCount(0);
  await page.click('button:has-text("Accept All Cookies")'); // to not waste screen space in --debug
  await page.click('[data-testid="offer-card-image-landscape"]');
  // TODO check if already claimed
  const game = await page.locator('h1 div').first().innerText();
  console.log('Current free game:', game);
  // click Continue if 'This game contains mature content recommended only for ages 18+'
  if (await page.locator(':has-text("Continue")').count() > 0) {
    console.log('This game contains mature content recommended only for ages 18+');
    await page.click('button:has-text("Continue")');
  }
  await page.click('[data-testid="purchase-cta-button"]');
  await page.click('button:has-text("Continue")');
  // it then creates an iframe for the rest
  // await page.frame({ url: /.*store\/purchase.*/ }).click('button:has-text("Place Order")'); // not found because it does not wait for iframe
  const iframe = page.frameLocator('.webPurchaseContainer iframe')
  await iframe.locator('button:has-text("Place Order")').click();
  await iframe.locator('button:has-text("I Agree")').click();
  await page.pause();
  await context.close();
  await browser.close();
})();
