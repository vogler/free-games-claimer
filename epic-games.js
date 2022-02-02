//@ts-check
const { chromium } = require('playwright'); // stealth plugin needs no outdated playwright-extra
const path = require('path');
const debug = process.env.PWDEBUG == '1'; // runs non-headless and opens https://playwright.dev/docs/inspector

const URL_LOGIN = 'https://www.epicgames.com/login';
const URL_CLAIM = 'https://www.epicgames.com/store/en-US/free-games';
const TIMEOUT = 20 * 1000; // 20s, default is 30s

// could change to .mjs to get top-level-await, but would then also need to change require to import and dynamic import for stealth below would just add more async/await
(async () => {
  // https://playwright.dev/docs/auth#multi-factor-authentication
  const context = await chromium.launchPersistentContext(path.resolve(__dirname, 'userDataDir'), {
    channel: 'chrome', // https://playwright.dev/docs/browsers#google-chrome--microsoft-edge
    headless: false,
    viewport: { width: 1280, height: 1280 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36', // see replace of Headless in util.newStealthContext. TODO update if browser is updated!
    args: [ // don't want to see bubble 'Restore pages? Chrome didn't shut down correctly.', but flags below don't work.
      '--disable-session-crashed-bubble',
      '--restore-last-session',
    ],
  });

  // Without stealth plugin, the website shows an hcaptcha on login with username/password and in the last step of claiming a game. It may have other heuristics like unsuccessful logins as well. After <6h (TBD) it resets to no captcha again. Getting a new IP also resets.
  // stealth with playwright: https://github.com/berstend/puppeteer-extra/issues/454#issuecomment-917437212
  // https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth/evasions
  const enabledEvasions = [
    'chrome.app',
    'chrome.csi',
    'chrome.loadTimes',
    'chrome.runtime',
    // 'defaultArgs',
    'iframe.contentWindow',
    'media.codecs',
    'navigator.hardwareConcurrency',
    'navigator.languages',
    'navigator.permissions',
    'navigator.plugins',
    // 'navigator.vendor',
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
  // end stealth setup

  if (!debug) context.setDefaultTimeout(TIMEOUT);
  const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist
  console.log('userAgent:', await page.evaluate(() => navigator.userAgent));

  const clickIfExists = async selector => {
    if (await page.locator(selector).count() > 0)
      await page.click(selector);
  };

  await page.goto(URL_CLAIM, {waitUntil: 'domcontentloaded'}); // default 'load' takes forever
  // with persistent context the cookie message will only show up the first time, so we can't unconditionally wait for it - try to catch it or let the user click it.
  await clickIfExists('button:has-text("Accept All Cookies")'); // to not waste screen space in --debug
  while (await page.locator('a[role="button"]:has-text("Sign In")').count() > 0) { // TODO also check alternative for signed-in state
    console.error("Not signed in anymore. Please login and then navigate to the 'Free Games' page.");
    context.setDefaultTimeout(0); // give user time to log in without timeout
    await page.goto(URL_LOGIN, {waitUntil: 'domcontentloaded'});
    // after login it just reloads the login page...
    await page.waitForNavigation({url: URL_CLAIM});
    context.setDefaultTimeout(TIMEOUT);
    // process.exit(1);
  }
  console.log('Signed in.');
  // click on each banner with 'Free Now'. TODO just extract the URLs and go to them in the loop
  const game_sel = 'div[data-component="FreeOfferCard"]:has-text("Free Now")';
  await page.waitForSelector(game_sel);
  // const games = await page.$$(game_sel); // 'Element is not attached to the DOM' after navigation; had `for (const game of games) { await game.click(); ... }
  const n = await page.locator(game_sel).count();
  console.log('Number of free games:', n);
  for (let i=1; i<=n; i++) {
    await page.click(`:nth-match(${game_sel}, ${i})`);
    const title = await page.locator('h1 div').first().innerText();
    console.log('Current free game:', title);
    // click Continue if 'This game contains mature content recommended only for ages 18+'
    if (await page.locator(':has-text("Continue")').count() > 0) {
      console.log('This game contains mature content recommended only for ages 18+');
      await page.click('button:has-text("Continue")');
    }
    const btnText = await page.locator('[data-testid="purchase-cta-button"]').innerText();
    if (btnText.toLowerCase() == 'in library') {
      console.log('Already in library! Nothing to claim.');
    } else {
      console.log('Not in library yet! Click GET.')
      await page.click('[data-testid="purchase-cta-button"]');
      // click Continue if 'Device not supported. This product is not compatible with your current device.'
      // @ts-ignore https://caniuse.com/?search=promise.any
      await Promise.any([':has-text("Continue")', '#webPurchaseContainer iframe'].map(s => page.waitForSelector(s))); // wait for Continue xor iframe
      if (await page.locator(':has-text("Continue")').count() > 0) {
        console.log('Device not supported. This product is not compatible with your current device.');
        await page.click('button:has-text("Continue")');
      }
      // it then creates an iframe for the rest
      // await page.frame({ url: /.*store\/purchase.*/ }).click('button:has-text("Place Order")'); // not found because it does not wait for iframe
      const iframe = page.frameLocator('#webPurchaseContainer iframe')
      await iframe.locator('button:has-text("Place Order")').click();
      // await page.pause();
      await iframe.locator('button:has-text("I Agree")').click();
      // This is true even when there is no captcha challenge shown! That was the reason why old.stealth.js worked - it did not have this check... TODO check for hcaptcha
      // if (await iframe.frameLocator('#talon_frame_checkout_free_prod').locator('text=Please complete a security check to continue').count() > 0) {
      //   console.error('Encountered hcaptcha. Giving up :(');
      //   await page.pause();
      //   process.exit(1);
      // }
      // await page.waitForTimeout(3000);
      try {
        await page.waitForSelector('text=Thank you for buying');
        console.log('Claimed successfully!');
      } catch (e) {
        console.log(e);
        const p = `screenshots/${new Date().toISOString()}.png`;
        await page.screenshot({ path: p, fullPage: true })
        console.info('Saved a screenshot of hcaptcha challenge to', p);
        console.error('Got hcaptcha challenge. To avoid it, get a link from https://www.hcaptcha.com/accessibility'); // TODO save this link in config and visit it daily to set accessibility cookie to avoid captcha challenge?
      }
      // await page.pause();
    }
    if (i<n) { // no need to go back if it's the last game
      await page.goto(URL_CLAIM, {waitUntil: 'domcontentloaded'});
      await page.waitForSelector(game_sel);
    }
  }
  // await context.waitForEvent("close");
  await context.close();
})();
