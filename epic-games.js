import { chromium } from 'playwright'; // stealth plugin needs no outdated playwright-extra
import path from 'path';
import { __dirname, stealth } from './util.js';
const debug = process.env.PWDEBUG == '1'; // runs non-headless and opens https://playwright.dev/docs/inspector

const URL_CLAIM = 'https://store.epicgames.com/en-US/free-games';
const URL_LOGIN = 'https://www.epicgames.com/id/login?lang=en-US&noHostRedirect=true&redirectUrl=' + URL_CLAIM;
const TIMEOUT = 20 * 1000; // 20s, default is 30s
const SCREEN_WIDTH = Number(process.env.SCREEN_WIDTH) || 1280;
const SCREEN_HEIGHT = Number(process.env.SCREEN_HEIGHT) || 1280;

// https://playwright.dev/docs/auth#multi-factor-authentication
const context = await chromium.launchPersistentContext(path.resolve(__dirname, 'userDataDir'), {
  // chrome will not work in linux arm64, only chromium
  // channel: 'chrome', // https://playwright.dev/docs/browsers#google-chrome--microsoft-edge
  headless: false,
  viewport: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.83 Safari/537.36', // see replace of Headless in util.newStealthContext. TODO update if browser is updated!
  locale: "en-US", // ignore OS locale to be sure to have english text for locators
  args: [ // don't want to see bubble 'Restore pages? Chrome didn't shut down correctly.', but flags below don't work.
    '--disable-session-crashed-bubble',
    '--restore-last-session',
  ],
});

// Without stealth plugin, the website shows an hcaptcha on login with username/password and in the last step of claiming a game. It may have other heuristics like unsuccessful logins as well. After <6h (TBD) it resets to no captcha again. Getting a new IP also resets.
// stealth with playwright: https://github.com/berstend/puppeteer-extra/issues/454#issuecomment-917437212
// https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth/evasions
await stealth(context);

if (!debug) context.setDefaultTimeout(TIMEOUT);

const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist
console.log('userAgent:', await page.evaluate(() => navigator.userAgent));

const clickIfExists = async selector => {
  if (await page.locator(selector).count() > 0)
    await page.click(selector);
};

await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' }); // default 'load' takes forever
// with persistent context the cookie message will only show up the first time, so we can't unconditionally wait for it - try to catch it or let the user click it.
await clickIfExists('button:has-text("Accept All Cookies")'); // to not waste screen space in --debug
while (await page.locator('a[role="button"]:has-text("Sign In")').count() > 0) { // TODO also check alternative for signed-in state
  console.error("Not signed in anymore. Please login and then navigate to the 'Free Games' page.");
  context.setDefaultTimeout(0); // give user time to log in without timeout
  await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
  // after login it just reloads the login page...
  await page.waitForNavigation({ url: URL_CLAIM });
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
for (let i = 1; i <= n; i++) {
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
    await Promise.any([':has-text("Continue")', '#webPurchaseContainer iframe'].map(s => page.waitForSelector(s))); // wait for Continue xor iframe
    if (await page.locator(':has-text("Continue")').count() > 0) {
      // console.log('Device not supported. This product is not compatible with your current device.');
      await page.click('button:has-text("Continue")');
    }
    // it then creates an iframe for the rest
    // await page.frame({ url: /.*store\/purchase.*/ }).click('button:has-text("Place Order")'); // not found because it does not wait for iframe
    const iframe = page.frameLocator('#webPurchaseContainer iframe')
    await iframe.locator('button:has-text("Place Order")').click();
    // await page.pause();
    // I Agree button is only shown for EU accounts! https://github.com/vogler/free-games-claimer/pull/7#issuecomment-1038964872
    const btnAgree = iframe.locator('button:has-text("I Agree")');
    try {
      await Promise.any([btnAgree.waitFor(), page.waitForSelector('text=Thank you for buying')]); // EU: wait for agree button, non-EU: potentially done
      // await clickIfExists('button:has-text("I Agree")', iframe); // default arg: FrameLocator is incompatible with Page and even Locator...
      if (await btnAgree.count() > 0)
        await btnAgree.click();
      // TODO check for hcaptcha - the following is even true when no captcha is shown...
      // if (await iframe.frameLocator('#talon_frame_checkout_free_prod').locator('text=Please complete a security check to continue').count() > 0) {
      //   console.error('Encountered hcaptcha. Giving up :(');
      //   await page.pause();
      //   process.exit(1);
      // }
      // await page.waitForTimeout(3000);
      await page.waitForSelector('text=Thank you for buying'); // EU: wait, non-EU: wait again
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
  if (i < n) { // no need to go back if it's the last game
    await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(game_sel);
  }
}
// await context.waitForEvent("close");
await context.close();
