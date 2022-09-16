import { chromium } from 'playwright'; // stealth plugin needs no outdated playwright-extra
import path from 'path';
import { dirs, jsonDb, datetime, stealth } from './util.js';

const debug = process.env.PWDEBUG == '1'; // runs non-headless and opens https://playwright.dev/docs/inspector

const URL_CLAIM = 'https://store.epicgames.com/en-US/free-games';
const URL_LOGIN = 'https://www.epicgames.com/id/login?lang=en-US&noHostRedirect=true&redirectUrl=' + URL_CLAIM;
const TIMEOUT = 20 * 1000; // 20s, default is 30s
const SCREEN_WIDTH = Number(process.env.SCREEN_WIDTH) - 80 || 1280;
const SCREEN_HEIGHT = Number(process.env.SCREEN_HEIGHT) || 1280;

const db = await jsonDb('epic-games.json');
db.data ||= { claimed: [], runs: [] };
const run = {
  startTime: datetime(),
  endTime: null,
  n: null, // unclaimed games at beginning
  c: 0,    // claimed games at end
};

// https://playwright.dev/docs/auth#multi-factor-authentication
const context = await chromium.launchPersistentContext(dirs.browser, {
  // chrome will not work in linux arm64, only chromium
  // channel: 'chrome', // https://playwright.dev/docs/browsers#google-chrome--microsoft-edge
  headless: false,
  viewport: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.83 Safari/537.36', // see replace of Headless in util.newStealthContext. TODO update if browser is updated!
  locale: "en-US", // ignore OS locale to be sure to have english text for locators
  // recordVideo: { dir: 'data/videos/' }, // will record a .webm video for each page navigated
  args: [ // https://peter.sh/experiments/chromium-command-line-switches
    // don't want to see bubble 'Restore pages? Chrome didn't shut down correctly.'
    // '--restore-last-session', // does not apply for crash/killed
    '--hide-crash-restore-bubble',
  ],
  ignoreDefaultArgs: ['--enable-automation'], // remove default arg that shows the info bar with 'Chrome is being controlled by automated test software.'
});

// Without stealth plugin, the website shows an hcaptcha on login with username/password and in the last step of claiming a game. It may have other heuristics like unsuccessful logins as well. After <6h (TBD) it resets to no captcha again. Getting a new IP also resets.
// stealth with playwright: https://github.com/berstend/puppeteer-extra/issues/454#issuecomment-917437212
// https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth/evasions
await stealth(context);

if (!debug) context.setDefaultTimeout(TIMEOUT);

const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist
console.debug('userAgent:', await page.evaluate(() => navigator.userAgent));

try {
  await page.goto(URL_CLAIM, { waitUntil: 'networkidle' }); // 'domcontentloaded' faster than default 'load' https://playwright.dev/docs/api/class-page#page-goto - changed to 'networkidle' temporarily due to race https://github.com/vogler/free-games-claimer/issues/25
  // Accept cookies to get rid of banner to save space on screen. Will only appear for a fresh context, so we don't await, but let it time out if it does not exist and catch the exception. clickIfExists by checking selector's count > 0 did not work.
  page.click('button:has-text("Accept All Cookies")').catch(_ => {}); // _ => console.info('Cookies already accepted')
  while (await page.locator('a[role="button"]:has-text("Sign In")').count() > 0) { // TODO also check alternative for signed-in state
    console.error("Not signed in anymore. Please login and then navigate to the 'Free Games' page. If using docker, open http://localhost:6080");
    context.setDefaultTimeout(0); // give user time to log in without timeout
    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
    // after login it just reloads the login page...
    await page.waitForNavigation({ url: URL_CLAIM });
    context.setDefaultTimeout(TIMEOUT);
    // process.exit(1);
  }
  console.log('Signed in.');
  // click on each banner with 'Free Now'. TODO just extract the URLs and go to them in the loop
  const game_sel = 'span:text-is("Free Now")';
  await page.waitForSelector(game_sel);
  // const games = await page.$$(game_sel); // 'Element is not attached to the DOM' after navigation; had `for (const game of games) { await game.click(); ... }
  const n = run.n = await page.locator(game_sel).count();
  console.log('Number of free games:', n);
  for (let i = 0; i < n; i++) {
    await page.locator(game_sel).nth(i).click(); // navigates to page for game
    const btnText = await page.locator('//button[@data-testid="purchase-cta-button"][not(contains(.,"Loading"))]').first().innerText(); // barrier to block until page is loaded
    // click Continue if 'This game contains mature content recommended only for ages 18+'
    if (await page.locator('button:has-text("Continue")').count() > 0) {
      console.log('This game contains mature content recommended only for ages 18+');
      await page.click('button:has-text("Continue")');
    }
    const title = await page.locator('h1 div').first().innerText();
    console.log('Current free game:', title);
    const title_url = page.url().split('/').pop();
    const p = path.resolve(dirs.screenshots, 'epic-games', `${title_url}.png`);
    await page.screenshot({ path: p, fullPage: false }); // fullPage is quite long...
    if (btnText.toLowerCase() == 'in library') {
      console.log('Already in library! Nothing to claim.');
    } else { // GET
      console.log('Not in library yet! Click GET.');
      await page.click('[data-testid="purchase-cta-button"]');
      // click Continue if 'Device not supported. This product is not compatible with your current device.'
      await Promise.any(['button:has-text("Continue")', '#webPurchaseContainer iframe'].map(s => page.waitForSelector(s))); // wait for Continue xor iframe
      if (await page.locator('button:has-text("Continue")').count() > 0) {
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
        await Promise.any([btnAgree.waitFor().then(() => btnAgree.click()), page.waitForSelector('text=Thank you for buying').then(_ => { })]); // EU: wait for agree button, non-EU: potentially done
        // TODO check for hcaptcha - the following is even true when no captcha is shown...
        // if (await iframe.frameLocator('#talon_frame_checkout_free_prod').locator('text=Please complete a security check to continue').count() > 0) {
        //   console.error('Encountered hcaptcha. Giving up :(');
        //   await page.pause();
        //   process.exit(1);
        // }
        // await page.waitForTimeout(3000);
        await page.waitForSelector('text=Thank you for buying'); // EU: wait, non-EU: wait again
        db.data.claimed.push({ title, time: datetime(), url: page.url() });
        run.c++;
        console.log('Claimed successfully!');
      } catch (e) {
        console.log(e);
        const p = path.resolve(dirs.screenshots, 'epic-games', `${datetime().replaceAll(':', '.')}.png`);
        await page.screenshot({ path: p, fullPage: true });
        console.info('Saved a screenshot of hcaptcha challenge to', p);
        console.error('Got hcaptcha challenge. To avoid it, get a link from https://www.hcaptcha.com/accessibility'); // TODO save this link in config and visit it daily to set accessibility cookie to avoid captcha challenge?
      }
      // await page.pause();
    }
    if (i < n-1) { // no need to go back if it's the last game
      await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(game_sel);
    }
  }
} catch(error) {
  console.error(error);
  run.error = error.toString();
} finally {
  // write out json db
  run.endTime = datetime();
  db.data.runs.push(run);
  await db.write();

  // await context.waitForEvent("close");
  await context.close();
}
