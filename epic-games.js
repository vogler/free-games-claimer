import { chromium } from 'playwright'; // stealth plugin needs no outdated playwright-extra
import path from 'path';
import { dirs, jsonDb, datetime, stealth, filenamify } from './util.js';
import { existsSync, writeFileSync } from 'fs';

const debug = process.env.PWDEBUG == '1'; // runs non-headless and opens https://playwright.dev/docs/inspector

const URL_CLAIM = 'https://store.epicgames.com/en-US/free-games';
const URL_LOGIN = 'https://www.epicgames.com/id/login?lang=en-US&noHostRedirect=true&redirectUrl=' + URL_CLAIM;
const TIMEOUT = 20 * 1000; // 20s, default is 30s
const SCREEN_WIDTH = Number(process.env.SCREEN_WIDTH) - 80 || 1280;
const SCREEN_HEIGHT = Number(process.env.SCREEN_HEIGHT) || 1280;

const db = await jsonDb('epic-games.json');
const migrateDb = (user) => {
  if (user in db.data || !('claimed' in db.data)) return;
  db.data[user] = {};
  for (const e of db.data.claimed) {
    const k = e.url.split('/').pop();
    db.data[user][k] = e;
  }
  delete db.data.claimed;
  delete db.data.runs;
}

// https://www.nopecha.com extension source from https://github.com/NopeCHA/NopeCHA/releases/tag/0.1.16
const ext = path.resolve('nopecha');

// https://playwright.dev/docs/auth#multi-factor-authentication
const context = await chromium.launchPersistentContext(dirs.browser, {
  // chrome will not work in linux arm64, only chromium
  // channel: 'chrome', // https://playwright.dev/docs/browsers#google-chrome--microsoft-edge
  headless: false,
  viewport: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.83 Safari/537.36', // see replace of Headless in util.newStealthContext. TODO Windows UA enough to avoid 'device not supported'? update if browser is updated?
  locale: "en-US", // ignore OS locale to be sure to have english text for locators
  // recordVideo: { dir: 'data/videos/' }, // will record a .webm video for each page navigated
  args: [ // https://peter.sh/experiments/chromium-command-line-switches
    // don't want to see bubble 'Restore pages? Chrome didn't shut down correctly.'
    // '--restore-last-session', // does not apply for crash/killed
    '--hide-crash-restore-bubble',
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
  ],
  ignoreDefaultArgs: ['--enable-automation'], // remove default arg that shows the info bar with 'Chrome is being controlled by automated test software.'
});

// Without stealth plugin, the website shows an hcaptcha on login with username/password and in the last step of claiming a game. It may have other heuristics like unsuccessful logins as well. After <6h (TBD) it resets to no captcha again. Getting a new IP also resets.
await stealth(context);

if (!debug) context.setDefaultTimeout(TIMEOUT);

const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist
// console.debug('userAgent:', await page.evaluate(() => navigator.userAgent));

