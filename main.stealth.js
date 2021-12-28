//@ts-check
const { existsSync } = require('fs');
if (!existsSync('auth.json')) {
  console.error('Missing auth.json! Run `npm login` to login and create this file by closing the opened browser.');
  process.exit(1);
}

const debug = process.env.PWDEBUG == '1'; // runs headful and opens https://playwright.dev/docs/inspector

const { chromium } = require('playwright'); // stealth plugin needs no outdated playwright-extra

// stealth with playwright: https://github.com/berstend/puppeteer-extra/issues/454#issuecomment-917437212
const newStealthContext = async (browser, contextOptions = {}) => {
  const dummyContext = await browser.newContext();
  const originalUserAgent = await (await dummyContext.newPage()).evaluate(() => navigator.userAgent);
  await dummyContext.close();
  if (debug) console.log('userAgent:', originalUserAgent); // Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/96.0.4664.110 Safari/537.36
  const context = await browser.newContext({
    ...contextOptions,
    userAgent: originalUserAgent.replace("Headless", ""), // HeadlessChrome -> Chrome, TODO needed?
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
  const evasions = enabledEvasions.map(e => require(`puppeteer-extra-plugin-stealth/evasions/${e}`));
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
  return context;
};

// could change to .mjs to get top-level-await, but would then also need to change require to import and dynamic import for stealth below would just add more async/await
(async () => {
  const browser = await chromium.launch({
    channel: 'chrome', // https://playwright.dev/docs/browsers#google-chrome--microsoft-edge
  });
  /** @type {import('playwright').BrowserContext} */
  const context = await newStealthContext(browser, {
    storageState: 'auth.json',
    viewport: { width: 1280, height: 1280 },
  });
  if (!debug) context.setDefaultTimeout(10000);
  const page = await context.newPage();
  await page.goto('https://www.epicgames.com/store/en-US/free-games');
  await page.click('button:has-text("Accept All Cookies")'); // to not waste screen space in --debug
  if (await page.locator('a[role="button"]:has-text("Sign In")').count() > 0) {
    console.error('Not signed in anymore. Run `npm login` to login again.');
    process.exit(1);
  }
  // click on banner to go to current free game. TODO what if there are multiple games?
  await page.click('[data-testid="offer-card-image-landscape"]');
  const game = await page.locator('h1 div').first().innerText();
  console.log('Current free game:', game);
  const btnText = await page.locator('[data-testid="purchase-cta-button"]').innerText();
  if (btnText.toLowerCase() == 'in library') {
    console.log('Already in library! Nothing to claim.');
  } else {
    await page.click('[data-testid="purchase-cta-button"]');
    await page.click('button:has-text("Continue")');
    // it then creates an iframe for the rest
    // await page.frame({ url: /.*store\/purchase.*/ }).click('button:has-text("Place Order")'); // not found because it does not wait for iframe
    const iframe = page.frameLocator('#webPurchaseContainer iframe')
    await iframe.locator('button:has-text("Place Order")').click();
    await iframe.locator('button:has-text("I Agree")').click();
    // await iframe.locator('button.payment-purchase-close').click();
    console.log(await page.locator('[data-testid="purchase-cta-button"]').innerText());
    await page.pause();
    // await context.waitForEvent("close");
  }
  await context.close();
  await browser.close();
})();
