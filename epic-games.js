import { firefox } from 'playwright-firefox'; // stealth plugin needs no outdated playwright-extra
import { authenticator } from 'otplib';
import path from 'path';
import { existsSync, writeFileSync } from 'fs';
import { resolve, jsonDb, datetime, stealth, filenamify, prompt, notify, html_game_list, handleSIGINT } from './util.js';
import { cfg } from './config.js';

const screenshot = (...a) => resolve(cfg.dir.screenshots, 'epic-games', ...a);

const URL_CLAIM = 'https://store.epicgames.com/en-US/free-games';
const URL_LOGIN = 'https://www.epicgames.com/id/login?lang=en-US&noHostRedirect=true&redirectUrl=' + URL_CLAIM;

console.log(datetime(), 'started checking epic-games');

const db = await jsonDb('epic-games.json', {});

handleSIGINT();

if (cfg.time) console.time('startup');

// https://www.nopecha.com extension source from https://github.com/NopeCHA/NopeCHA/releases/tag/0.1.16
// const ext = path.resolve('nopecha'); // used in Chromium, currently not needed in Firefox

// https://playwright.dev/docs/auth#multi-factor-authentication
const context = await firefox.launchPersistentContext(cfg.dir.browser, {
  // chrome will not work in linux arm64, only chromium
  // channel: 'chrome', // https://playwright.dev/docs/browsers#google-chrome--microsoft-edge
  headless: cfg.headless,
  viewport: { width: cfg.width, height: cfg.height },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.83 Safari/537.36', // see replace of Headless in util.newStealthContext. TODO Windows UA enough to avoid 'device not supported'? update if browser is updated?
  // userAgent firefox (macOS): Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:106.0) Gecko/20100101 Firefox/106.0
  // userAgent firefox (docker): Mozilla/5.0 (X11; Linux aarch64; rv:109.0) Gecko/20100101 Firefox/115.0
  locale: "en-US", // ignore OS locale to be sure to have english text for locators
  recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined, // will record a .webm video for each page navigated; without size, video would be scaled down to fit 800x800
  recordHar: cfg.record ? { path: `data/record/eg-${datetime()}.har` } : undefined, // will record a HAR file with network requests and responses; can be imported in Chrome devtools
  args: [ // https://peter.sh/experiments/chromium-command-line-switches
    // don't want to see bubble 'Restore pages? Chrome didn't shut down correctly.'
    // '--restore-last-session', // does not apply for crash/killed
    '--hide-crash-restore-bubble',
    // `--disable-extensions-except=${ext}`,
    // `--load-extension=${ext}`,
  ],
  // ignoreDefaultArgs: ['--enable-automation'], // remove default arg that shows the info bar with 'Chrome is being controlled by automated test software.'. Since Chromeium 106 this leads to show another info bar with 'You are using an unsupported command-line flag: --no-sandbox. Stability and security will suffer.'.
});

// Without stealth plugin, the website shows an hcaptcha on login with username/password and in the last step of claiming a game. It may have other heuristics like unsuccessful logins as well. After <6h (TBD) it resets to no captcha again. Getting a new IP also resets.
await stealth(context);

if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);

const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist
// console.debug('userAgent:', await page.evaluate(() => navigator.userAgent));
if (cfg.debug) console.debug(await page.evaluate(() => window.screen));
if (cfg.record && cfg.debug) {
  // const filter = _ => true;
  const filter = r => r.url().includes('store.epicgames.com');
  page.on('request', request => filter(request) && console.log('>>', request.method(), request.url()));
  page.on('response', response => filter(response) && console.log('<<', response.status(), response.url()));
}

const notify_games = [];
let user;