try {
  await context.addCookies([{name: 'OptanonAlertBoxClosed', value: '2022-10-06T21:15:28.081Z', domain: '.epicgames.com', path: '/'}]);

  await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' }); // 'domcontentloaded' faster than default 'load' https://playwright.dev/docs/api/class-page#page-goto

  // Accept cookies to get rid of banner to save space on screen. Clicking this did not always work since the message was animated in too slowly.
  // page.click('button:has-text("Accept All Cookies")').catch(_ => { }); // not needed anymore since we set the cookie above

  while (await page.locator('a[role="button"]:has-text("Sign In")').count() > 0) { // TODO also check alternative for signed-in state
    console.error("Not signed in anymore. Please login and then navigate to the 'Free Games' page. If using docker, open http://localhost:6080");
    context.setDefaultTimeout(0); // give user time to log in without timeout
    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
    // after login it just reloads the login page...
    await page.waitForNavigation({ url: URL_CLAIM });
    context.setDefaultTimeout(TIMEOUT);
    // process.exit(1);
  }
  const user = await page.locator('#user span').first().innerHTML();
  console.log(`Signed in as ${user}`);
  migrateDb(user); // TODO remove this after some time since it will run fine without and people can still use this commit to adjust their data epic-games.json
  db.data[user] ||= {};

  // Detect free games
  const game_loc = await page.locator('a:has(span:text-is("Free Now"))');
  await game_loc.last().waitFor();
  // clicking on `game_sel` sometimes led to a 404, see https://github.com/vogler/free-games-claimer/issues/25
  // debug showed that in those cases the href was still correct, so we `goto` the urls instead of clicking.
  // Alternative: parse the json loaded to build the page https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions
    // filter data.Catalog.searchStore.elements for .promotions.promotionalOffers being set and build URL with .catalogNs.mappings[0].pageSlug or .urlSlug if not set to some wrong id like it was the case for spirit-of-the-north-f58a66 - this is also what's done here: https://github.com/claabs/epicgames-freegames-node/blob/938a9653ffd08b8284ea32cf01ac8727d25c5d4c/src/puppet/free-games.ts#L138-L213
  const urlSlugs = await Promise.all((await game_loc.elementHandles()).map(a => a.getAttribute('href')));
  const urls = urlSlugs.map(s => 'https://store.epicgames.com' + s);
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
    const game_id = page.url().split('/').pop();
    db.data[user][game_id] ||= { title, time: datetime(), url: page.url() }; // this will be set on the initial run only!
    console.log('Current free game:', title);

    if (btnText.toLowerCase() == 'in library') {
      console.log('  Already in library! Nothing to claim.');
      db.data[user][game_id].status ||= 'existed'; // does not overwrite claimed or failed
      if (db.data[user][game_id].status == 'failed') db.data[user][game_id].status = 'manual'; // was failed but now it's claimed
    } else { // GET
      console.log('  Not in library yet! Click GET.');
      await page.click('[data-testid="purchase-cta-button"]');

      // click Continue if 'Device not supported. This product is not compatible with your current device.' - avoided by Windows userAgent?
      // page.click('button:has-text("Continue")').catch(_ => { });

      if (process.env.DRYRUN) continue;
      if (debug) await page.pause();

      // it then creates an iframe for the purchase
      const iframe = page.frameLocator('#webPurchaseContainer iframe');
      await iframe.locator('button:has-text("Place Order")').click();

      // I Agree button is only shown for EU accounts! https://github.com/vogler/free-games-claimer/pull/7#issuecomment-1038964872
      const btnAgree = iframe.locator('button:has-text("I Agree")');
      try {
        context.setDefaultTimeout(100 * 1000); // give time to solve captcha, iframe goes blank after 60s?
        await Promise.any([btnAgree.click(), page.waitForSelector('text=Thank you for buying').then(_ => { })]); // EU: wait for agree button, non-EU: potentially done

        const captcha = iframe.locator('#h_captcha_challenge_checkout_free_prod iframe');
        await captcha.waitFor().then(async () => {
          console.info('  Got hcaptcha challenge! NopeCHA extension will likely solve it.')
          // await page.waitForTimeout(2000);
          // const p = path.resolve(dirs.screenshots, 'epic-games', 'captcha', `${filenamify(datetime())}.png`);
          // await captcha.screenshot({ path: p });
          // console.info('  Saved a screenshot of hcaptcha challenge to', p);
          // console.error('  Got hcaptcha challenge. To avoid it, get a link from https://www.hcaptcha.com/accessibility'); // TODO save this link in config and visit it daily to set accessibility cookie to avoid captcha challenge?
        });

        await page.waitForSelector('text=Thank you for buying'); // EU: wait, non-EU: wait again = no-op
        db.data[user][game_id].status = 'claimed';
        db.data[user][game_id].time = datetime(); // claimed time overwrites failed time
        console.log('  Claimed successfully!');
        context.setDefaultTimeout(TIMEOUT);
      } catch (e) {
        console.log(e);
        console.error('  Failed to claim! Try again if NopeCHA timed out. Click the extension to see if you ran out of credits (refill after 24h). To avoid captchas try to get a new IP or set a cookie from https://www.hcaptcha.com/accessibility');
        const p = path.resolve(dirs.screenshots, 'epic-games', 'failed', `${game_id}_${filenamify(datetime())}.png`);
        await page.screenshot({ path: p, fullPage: true });
        db.data[user][game_id].status = 'failed';
      }

      const p = path.resolve(dirs.screenshots, 'epic-games', `${game_id}.png`);
      if (!existsSync(p)) await page.screenshot({ path: p, fullPage: false }); // fullPage is quite long...
    }
  }
} catch (error) {
  console.error(error); // .toString()?
} finally {
  await db.write(); // write out json db
}
await writeFileSync(path.resolve(dirs.browser, 'cookies.json'), JSON.stringify(await context.cookies()));
await context.close();
