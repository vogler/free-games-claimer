// TODO This is mostly a copy of epic-games.js
// New assets to claim every first Tuesday of a month.

import { firefox } from 'playwright-firefox'; // stealth plugin needs no outdated playwright-extra
import { authenticator } from 'otplib';
import path from 'path';
import { writeFileSync } from 'fs';
import { resolve, jsonDb, datetime, stealth, filenamify, prompt, notify, html_game_list, handleSIGINT } from './src/util.js';
import { cfg } from './src/config.js';

const screenshot = (...a) => resolve(cfg.dir.screenshots, 'unrealengine', ...a);

const URL_CLAIM = 'https://www.unrealengine.com/marketplace/en-US/assets?count=20&sortBy=effectiveDate&sortDir=DESC&start=0&tag=4910';
const URL_LOGIN = 'https://www.epicgames.com/id/login?lang=en-US&noHostRedirect=true&redirectUrl=' + URL_CLAIM;

console.log(datetime(), 'started checking unrealengine');

const db = await jsonDb('unrealengine.json', {});

// https://playwright.dev/docs/auth#multi-factor-authentication
const context = await firefox.launchPersistentContext(cfg.dir.browser, {
  headless: cfg.headless,
  viewport: { width: cfg.width, height: cfg.height },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.83 Safari/537.36', // see replace of Headless in util.newStealthContext. TODO Windows UA enough to avoid 'device not supported'? update if browser is updated?
  // userAgent for firefox: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:106.0) Gecko/20100101 Firefox/106.0
  locale: 'en-US', // ignore OS locale to be sure to have english text for locators
  recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined, // will record a .webm video for each page navigated; without size, video would be scaled down to fit 800x800
  recordHar: cfg.record ? { path: `data/record/ue-${filenamify(datetime())}.har` } : undefined, // will record a HAR file with network requests and responses; can be imported in Chrome devtools
  handleSIGINT: false, // have to handle ourselves and call context.close(), otherwise recordings from above won't be saved
});

handleSIGINT(context);

await stealth(context);

if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);

const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist
await page.setViewportSize({ width: cfg.width, height: cfg.height }); // TODO workaround for https://github.com/vogler/free-games-claimer/issues/277 until Playwright fixes it
// console.debug('userAgent:', await page.evaluate(() => navigator.userAgent));

const notify_games = [];
let user;

