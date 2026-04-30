import { chromium } from 'patchright';
import { authenticator } from 'otplib';
import chalk from 'chalk';
import { jsonDb, datetime, stealth, prompt, notify, html_game_list, handleSIGINT, clearBrowserLock, writeLastRun, withRetry, generateFingerprint } from './src/util.js';
import { cfg } from './src/config.js';

const URL_STORE = 'https://store.steampowered.com';
const URL_LOGIN = `${URL_STORE}/login/`;
const GAMERPOWER_API = 'https://www.gamerpower.com/api/giveaways?platform=steam&type=game&status=active';

console.log(datetime(), 'started checking steam-games');

const db = await jsonDb('steam-games.json', {});

// Fetch active Steam giveaways from GamerPower API
const fetchGiveaways = async () => {
  try {
    const res = await fetch(GAMERPOWER_API, {
      headers: { 'User-Agent': 'free-games-claimer/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('GamerPower API error:', e.message);
    return [];
  }
};

clearBrowserLock(cfg.dir.browser);

const fp = generateFingerprint(cfg.width, cfg.height);

const context = await chromium.launchPersistentContext(cfg.dir.browser, {
  headless: cfg.headless,
  viewport: { width: cfg.width, height: cfg.height },
  userAgent: fp.fingerprint.navigator.userAgent,
  locale: 'en-US',
  recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined,
  handleSIGINT: false,
  args: ['--disable-blink-features=AutomationControlled'],
});

handleSIGINT(context);
await stealth(context, fp);

if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);

const page = context.pages().length ? context.pages()[0] : await context.newPage();
await page.setViewportSize({ width: cfg.width, height: cfg.height });

const notify_games = [];
let user = 'unknown';

try {
  await page.goto(URL_STORE, { waitUntil: 'domcontentloaded' });

  const isLoggedIn = async () => (await page.locator('#account_pulldown, a.username, .persona_name_text_content').count()) > 0;

  if (!await isLoggedIn()) {
    console.error('Not signed in to Steam. Please login.');
    if (cfg.novnc_port) console.info(`Open http://localhost:${cfg.novnc_port} to login inside Docker.`);
    if (!cfg.debug) context.setDefaultTimeout(cfg.login_timeout);
    console.info(`Login timeout is ${cfg.login_timeout / 1000} seconds!`);

    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });

    if (cfg.steam_username && cfg.steam_password) {
      console.info('Using credentials from environment.');
      await page.locator('input[type="text"][autocomplete="username"]').fill(cfg.steam_username);
      await page.locator('input[type="password"]').fill(cfg.steam_password);
      await page.locator('button[type="submit"]').click();

      // Steam Guard — email or app code
      const guardInput = page.locator('input[maxlength="5"], input[maxlength="6"], input[data-input-type="password"]').first();
      await guardInput.waitFor({ timeout: 15000 }).then(async () => {
        console.log('Steam Guard required.');
        const otp = cfg.steam_otpkey && authenticator.generate(cfg.steam_otpkey)
          || await prompt({ type: 'text', message: 'Enter Steam Guard code (email or app)', validate: n => n.toString().length >= 5 || 'Must be 5-6 digits' });
        if (otp) {
          await guardInput.fill(otp.toString());
          await page.locator('button[type="submit"]').click();
        }
      }).catch(_ => { }); // no guard needed
    } else {
      console.info('Press ESC to skip prompts and login manually in the browser.');
      const username = await prompt({ message: 'Steam username' });
      const password = username && await prompt({ type: 'password', message: 'Steam password' });
      if (username && password) {
        await page.locator('input[type="text"]').fill(username);
        await page.locator('input[type="password"]').fill(password);
        await page.locator('button[type="submit"]').click();
      }
    }

    await page.waitForURL(`${URL_STORE}/**`, { timeout: cfg.login_timeout });
    if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);
  }

  user = await page.locator('#account_pulldown').first().innerText().catch(
    () => page.locator('.persona_name_text_content').first().innerText().catch(() => 'unknown')
  );
  console.log(`Signed in as ${user}`);
  db.data[user] ||= {};

  // Fetch giveaways from GamerPower API
  console.log('\nFetching active Steam giveaways from GamerPower...');
  const giveaways = await fetchGiveaways();
  if (!giveaways.length) {
    console.log('No active Steam giveaways found.');
  } else {
    console.log(`Found ${giveaways.length} active giveaway(s).`);
  }

  for (const giveaway of giveaways) {
    const title = giveaway.title;
    const store_url = giveaway.store_url || '';
    const game_id = store_url.match(/\/app\/(\d+)/)?.[1] || giveaway.id?.toString();

    if (!store_url.includes('store.steampowered.com')) {
      console.log(`Skipping non-Steam URL: ${store_url}`);
      continue;
    }

    if (db.data[user][game_id]?.status === 'claimed') {
      console.log(`Already claimed: ${chalk.blue(title)}`);
      continue;
    }

    db.data[user][game_id] ||= { title, time: datetime(), url: store_url };
    console.log(`\nGiveaway: ${chalk.blue(title)}`);
    console.log(`  URL: ${store_url}`);
    console.log(`  Ends: ${giveaway.end_date || 'unknown'}`);

    const notify_game = { title, url: store_url, status: 'failed' };
    notify_games.push(notify_game);

    if (cfg.dryrun) {
      console.log('  DRYRUN=1 -> Skip!');
      notify_game.status = 'skipped';
      continue;
    }

    try {
      await withRetry(`steam claim ${title}`, async () => {
        await page.goto(store_url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Handle age gate
        if (await page.locator('#app_agegate, #agecheck_form, .agegate_birthday_selector').count()) {
          console.log('  Handling age gate...');
          await page.selectOption('#ageYear', '1990').catch(() => {});
          await page.locator('#age_gate_btn_continue, a[href*="agecheck"]').click().catch(() => {});
          await page.waitForTimeout(1500);
        }

        // Check if already owned
        if (await page.locator('.game_area_already_owned, :has-text("already in your Steam library")').count()) {
          console.log('  Already in library!');
          db.data[user][game_id].status = notify_game.status = 'existed';
          return;
        }

        // Find claim button (various types of free games on Steam)
        const claimSelectors = [
          'a.btn_green_steamui:has-text("Add to Account")',
          'a.btn_green_steamui:has-text("Play Game, Free")',
          'a.btn_green_steamui:has-text("Free to Play")',
          'a[href*="checkout/addfreelicense"]:visible',
          '.game_area_purchase_game a.btn_green_steamui:visible',
        ];
        const claimBtn = page.locator(claimSelectors.join(', ')).first();

        if (!await claimBtn.count()) {
          console.log('  No claim button found — may require account linking or be unavailable.');
          db.data[user][game_id].status = notify_game.status = 'not-available';
          return;
        }

        await claimBtn.click();

        // Confirm dialog ("Add to my account" button in modal)
        const confirmBtn = page.locator('a.btn_green_steamui:has-text("Add to my account"), .newmodal_buttons a:has-text("OK")').first();
        await confirmBtn.waitFor({ timeout: 5000 }).then(() => confirmBtn.click()).catch(() => {});
        await page.waitForTimeout(2000);

        // Verify success
        const success = await page.locator('.game_area_already_owned, :has-text("is now in your library"), :has-text("already in your Steam")').count();
        if (success) {
          db.data[user][game_id].status = notify_game.status = 'claimed';
          db.data[user][game_id].time = datetime();
          console.log('  Claimed successfully!');
        } else {
          console.log('  Result unclear — check manually.');
          db.data[user][game_id].status = notify_game.status = 'claimed?';
        }
      }, { retries: 2, delayMs: 10000 });
    } catch (e) {
      console.error(`  Failed: ${e.message?.split('\n')[0]}`);
      db.data[user][game_id].status = notify_game.status = 'failed';
    }
  }

} catch (error) {
  process.exitCode ||= 1;
  console.error('--- Exception:');
  console.error(error);
  if (error.message && process.exitCode != 130) notify(`steam-games failed: ${error.message.split('\n')[0]}`);
} finally {
  await db.write();
  writeLastRun('steam-games');
  const toNotify = notify_games.filter(g => g.status === 'claimed' || g.status === 'claimed?' || g.status === 'failed');
  if (toNotify.length) {
    notify(`steam-games (${user}):<br>${html_game_list(toNotify)}`);
  }
}
if (page.video()) console.log('Recorded video:', await page.video().path());
await context.close();
