// import { firefox } from 'playwright-firefox';
import { chromium } from 'patchright';
import { datetime, filenamify, jsonDb, prompt } from './src/util.js';
import { cfg } from './src/config.js';

const db = await jsonDb('steam-games.json', {});

const user = cfg.steam_id || await prompt({ message: 'Enter Steam community id ("View my profile", then copy from URL)' });

const context = await chromium.launchPersistentContext(cfg.dir.browser, {
  headless: cfg.headless,
  // viewport: { width: cfg.width, height: cfg.height },
  locale: 'en-US', // ignore OS locale to be sure to have english text for locators -> done via /en in URL
  recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined, // will record a .webm video for each page navigated; without size, video would be scaled down to fit 800x800
  recordHar: cfg.record ? { path: `data/record/steam-${filenamify(datetime())}.har` } : undefined, // will record a HAR file with network requests and responses; can be imported in Chrome devtools
  handleSIGINT: false, // have to handle ourselves and call context.close(), otherwise recordings from above won't be saved
  // https://peter.sh/experiments/chromium-command-line-switches/
  args: [
    '--hide-crash-restore-bubble',
  ],
});

context.setDefaultTimeout(cfg.debug ? 0 : cfg.timeout);

const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist

try {
  await page.goto(`https://steamcommunity.com/id/${user}/games?tab=all`);
  const games = page.locator('div[data-featuretarget="gameslist-root"] > div.Panel > div.Panel > div');
  await games.last().waitFor();
  await page.keyboard.press('End');
  await page.waitForLoadState('networkidle');
  console.log('All Games:', await games.count());
  for (const game of await games.all()) {
    const title = await game.locator('span a').innerText();
    let time, last, achievements, size;
    const ltime = game.locator('span:has-text("total played")');
    if (await ltime.count()) time = (await ltime.first().innerText()).split('\n')[1];
    const llast = game.locator('span:has-text("last played")');
    if (await llast.count()) last = (await llast.first().innerText()).split('\n')[1];
    const lachievements = game.locator('a:has-text("achievements") + span');
    if (await lachievements.count()) achievements = (await lachievements.first().innerText()).split('\n');
    const lsize = game.locator('span:has(+ button)');
    if (await lsize.count()) size = await lsize.first().innerText();
    const url = await game.locator('a').first().getAttribute('href');
    const img = await game.locator('img').first().getAttribute('src');
    const stat = { title, time, last, achievements, size, url, img };
    console.log(stat);
    db.data[title] = stat;
  }

  // await page.pause();
} catch (error) {
  process.exitCode ||= 1;
  console.error('--- Exception:');
  console.error(error); // .toString()?
} finally {
  await db.write(); // write out json db
}
if (page.video()) console.log('Recorded video:', await page.video().path());
await context.close();