try {
  await context.addCookies([{name: 'OptanonAlertBoxClosed', value: new Date(Date.now() - 5*24*60*60*1000).toISOString(), domain: '.epicgames.com', path: '/'}]); // Accept cookies to get rid of banner to save space on screen. Set accept time to 5 days ago.

  await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' }); // 'domcontentloaded' faster than default 'load' https://playwright.dev/docs/api/class-page#page-goto

  if (cfg.time) console.timeEnd('startup');
  if (cfg.time) console.time('login');

  // page.click('button:has-text("Accept All Cookies")').catch(_ => { }); // Not needed anymore since we set the cookie above. Clicking this did not always work since the message was animated in too slowly.

  while (await page.locator('a[role="button"]:has-text("Sign In")').count() > 0) {
    console.error('Not signed in anymore. Please login in the browser or here in the terminal.');
    if (cfg.novnc_port) console.info(`Open http://localhost:${cfg.novnc_port} to login inside the docker container.`);
    if (!cfg.debug) context.setDefaultTimeout(cfg.login_timeout); // give user some extra time to log in
    console.info(`Login timeout is ${cfg.login_timeout/1000} seconds!`);
    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
    if (cfg.eg_email && cfg.eg_password) console.info('Using email and password from environment.');
    else console.info('Press ESC to skip the prompts if you want to login in the browser (not possible in headless mode).');
    const email = cfg.eg_email || await prompt({message: 'Enter email'});
    const password = email && (cfg.eg_password || await prompt({type: 'password', message: 'Enter password'}));
    if (email && password) {
      await page.click('text=Sign in with Epic Games');
      await page.fill('#email', email);
      await page.fill('#password', password);
      await page.click('button[type="submit"]');
      page.waitForSelector('#h_captcha_challenge_login_prod iframe').then(async () => {
        console.error('Got a captcha during login (likely due to too many attempts)! You may solve it in the browser, get a new IP or try again in a few hours.');
        await notify('epic-games: got captcha during login. Please check.');
      }).catch(_ => { });
      page.waitForSelector('h6:has-text("Incorrect response.")').then(async () => {
        console.error('Incorrect repsonse for captcha!')
      }).catch(_ => { });
      // handle MFA, but don't await it
      page.waitForURL('**/id/login/mfa**').then(async () => {
        console.log('Enter the security code to continue - This appears to be a new device, browser or location. A security code has been sent to your email address at ...');
        // TODO locator for text (email or app?)
        const otp = cfg.eg_otpkey && authenticator.generate(cfg.eg_otpkey) || await prompt({type: 'text', message: 'Enter two-factor sign in code', validate: n => n.toString().length == 6 || 'The code must be 6 digits!'}); // can't use type: 'number' since it strips away leading zeros and codes sometimes have them
        await page.type('input[name="code-input-0"]', otp.toString());
        await page.click('button[type="submit"]');
      }).catch(_ => { });
    } else {
      console.log('Waiting for you to login in the browser.');
      await notify('epic-games: no longer signed in and not enough options set for automatic login.');
      if (cfg.headless) {
        console.log('Run `SHOW=1 node epic-games` to login in the opened browser.');
        await context.close(); // finishes potential recording
        process.exit(1);
      }
    }
    await page.waitForURL(URL_CLAIM);
    if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);
  }
  user = await page.locator('#user span').first().innerHTML();
  console.log(`Signed in as ${user}`);
  db.data[user] ||= {};
  if (cfg.time) console.timeEnd('login');
  if (cfg.time) console.time('claim all games');

  // Detect free games
  const game_loc = page.locator('a:has(span:text-is("Free Now"))');
  await game_loc.last().waitFor();
  // clicking on `game_sel` sometimes led to a 404, see https://github.com/vogler/free-games-claimer/issues/25
  // debug showed that in those cases the href was still correct, so we `goto` the urls instead of clicking.
  // Alternative: parse the json loaded to build the page https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions
    // filter data.Catalog.searchStore.elements for .promotions.promotionalOffers being set and build URL with .catalogNs.mappings[0].pageSlug or .urlSlug if not set to some wrong id like it was the case for spirit-of-the-north-f58a66 - this is also what's done here: https://github.com/claabs/epicgames-freegames-node/blob/938a9653ffd08b8284ea32cf01ac8727d25c5d4c/src/puppet/free-games.ts#L138-L213
  const urlSlugs = await Promise.all((await game_loc.elementHandles()).map(a => a.getAttribute('href')));
  const urls = urlSlugs.map(s => 'https://store.epicgames.com' + s);
  console.log('Free games:', urls);

  for (const url of urls) {
    if (cfg.time) console.time('claim game');
    await page.goto(url); // , { waitUntil: 'domcontentloaded' });
    const btnText = await page.locator('//button[@data-testid="purchase-cta-button"][not(contains(.,"Loading"))]').first().innerText(); // barrier to block until page is loaded

    // click Continue if 'This game contains mature content recommended only for ages 18+'
    if (await page.locator('button:has-text("Continue")').count() > 0) {
      console.log('  This game contains mature content recommended only for ages 18+');
      await page.click('button:has-text("Continue")', { delay: 111 });
      await page.waitForTimeout(2000);
    }

    const title = await page.locator('h1').first().innerText();
    const game_id = page.url().split('/').pop();
    db.data[user][game_id] ||= { title, time: datetime(), url: page.url() }; // this will be set on the initial run only!
    console.log('Current free game:', title);
    const notify_game = { title, url, status: 'failed' };
    notify_games.push(notify_game); // status is updated below

    if (btnText.toLowerCase() == 'in library') {
      console.log('  Already in library! Nothing to claim.');
      notify_game.status = 'existed';
      db.data[user][game_id].status ||= 'existed'; // does not overwrite claimed or failed
      if (db.data[user][game_id].status.startsWith('failed')) db.data[user][game_id].status = 'manual'; // was failed but now it's claimed
    } else if (btnText.toLowerCase() == 'requires base game') {
      console.log('  Requires base game! Nothing to claim.');
      notify_game.status = 'requires base game';
      db.data[user][game_id].status ||= 'failed:requires-base-game';
      // TODO claim base game if it is free
      const baseUrl = 'https://store.epicgames.com' + await page.locator('a:has-text("Overview")').getAttribute('href');
      console.log('  Base game:', baseUrl);
      // await page.click('a:has-text("Overview")');
    } else { // GET
      console.log('  Not in library yet! Click GET.');
      await page.click('[data-testid="purchase-cta-button"]', { delay: 11 }); // got stuck here without delay (or mouse move), see #75, 1ms was also enough

      // click Continue if 'Device not supported. This product is not compatible with your current device.' - avoided by Windows userAgent?
      page.click('button:has-text("Continue")').catch(_ => { }); // needed since change from Chromium to Firefox?

      // click 'Yes, buy now' if 'This edition contains something you already have. Still interested?'
      page.click('button:has-text("Yes, buy now")').catch(_ => { });

      // Accept End User License Agreement (only needed once)
      page.locator('input#agree').waitFor().then(async () => {
        console.log('Accept End User License Agreement (only needed once)');
        await page.locator('input#agree').check();
        await page.locator('button:has-text("Accept")').click();
      }).catch(_ => { });

      // it then creates an iframe for the purchase
      await page.waitForSelector('#webPurchaseContainer iframe'); // TODO needed?
      const iframe = page.frameLocator('#webPurchaseContainer iframe');
      // skip game if unavailable in region, https://github.com/vogler/free-games-claimer/issues/46 TODO check games for account's region
      if (await iframe.locator(':has-text("unavailable in your region")').count() > 0) {
        console.error('  This product is unavailable in your region!');
        db.data[user][game_id].status = notify_game.status = 'unavailable-in-region';
        if (cfg.time) console.timeEnd('claim game');
        continue;
      }

      iframe.locator('.payment-pin-code').waitFor().then(async () => {
        if (!cfg.eg_parentalpin) {
          console.error('  EG_PARENTALPIN not set. Need to enter Parental Control PIN manually.');
          notify('epic-games: EG_PARENTALPIN not set. Need to enter Parental Control PIN manually.');
        }
        await iframe.locator('input.payment-pin-code__input').first().type(cfg.eg_parentalpin);
        await iframe.locator('button:has-text("Continue")').click({ delay: 11 });
      }).catch(_ => { });

      if (cfg.debug) await page.pause();
      if (cfg.dryrun) {
        console.log('  DRYRUN=1 -> Skip order!');
        notify_game.status = 'skipped';
        if (cfg.time) console.timeEnd('claim game');
        continue;
      }

      // Playwright clicked before button was ready to handle event, https://github.com/vogler/free-games-claimer/issues/84#issuecomment-1474346591
      await iframe.locator('button:has-text("Place Order"):not(:has(.payment-loading--loading))').click({ delay: 11 });

      // I Agree button is only shown for EU accounts! https://github.com/vogler/free-games-claimer/pull/7#issuecomment-1038964872
      const btnAgree = iframe.locator('button:has-text("I Agree")');
      btnAgree.waitFor().then(() => btnAgree.click()).catch(_ => { }); // EU: wait for and click 'I Agree'
      try {
        // context.setDefaultTimeout(100 * 1000); // give time to solve captcha, iframe goes blank after 60s?
        const captcha = iframe.locator('#h_captcha_challenge_checkout_free_prod iframe');
        captcha.waitFor().then(async () => { // don't await, since element may not be shown
          // console.info('  Got hcaptcha challenge! NopeCHA extension will likely solve it.')
          console.error('  Got hcaptcha challenge! Lost trust due to too many login attempts? You can solve the captcha in the browser or get a new IP address.')
          await notify('epic-games: got captcha challenge right before claim. Use VNC to solve it manually.')
          // await page.waitForTimeout(2000);
          // const p = path.resolve(cfg.dir.screenshots, 'epic-games', 'captcha', `${filenamify(datetime())}.png`);
          // await captcha.screenshot({ path: p });
          // console.info('  Saved a screenshot of hcaptcha challenge to', p);
          // console.error('  Got hcaptcha challenge. To avoid it, get a link from https://www.hcaptcha.com/accessibility'); // TODO save this link in config and visit it daily to set accessibility cookie to avoid captcha challenge?
        }).catch(_ => { }); // may time out if not shown
        await page.waitForSelector('text=Thanks for your order!');
        db.data[user][game_id].status = 'claimed';
        db.data[user][game_id].time = datetime(); // claimed time overwrites failed/dryrun time
        console.log('  Claimed successfully!');
        // context.setDefaultTimeout(cfg.timeout);
      } catch (e) {
        console.log(e);
        // console.error('  Failed to claim! Try again if NopeCHA timed out. Click the extension to see if you ran out of credits (refill after 24h). To avoid captchas try to get a new IP or set a cookie from https://www.hcaptcha.com/accessibility');
        console.error('  Failed to claim! To avoid captchas try to get a new IP address.');
        const p = screenshot('failed', `${game_id}_${filenamify(datetime())}.png`);
        await page.screenshot({ path: p, fullPage: true });
        db.data[user][game_id].status = 'failed';
      }
      notify_game.status = db.data[user][game_id].status; // claimed or failed

      const p = screenshot(`${game_id}.png`);
      if (!existsSync(p)) await page.screenshot({ path: p, fullPage: false }); // fullPage is quite long...
    }
    if (cfg.time) console.timeEnd('claim game');
  }
  if (cfg.time) console.timeEnd('claim all games');
} catch (error) {
  console.error(error); // .toString()?
  process.exitCode ||= 1;
  if (error.message && process.exitCode != 130)
    notify(`epic-games failed: ${error.message.split('\n')[0]}`);
} finally {
  await db.write(); // write out json db
  if (notify_games.filter(g => g.status == 'claimed' || g.status == 'failed').length) { // don't notify if all have status 'existed', 'manual', 'requires base game', 'unavailable-in-region', 'skipped'
    notify(`epic-games (${user}):<br>${html_game_list(notify_games)}`);
  }
}
if (cfg.debug) writeFileSync(path.resolve(cfg.dir.browser, 'cookies.json'), JSON.stringify(await context.cookies()));
await context.close();