try {
  await context.addCookies([{ name: 'OptanonAlertBoxClosed', value: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), domain: '.epicgames.com', path: '/' }]); // Accept cookies to get rid of banner to save space on screen. Set accept time to 5 days ago.

  await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' }); // 'domcontentloaded' faster than default 'load' https://playwright.dev/docs/api/class-page#page-goto

  await page.waitForResponse(r => r.request().method() == 'POST' && r.url().startsWith('https://graphql.unrealengine.com/ue/graphql'));

  while (await page.locator('unrealengine-navigation').getAttribute('isloggedin') != 'true') {
    console.error('Not signed in anymore. Please login in the browser or here in the terminal.');
    if (cfg.novnc_port) console.info(`Open http://localhost:${cfg.novnc_port} to login inside the docker container.`);
    if (!cfg.debug) context.setDefaultTimeout(cfg.login_timeout); // give user some extra time to log in
    console.info(`Login timeout is ${cfg.login_timeout / 1000} seconds!`);
    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
    if (cfg.eg_email && cfg.eg_password) console.info('Using email and password from environment.');
    else console.info('Press ESC to skip the prompts if you want to login in the browser (not possible in headless mode).');
    const email = cfg.eg_email || await prompt({ message: 'Enter email' });
    const password = email && (cfg.eg_password || await prompt({ type: 'password', message: 'Enter password' }));
    if (email && password) {
      // await page.click('text=Sign in with Epic Games');
      await page.fill('#email', email);
      await page.click('button[type="submit"]');
      await page.fill('#password', password);
      await page.click('button[type="submit"]');
      page.waitForSelector('#h_captcha_challenge_login_prod iframe').then(() => {
        console.error('Got a captcha during login (likely due to too many attempts)! You may solve it in the browser, get a new IP or try again in a few hours.');
        notify('unrealengine: got captcha during login. Please check.');
      }).catch(_ => { });
      // handle MFA, but don't await it
      page.waitForURL('**/id/login/mfa**').then(async () => {
        console.log('Enter the security code to continue - This appears to be a new device, browser or location. A security code has been sent to your email address at ...');
        // TODO locator for text (email or app?)
        const otp = cfg.eg_otpkey && authenticator.generate(cfg.eg_otpkey) || await prompt({ type: 'text', message: 'Enter two-factor sign in code', validate: n => n.toString().length == 6 || 'The code must be 6 digits!' }); // can't use type: 'number' since it strips away leading zeros and codes sometimes have them
        await page.locator('input[name="code-input-0"]').pressSequentially(otp.toString());
        await page.click('button[type="submit"]');
      }).catch(_ => { });
    } else {
      console.log('Waiting for you to login in the browser.');
      await notify('unrealengine: no longer signed in and not enough options set for automatic login.');
      if (cfg.headless) {
        console.log('Run `SHOW=1 node unrealengine` to login in the opened browser.');
        await context.close(); // finishes potential recording
        process.exit(1);
      }
    }
    await page.waitForURL('**unrealengine.com/marketplace/**');
    if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);
  }
  await page.waitForTimeout(1000);
  user = await page.locator('unrealengine-navigation').getAttribute('displayname'); // 'null' if !isloggedin
  console.log(`Signed in as ${user}`);
  db.data[user] ||= {};

  page.locator('button:has-text("Accept All Cookies")').click().catch(_ => { });

  const ids = [];
  for (const p of await page.locator('article.asset').all()) {
    const link = p.locator('h3 a');
    const title = await link.innerText();
    const url = 'https://www.unrealengine.com' + await link.getAttribute('href');
    console.log([title, url]);
    const id = url.split('/').pop();
    db.data[user][id] ||= { title, time: datetime(), url, status: 'failed' }; // this will be set on the initial run only!
    const notify_game = { title, url, status: 'failed' };
    notify_games.push(notify_game); // status is updated below
    // if (await p.locator('.btn .add-review-btn').count()) { // did not work
    if ((await p.getAttribute('class')).includes('asset--owned')) {
      console.log('  ↳ Already claimed');
      if (db.data[user][id].status != 'claimed') {
        db.data[user][id].status = 'existed';
        notify_game.status = 'existed';
      }
      continue;
    }
    if (await p.locator('.btn .in-cart').count()) {
      console.log('  ↳ Already in cart');
    } else {
      await p.locator('.btn .add').click();
      console.log('  ↳ Added to cart');
    }
    ids.push(id);
  }
  if (!ids.length) {
    console.log('Nothing to claim');
  } else {
    await page.waitForTimeout(2000);
    const price = (await page.locator('.shopping-cart .total .price').innerText()).split(' ');
    console.log('Price: ', price[1], 'instead of', price[0]);
    if (price[1] != '0') {
      const err = 'Price is not 0! Exit! Please <a href="https://github.com/vogler/free-games-claimer/issues/44">report</a>.';
      console.error(err);
      notify('unrealengine: ' + err);
      process.exit(1);
    }
    // await page.pause();
    console.log('Click shopping cart');
    await page.locator('.shopping-cart').click();
    // await page.waitForTimeout(2000);
    await page.locator('button.checkout').click();
    console.log('Click checkout');
    // maybe: Accept End User License Agreement
    page.locator('[name=accept-label]').check().then(() => {
      console.log('Accept End User License Agreement');
      page.locator('span:text-is("Accept")').click(); // otherwise matches 'Accept All Cookies'
    }).catch(_ => { });
    await page.waitForSelector('#webPurchaseContainer iframe'); // TODO needed?
    const iframe = page.frameLocator('#webPurchaseContainer iframe');

    if (cfg.debug) await page.pause();
    if (cfg.dryrun) {
      console.log('DRYRUN=1 -> Skip order!');
      throw new Error('DRYRUN=1');
    }

    console.log('Click Place Order');
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
        console.error('  Got hcaptcha challenge! Lost trust due to too many login attempts? You can solve the captcha in the browser or get a new IP address.');
      }).catch(_ => { }); // may time out if not shown
      await page.waitForSelector('text=Thank you');
      for (const id of ids) {
        db.data[user][id].status = 'claimed';
        db.data[user][id].time = datetime(); // claimed time overwrites failed/dryrun time
      }
      notify_games.forEach(g => g.status == 'failed' && (g.status = 'claimed'));
      console.log('Claimed successfully!');
      // context.setDefaultTimeout(cfg.timeout);
    } catch (e) {
      console.log(e);
      // console.error('  Failed to claim! Try again if NopeCHA timed out. Click the extension to see if you ran out of credits (refill after 24h). To avoid captchas try to get a new IP or set a cookie from https://www.hcaptcha.com/accessibility');
      console.error('  Failed to claim! To avoid captchas try to get a new IP address.');
      await page.screenshot({ path: screenshot('failed', `${filenamify(datetime())}.png`), fullPage: true });
      // db.data[user][id].status = 'failed';
      notify_games.forEach(g => g.status = 'failed');
    }
    // notify_game.status = db.data[user][game_id].status; // claimed or failed

    if (notify_games.length) await page.screenshot({ path: screenshot(`${filenamify(datetime())}.png`), fullPage: false }); // fullPage is quite long...
    console.log('Done');
  }
} catch (error) {
  process.exitCode ||= 1;
  console.error('--- Exception:');
  console.error(error); // .toString()?
  if (error.message && process.exitCode != 130) notify(`unrealengine failed: ${error.message.split('\n')[0]}`);
} finally {
  await db.write(); // write out json db
  if (notify_games.filter(g => g.status != 'existed').length) { // don't notify if all were already claimed
    notify(`unrealengine (${user}):<br>${html_game_list(notify_games)}`);
  }
}
if (cfg.debug) writeFileSync(path.resolve(cfg.dir.browser, 'cookies.json'), JSON.stringify(await context.cookies()));
if (page.video()) console.log('Recorded video:', await page.video().path());
await context.close();
