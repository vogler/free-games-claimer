import { firefox } from 'playwright-firefox'; // stealth plugin needs no outdated playwright-extra
import { resolve, jsonDb, datetime, prompt, stealth, notify, html_game_list, handleSIGINT } from './util.js';
import path from 'path';
import { existsSync, writeFileSync } from 'fs';
import { cfg } from './config.js';

const screenshot = (...a) => resolve(cfg.dir.screenshots, 'steam', ...a);

const URL_CLAIM = 'https://store.steampowered.com/?l=english';
const URL_LOGIN = 'https://store.steampowered.com/login/';

console.log(datetime(), 'started checking steam');

const db = await jsonDb('steam.json', {});

handleSIGINT();

// https://playwright.dev/docs/auth#multi-factor-authentication
const context = await firefox.launchPersistentContext(cfg.dir.browser, {
  // chrome will not work in linux arm64, only chromium
  // channel: 'chrome', // https://playwright.dev/docs/browsers#google-chrome--microsoft-edge
  headless: false,
  viewport: { width: cfg.width, height: cfg.height },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.83 Safari/537.36', 
  locale: "en-US", // ignore OS locale to be sure to have english text for locators
  recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined,
  recordHar: cfg.record ? { path: `data/record/eg-${datetime()}.har` } : undefined,
  args: [ // https://peter.sh/experiments/chromium-command-line-switches
    // don't want to see bubble 'Restore pages? Chrome didn't shut down correctly.'
    // '--restore-last-session', // does not apply for crash/killed
    '--hide-crash-restore-bubble',
    // `--disable-extensions-except=${ext}`,
    // `--load-extension=${ext}`,
  ],
  // ignoreDefaultArgs: ['--enable-automation'], // remove default arg that shows the info bar with 'Chrome is being controlled by automated test software.'. Since Chromeium 106 this leads to show another info bar with 'You are using an unsupported command-line flag: --no-sandbox. Stability and security will suffer.'.
});

await stealth(context);

if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);

const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist
// console.debug('userAgent:', await page.evaluate(() => navigator.userAgent));

const notify_games = [];
let user;

async function doLogin() {
  await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' }); // default 'load' takes forever
  if (cfg.steam_username && cfg.steam_password) {
    console.info('Using username and password from environment.');
  }
  else {
    console.info('Press ESC to skip the prompts if you want to login in the browser (not possible in headless mode).');
  }
  const username = cfg.steam_username || await prompt({ message: 'Enter username' });
  const password = username && (cfg.steam_password || await prompt({ type: 'password', message: 'Enter password' }));
  if (username && password) {
    await page.type('input[type=text]:visible', username);
    await page.type('input[type=password]:visible', password);
    await page.waitForTimeout(2000);
    await page.click('button[type=submit]');
    await page.waitForTimeout(2000);
  }
  const auth = await page.getByText('You have a mobile authenticator protecting this account.').first();
  let isFirstCheck = true;
  while (await auth.isVisible()) {
    if (isFirstCheck) {
      console.log("Steam requires confirmation from authenticator");
      notify(`Steam requires confirmation from authenticator`);
      isFirstCheck = false;
    }
    await page.waitForTimeout(2000);
  }
}

async function claim() {
  await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' }); // default 'load' takes forever
  await context.addCookies([{ name: 'cookieSettings', value: '%7B%22version%22%3A1%2C%22preference_state%22%3A2%2C%22content_customization%22%3Anull%2C%22valve_analytics%22%3Anull%2C%22third_party_analytics%22%3Anull%2C%22third_party_content%22%3Anull%2C%22utm_enabled%22%3Atrue%7D', domain: 'store.steampowered.com', path: '/' }]); // Decline all cookies to get rid of banner to save space on screen.

  const signIn = page.locator('a:has-text("Sign In")').first();
  while (await signIn.isVisible()) {
    console.error('Not signed in to steam.');

    await doLogin();
  }

  user = await page.locator("#account_pulldown").first().innerText();
  console.error('You are logged in as ' + user);
  db.data[user] ||= {};

  if (cfg.steam_json) {
    await claimJson();
  }
  if (cfg.steam_gamerpower) {
    await claimGamerpower();
  }
}

async function claimJson() {
  console.log("Claiming JSON");
  const response = await page.goto(cfg.steam_json_url);
  const items = await response.json();
  for (const item of items) {
    if (!await isClaimedUrl(item.url)) {
      console.log(item);
      if (item.hasOwnProperty("startDate")) {
        const date = Date.parse(item.startDate);
        if (date >= Date.now()) {
          console.log("game not available yet " + new Date(date));
          return;
        }
      }
      await claimGame(item.url);
    }
  }
}

async function claimGamerpower() {
  console.log("Claiming Gamerpower");
  const response = await page.goto("https://www.gamerpower.com/api/giveaways?platform=steam&type=game");
  const items = await response.json();
  for (const item of items) {
    console.log(item.open_giveaway_url);
    await page.goto(item.open_giveaway_url, { waitUntil: 'domcontentloaded' });

    const url = page.url();
    if (url.includes("https://store.steampowered.com/app")) {
      if (!await isClaimedUrl(url)) {
        await claimGame(url);
      }
    }
    else {
      console.log("Game can be claimed outside of steam! " + url);
    }
  }
}

async function claimGame(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const title = await page.locator('#appHubAppName').first().innerText();
  const pattern = "/app/";
  let game_id = page.url().substring(page.url().indexOf(pattern) + pattern.length);
  game_id = game_id.substring(0, game_id.indexOf("/"));
  db.data[user][game_id] ||= { title, time: datetime(), url: page.url() }; // this will be set on the initial run only!

  const notify_game = { title, url: url, status: 'failed' };
  notify_games.push(notify_game); // status is updated below

  const alreadyOwned = await page.locator('.game_area_already_owned').first();
  if (await alreadyOwned.isVisible()) {
    console.log("Game " + title + " already in library");
    db.data[user][game_id].status ||= 'existed'; // does not overwrite claimed or failed
  }
  else {
    await page.locator(('#freeGameBtn')).click();
    console.log("purchased");
    db.data[user][game_id].status = 'claimed';
    db.data[user][game_id].time = datetime(); // claimed time overwrites failed/dryrun time
  }
  notify_game.status = db.data[user][game_id].status; // claimed or failed
  const p = screenshot(`${game_id}.png`);
  if (!existsSync(p)) await page.screenshot({ path: p, fullPage: false }); // fullPage is quite long...
}

async function isClaimedUrl(url) {
  try {
    const pattern = "/app/";
    let game_id = url.substring(url.indexOf(pattern) + pattern.length);
    game_id = game_id.substring(0, game_id.indexOf("/"));
    const status = db.data[user][game_id]["status"];
    return status === "existed" || status === "claimed";
  } catch (error) {
    return false;
  }
}

try {
  await claim();
} catch (error) {
  console.error(error); // .toString()?
  process.exitCode ||= 1;
  if (error.message && process.exitCode != 130)
    notify(`steam failed: ${error.message.split('\n')[0]}`);
} finally {
  await db.write(); // write out json db
  if (notify_games.filter(g => g.status != 'existed').length) { // don't notify if all were already claimed
    notify(`steam (${user}):<br>${html_game_list(notify_games)}`);
  }
}
if (cfg.debug) writeFileSync(path.resolve(cfg.dir.browser, 'cookies.json'), JSON.stringify(await context.cookies()));
if (page.video()) console.log('Recorded video:', await page.video().path());
await context.close();
