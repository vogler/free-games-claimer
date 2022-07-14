import { chromium } from 'playwright'; // stealth plugin needs no outdated playwright-extra
import path from 'path';
import { dirs, jsonDb, datetime, sanitizeFilename, stealth } from './util.js';

const debug = process.env.PWDEBUG == '1'; // runs headful and opens https://playwright.dev/docs/inspector
const show = process.argv.includes('show', 2);
const headless = !debug && !show;

// const URL_LOGIN = 'https://www.amazon.de/ap/signin'; // wrong. needs some session args to be valid?
const URL_CLAIM = 'https://gaming.amazon.com/home';
const TIMEOUT = 20 * 1000; // 20s, default is 30s

const db = await jsonDb('prime-gaming.json');
db.data ||= { claimed: [], runs: [] };
const run = {
  startTime: datetime(),
  endTime: null,
  n_internal: null, // unclaimed games at beginning
  c_internal: 0,    // claimed games at end
  n_external: null,
  c_external: 0,
};

// https://playwright.dev/docs/auth#multi-factor-authentication
const context = await chromium.launchPersistentContext(dirs.browser, {
  // channel: 'chrome', // https://playwright.dev/docs/browsers#google-chrome--microsoft-edge, chrome will not work on arm64 linux, only chromium which is the default
  headless,
  viewport: { width: 1280, height: 1280 },
  locale: "en-US", // ignore OS locale to be sure to have english text for locators
});

// TODO test if needed
await stealth(context);

if (!debug) context.setDefaultTimeout(TIMEOUT);

// const page = /* context.pages().length ? context.pages[0] : */ await context.newPage();
const page = context.pages()[0];
console.debug('userAgent:', await page.evaluate(() => navigator.userAgent));

const clickIfExists = async selector => {
  if (await page.locator(selector).count() > 0)
    await page.click(selector);
};

try {
  await page.goto(URL_CLAIM, {waitUntil: 'domcontentloaded'}); // default 'load' takes forever
  // need to wait for some elements to exist before checking if signed in or accepting cookies:
  await Promise.any(['button:has-text("Sign in")', '[data-a-target="user-dropdown-first-name-text"]'].map(s => page.waitForSelector(s)));
  await clickIfExists('[aria-label="Cookies usage disclaimer banner"] button:has-text("Accept Cookies")'); // to not waste screen space in --debug
  while (await page.locator('button:has-text("Sign in")').count() > 0) {
    console.error('Not signed in anymore.');
    if (headless) {
      console.log('Please run `node prime-gaming show` to login in the opened browser.');
      await context.close(); // not needed?
      process.exit(1);
    }
    await page.click('button:has-text("Sign in")');
    if (!debug) context.setDefaultTimeout(0); // give user time to log in without timeout
    await page.waitForNavigation({url: 'https://gaming.amazon.com/home?signedIn=true'});
    if (!debug) context.setDefaultTimeout(TIMEOUT);
  }
  console.log('Signed in.');
  await page.click('button[data-type="Game"]');
  const games_sel = 'div[data-a-target="offer-list-FGWP_FULL"]';
  await page.waitForSelector(games_sel);
  console.log('Number of already claimed games (total):', await page.locator(`${games_sel} p:has-text("Collected")`).count());
  const game_sel = `${games_sel} [data-a-target="item-card"]:has-text("Claim game")`;
  run.n_internal = await page.locator(game_sel).count();
  console.log('Number of free unclaimed games (Prime Gaming):', run.n_internal);
  const games = await page.$$(game_sel);
  // for (let i=1; i<=n; i++) {
  for (const card of games) {
    // const card = page.locator(`:nth-match(${game_sel}, ${i})`); // this will reevaluate after games are claimed and index will be wrong
    // const title = await card.locator('h3').first().innerText();
    const title = await (await card.$('.item-card-details__body__primary')).innerText();
    console.log('Current free game:', title);
    await (await card.$('button:has-text("Claim game")')).click();
    db.data.claimed.push({ title, time: datetime(), store: 'internal' });
    run.c_internal++;
    // const img = await (await card.$('img.tw-image')).getAttribute('src');
    // console.log('Image:', img);
    const p = path.resolve(dirs.screenshots, 'prime-gaming', 'internal', `${sanitizeFilename(title)}.png`);
    await card.screenshot({ path: p });
    // await page.pause();
  }
  // claim games in external/linked stores. Linked: origin.com, epicgames.com; Redeem-key: gog.com, legacygames.com
  let n;
  const game_sel_ext = `${games_sel} [data-a-target="item-card"]:has(p:text-is("Claim"))`;
  do {
    n = await page.locator(game_sel_ext).count();
    run.n_external ||= n;
    console.log('Number of free unclaimed games (external stores):', n);
    const card = await page.$(game_sel_ext);
    if (!card) break;
    const title = await (await card.$('.item-card-details__body__primary')).innerText();
    console.log('Current free game:', title);
    await (await card.$('text=Claim')).click();
    // await page.waitForNavigation();
    await Promise.any([page.click('button:has-text("Claim now")'), page.click('button:has-text("Complete Claim")')]); // waits for navigation
    const store_text = await (await page.$('[data-a-target="hero-header-subtitle"]')).innerText();
    // FULL GAME FOR PC ON: GOG.COM, ORIGIN, LEGACY GAMES, EPIC GAMES
    // 3 Full PC Games on Legacy Games
    const store = store_text.toLowerCase().replace(/.* on /, '');
    console.log('External store:', store);
    if(await page.locator('div:has-text("Link game account")').count()) {
      console.error('Account linking is required to claim this offer!');
    } else {
      // print code if there is one
      const redeem = {
        // 'origin': 'https://www.origin.com/redeem', // TODO still needed or now only via account linking?
        'gog.com': 'https://www.gog.com/redeem',
        'legacy games': 'https://www.legacygames.com/primedeal',
      };
      let code;
      if (store in redeem) { // did not work for linked origin: && !await page.locator('div:has-text("Successfully Claimed")').count()
        code = await page.inputValue('input[type="text"]');
        console.log('Code to redeem game:', code);
        if (store == 'legacy games') { // may be different URL like https://legacygames.com/primeday/puzzleoftheyear/
          redeem[store] = await (await page.$('li:has-text("Click here") a')).getAttribute('href');
        }
        console.log('URL to redeem game:', redeem[store]);
      }
      db.data.claimed.push({ title, time: datetime(), store, code, url: page.url() });
      // save screenshot of potential code just in case
      const p = path.resolve(dirs.screenshots, 'prime-gaming', 'external', `${sanitizeFilename(title)}.png`);
      await page.screenshot({ path: p, fullPage: true });
      console.info('Saved a screenshot of page to', p);
      run.c_external++;
    }
    // await page.pause();
    await page.goto(URL_CLAIM, {waitUntil: 'domcontentloaded'});
    await page.click('button[data-type="Game"]');
  } while (n);
  const p = path.resolve(dirs.screenshots, 'prime-gaming', `${datetime()}.png`);
  await page.screenshot({ path: p, fullPage: true });
} catch(error) {
  console.error(error);
  run.error = error.toString();
} finally {
  // write out json db
  run.endTime = datetime();
  db.data.runs.push(run);
  await db.write();

  await context.close();
}
