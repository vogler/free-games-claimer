import { chromium } from 'playwright'; // stealth plugin needs no outdated playwright-extra
import path from 'path';
import { dirs, jsonDb, datetime, stealth, filenamify } from './util.js';
import { existsSync } from 'fs';

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
await stealth(context);

if (!debug) context.setDefaultTimeout(TIMEOUT);

const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist
console.debug('userAgent:', await page.evaluate(() => navigator.userAgent));

try {
  await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' }); // 'domcontentloaded' faster than default 'load' https://playwright.dev/docs/api/class-page#page-goto

  // Accept cookies to get rid of banner to save space on screen. Will only appear for a fresh context, so we don't await, but let it time out if it does not exist and catch the exception. clickIfExists by checking selector's count > 0 did not work.
  page.click('button:has-text("Accept All Cookies")').catch(_ => { }); // _ => console.info('Cookies already accepted')

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

  // Detect free games
  const game_loc = await page.locator('a:has(span:text-is("Free Now"))');
  await game_loc.last().waitFor();
  // clicking on `game_sel` sometimes led to a 404, see https://github.com/vogler/free-games-claimer/issues/25
  // debug showed that in those cases the href was still correct, so we `goto` the urls instead of clicking.
  // Alternative: parse the json loaded to build the page https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions
    // filter data.Catalog.searchStore.elements for .promotions.promotionalOffers being set and build URL with .catalogNs.mappings[0].pageSlug or .urlSlug if not set to some wrong id like it was the case for spirit-of-the-north-f58a66 - this is also what's done here: https://github.com/claabs/epicgames-freegames-node/blob/938a9653ffd08b8284ea32cf01ac8727d25c5d4c/src/puppet/free-games.ts#L138-L213
  const urlSlugs = await Promise.all((await game_loc.elementHandles()).map(a => a.getAttribute('href')));
  const urls = urlSlugs.map(s => 'https://store.epicgames.com' + s);
  const n = run.n = await game_loc.count();
  // console.log('Number of free games:', n);
  console.log('Free games:', urls);

  for (const url of urls) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const btnText = await page.locator('//button[@data-testid="purchase-cta-button"][not(contains(.,"Loading"))]').first().innerText(); // barrier to block until page is loaded

    // click Continue if 'This game contains mature content recommended only for ages 18+'
    if (await page.locator('button:has-text("Continue")').count() > 0) {
      console.log('This game contains mature content recommended only for ages 18+');
      await page.click('button:has-text("Continue")');
    }

    const title = await page.locator('h1 div').first().innerText();
    const title_url = page.url().split('/').pop();
    console.log('Current free game:', title, title_url);

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

      if (process.env.DRYRUN) continue;
      if (debug) await page.pause();

      // it then creates an iframe for the purchase
      const iframe = page.frameLocator('#webPurchaseContainer iframe');
      await iframe.locator('button:has-text("Place Order")').click();

      // I Agree button is only shown for EU accounts! https://github.com/vogler/free-games-claimer/pull/7#issuecomment-1038964872
      const btnAgree = iframe.locator('button:has-text("I Agree")');
      try {
        await Promise.any([btnAgree.waitFor().then(() => btnAgree.click()), page.waitForSelector('text=Thank you for buying').then(_ => { })]); // EU: wait for agree button, non-EU: potentially done

        // TODO check for hcaptcha - the following is even true when no captcha challenge is shown...
        // if (await iframe.frameLocator('#talon_frame_checkout_free_prod').locator('text=Please complete a security check to continue').count() > 0) {
        //   console.error('Encountered hcaptcha. Giving up :(');
        // }

        await page.waitForSelector('text=Thank you for buying'); // EU: wait, non-EU: wait again = no-op
        db.data.claimed.push({ title, time: datetime(), url: page.url() });
        run.c++;
        console.log('Claimed successfully!');
      } catch (e) {
        console.log(e);
        const p = path.resolve(dirs.screenshots, 'epic-games', 'captcha', `${filenamify(datetime())}.png`);
        await page.screenshot({ path: p, fullPage: true });
        console.info('Saved a screenshot of hcaptcha challenge to', p);
        console.error('Got hcaptcha challenge. To avoid it, get a link from https://www.hcaptcha.com/accessibility'); // TODO save this link in config and visit it daily to set accessibility cookie to avoid captcha challenge?
      }

      const p = path.resolve(dirs.screenshots, 'epic-games', `${title_url}.png`);
      if (!existsSync(p)) await page.screenshot({ path: p, fullPage: false }); // fullPage is quite long...
    }
  }
} catch (error) {
  console.error(error);
  run.error = error.toString();
} finally {
  // write out json db
  run.endTime = datetime();
  db.data.runs.push(run);
  await db.write();
}
await context.close();
