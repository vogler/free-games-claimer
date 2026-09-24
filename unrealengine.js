// TODO This is mostly a copy of epic-games.js
// New assets to claim every first Tuesday of a month.

// import { firefox } from 'playwright-firefox';
import { chromium } from 'patchright';
import { authenticator } from 'otplib';
import path from 'path';
import { existsSync, writeFileSync } from 'fs';
import { resolve, jsonDb, datetime, filenamify, prompt, notify, html_game_list, handleSIGINT } from './src/util.js';
import { cfg } from './src/config.js';

const screenshot = (...a) => resolve(cfg.dir.screenshots, 'unrealengine', ...a);

const URL_CLAIM = 'https://www.fab.com/limited-time-free';
const URL_LOGIN = 'https://www.epicgames.com/id/login?lang=en-US&noHostRedirect=true&redirectUrl=' + encodeURIComponent(URL_CLAIM);

console.log(datetime(), 'started checking unrealengine');

const db = await jsonDb('unrealengine.json', {});

// https://playwright.dev/docs/auth#multi-factor-authentication
const context = await chromium.launchPersistentContext(cfg.dir.browser, {
  headless: cfg.headless,
  viewport: { width: cfg.width, height: cfg.height },
  locale: 'en-US', // ignore OS locale to be sure to have english text for locators -> done via /en in URL
  recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined, // will record a .webm video for each page navigated; without size, video would be scaled down to fit 800x800
  recordHar: cfg.record ? { path: `data/record/gog-${filenamify(datetime())}.har` } : undefined, // will record a HAR file with network requests and responses; can be imported in Chrome devtools
  handleSIGINT: false, // have to handle ourselves and call context.close(), otherwise recordings from above won't be saved
  // https://peter.sh/experiments/chromium-command-line-switches/
  args: [
    '--hide-crash-restore-bubble',
  ],
});

handleSIGINT(context);

if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);

const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist
await page.setViewportSize({ width: cfg.width, height: cfg.height }); // TODO workaround for https://github.com/vogler/free-games-claimer/issues/277 until Playwright fixes it
// console.debug('userAgent:', await page.evaluate(() => navigator.userAgent));

const notify_games = [];
let user;

try {
  await context.addCookies([{ name: 'OptanonAlertBoxClosed', value: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), domain: '.epicgames.com', path: '/' }]); // Accept cookies to get rid of banner to save space on screen. Set accept time to 5 days ago.

  await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' }); // 'domcontentloaded' faster than default 'load' https://playwright.dev/docs/api/class-page#page-goto

  page.locator('button:has-text("Continue")').click().catch(_ => { }); // already logged in, but need to accept updated "Epic Games Privacy Policy"

  // Wait for navigation element to load
  await page.waitForTimeout(2000);

  // Check if logged in - egs-navigation might not exist on fab.com, so check for login indicators
  const isLoggedIn = async () => {
    const egsNav = page.locator('egs-navigation');
    if (await egsNav.count() > 0) {
      return await egsNav.getAttribute('isloggedin') == 'true';
    }
    // Alternative: check for user-specific elements on fab.com
    return await page.locator('a[href="/library"]').count() > 0;
  };

  while (!(await isLoggedIn())) {
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
    await page.waitForURL('**fab.com/**');
    if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);
  }
  await page.waitForTimeout(1000);

  // Get user info - try egs-navigation first, fallback to other methods
  const egsNav = page.locator('egs-navigation');
  if (await egsNav.count() > 0) {
    user = await egsNav.getAttribute('displayname');
  } else {
    // Fallback: try to get username from page elements
    user = 'fab-user'; // Default if we can't determine username
  }
  console.log(`Signed in as ${user}`);
  db.data[user] ||= {};

  page.locator('button:has-text("Accept All Cookies")').click().catch(_ => { });

  // Detect free items - similar to epic-games.js
  const game_loc = page.locator('a[href^="/listings/"]');
  await game_loc.last().waitFor().catch(_ => {
    console.error('Seems like currently there are no free items available...');
  });
  const urlSlugs = await Promise.all((await game_loc.all()).map(a => a.getAttribute('href')));
  const urls = urlSlugs.map(s => 'https://www.fab.com' + s);
  console.log('Free items:', urls);

  for (const url of urls) {
    if (db.data[user][url.split('/').pop()]?.status == 'claimed') {
      console.log('Already claimed, skipping:', url);
      continue;
    }
    await page.goto(url);
    await page.waitForTimeout(2000); // wait for page to load

    const title = await page.locator('h1').first().innerText();
    const game_id = url.split('/').pop();
    const existedInDb = db.data[user][game_id];
    db.data[user][game_id] ||= { title, time: datetime(), url };
    console.log('Current free item:', title);
    const notify_game = { title, url, status: 'failed' };
    notify_games.push(notify_game);

    // Check if already in library
    if (await page.locator('h2:has-text("Saved in My Library")').count() > 0) {
      console.log('  Already in library! Nothing to claim.');
      if (!existedInDb) await notify(`Item already in library: ${url}`);
      notify_game.status = 'existed';
      db.data[user][game_id].status ||= 'existed';
      if (db.data[user][game_id].status?.startsWith('failed')) db.data[user][game_id].status = 'manual';
      continue;
    }

    console.log('  Not in library yet! Checking license options...');

    // Check if Professional license is available and free
    const licenseButton = page.locator('button.fabkit-InputContainer-root').first();
    await licenseButton.click(); // Open license dropdown

    // Wait for dropdown to appear and check options
    await page.waitForTimeout(1000);
    const professionalOption = page.locator('text=Professional').first();
    if (await professionalOption.count() > 0) {
      console.log('  Professional license found, checking if free...');
      await professionalOption.click(); // Select Professional
      await page.waitForTimeout(500);

      // Check if Professional shows "Free"
      const priceText = await page.locator('.fabkit-Text--xl.fabkit-Text--bold').first().innerText();
      if (priceText.includes('Free')) {
        console.log('  Professional license is free! Using Professional.');
      } else {
        console.log('  Professional license is not free, switching back to Personal.');
        await licenseButton.click();
        await page.waitForTimeout(500);
        await page.locator('text=Personal').first().click();
        await page.waitForTimeout(500);
      }
    } else {
      console.log('  Only Personal license available.');
    }

    if (cfg.debug) await page.pause();
    if (cfg.dryrun) {
      console.log('  DRYRUN=1 -> Skip claim!');
      notify_game.status = 'skipped';
      continue;
    }

    // Click Buy now button
    console.log('  Clicking Buy now...');
    const buyButton = page.locator('button:has-text("Buy now")').first();
    await buyButton.click({ delay: 11 });

    try {
      // Wait for success confirmation
      await page.waitForSelector('h2:has-text("Saved in My Library")', { timeout: 30000 });
      db.data[user][game_id].status = 'claimed';
      db.data[user][game_id].time = datetime();
      notify_game.status = 'claimed';
      console.log('  Claimed successfully!');
    } catch (e) {
      console.log(e);
      console.error('  Failed to claim!');
      await page.screenshot({ path: screenshot('failed', `${game_id}_${filenamify(datetime())}.png`), fullPage: true });
      db.data[user][game_id].status = 'failed';
      notify_game.status = 'failed';
    }

    const p = screenshot(`${game_id}.png`);
    if (!existsSync(p)) await page.screenshot({ path: p, fullPage: false });
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
