import { chromium } from 'patchright';
import dotenv from 'dotenv';
import path from 'path';
import { existsSync, writeFileSync } from 'fs';
import { resolve, jsonDb, datetime, prompt, notify, html_game_list, handleSIGINT } from './src/util.js';
import { cfg } from './src/config.js';

const notify_games = [];

const screenshot = (...a) => resolve(cfg.dir.screenshots, 'steam', ...a);
const URL_CLAIM = 'https://store.steampowered.com/?l=english';
const URL_LOGIN = 'https://store.steampowered.com/login/';

console.log(datetime(), 'started checking steam');

const db = await jsonDb('steam.json', {});
handleSIGINT();

const context = await chromium.launchPersistentContext(cfg.dir.browser, {
  headless: cfg.headless,
  locale: "en-US",
  recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined,
  recordHar: cfg.record ? { path: `data/record/eg-${datetime()}.har` } : undefined,
  handleSIGINT: false,
  args: [
    '--hide-crash-restore-bubble',
  ],
});

const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist

async function doLogin(page) {
  const username = cfg.steam_username || await prompt({ message: 'Enter username' });
  const password = username && (cfg.steam_password || await prompt({ type: 'password', message: 'Enter password' }));
  if (username && password) {
    await page.type('input[type=text]:visible', username);
    await page.type('input[type=password]:visible', password);
    await Promise.all([page.click('button[type=submit]'), page.waitForNavigation()]);
  }
}


async function claim() {
  await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' });
  console.log('Navigated to Steam store page');

  await context.addCookies([{ name: 'cookieSettings', value: '%7B%22version%22%3A1%2C%22preference_state%22%3A2%2C%22content_customization%22%3Anull%2C%22valve_analytics%22%3Anull%2C%22third_party_analytics%22%3Anull%2C%22third_party_content%22%3Anull%2C%22utm_enabled%22%3Atrue%7D', domain: 'store.steampowered.com', path: '/' }]); // Decline all cookies to get rid of banner to save space on screen.
  console.log('Cookies added');

  const loginText = await page.textContent('a.global_action_link');
  const user = await page.locator("#account_pulldown").first().innerText();
  const result = await Promise.race([loginText, user]);
  while (await result.includes('Log In')) {
    console.error('Not signed in to steam.');
    await doLogin();
    loginText = await page.textContent('a.global_action_link');
    user = await page.locator("#account_pulldown").first().innerText();
    result = await Promise.race([loginText, user]);
  }
  console.log('You are logged in as ' + user);

  db.data[user] ||= {};
  if (cfg.steam_json) {
    console.log('Starting to claim from Steam JSON');
    await claimJson(user);
    console.log('Finished claiming from Steam JSON');
  }
  if (cfg.steam_gamerpower) {
    console.log('Starting to claim from GamerPower');
    await claimGamerpower(user);
    console.log('Finished claiming from GamerPower');
  }

  // Write db.data[user] to a file
  writeFileSync(`data/steam.json`, JSON.stringify(db.data[user], null, 2));
  console.log('Data written to file for user:', user);
}

async function claimJson(user) {
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
      await claimGame(item.url, user);
    }
  }
}

async function claimGamerpower(user) {
  console.log("Claiming Gamerpower");
  try {
    const response = await page.goto(cfg.steam_gamerpower_url);
    if (!response.ok) {
      throw new Error(`Failed to fetch GamerPower data: ${response.statusText}`);
    }
    const items = await response.json();

    for (const item of items) {
      console.log(item.open_giveaway_url);
      try {
        await page.goto(item.open_giveaway_url, { waitUntil: 'domcontentloaded' });
        const url = page.url();
        if (url.includes("https://store.steampowered.com/app")) {
          if (!await isClaimedUrl(url)) {
            await claimGame(url, user);
          }
        } else if (url.includes("https://store.steampowered.com/agecheck/app")) {
          if (!await isClaimedUrl(url)) {
            await handleAgeGate(page, 21, 1, 1989);
            await claimGame(url, user);
          }
        } else {
          console.log("Game can be claimed outside of Steam! " + url);
        }
      } catch (error) {
        console.error(`Failed to claim game from ${item.open_giveaway_url}:`, error.message);
      }
    }
  } catch (error) {
    console.error(`Error in claimGamerpower:`, error.message);
  }
}

async function handleAgeGate(page, day, month, year, timeout = 30000) {
  try {
    // 1. Check if age_gate element is visible
    console.log('Looking for age gate...');
    const ageGate = page.locator('.age_gate');

    // Try to wait a little on the element to appear
    await page.waitForTimeout(1000);

    const isVisible = await ageGate.isVisible().catch(() => false);

    if (!isVisible) {
      console.log('Age gate not found or not visible');
      return false;
    }

    console.log('Age gate found, filling in dates...');

    // 2. Set day
    const daySelect = page.locator('#ageDay');
    const isdaySelect = await daySelect.isVisible().catch(() => false);

    if (!isdaySelect) {
      console.log('Day select not found. Attempting to click product page button...')
    } else {

      await daySelect.waitFor({ timeout });
      await daySelect.selectOption(day.toString());
      console.log(`Day set to: ${day}`);

      // 3. Set month (convert to English month name with capital first letter)
      const monthNames = {
        1: 'January', 2: 'February', 3: 'March', 4: 'April',
        5: 'May', 6: 'June', 7: 'July', 8: 'August',
        9: 'September', 10: 'October', 11: 'November', 12: 'December'
      };

      const monthNumber = parseInt(month);
      const monthName = monthNames[monthNumber];

      if (!monthName) {
        throw new Error(`Invalid Month: ${month}. Must be between 1-12`);
      }

      const monthSelect = page.locator('#ageMonth');
      await monthSelect.waitFor({ timeout });
      await monthSelect.selectOption(monthName);
      console.log(`Month set to: ${monthName}`);

      // 4. Set year
      const yearSelect = page.locator('#ageYear');
      await yearSelect.waitFor({ timeout });
      await yearSelect.selectOption(year.toString());
      console.log(`Year set to: ${year}`);
    }

    // 5. Click on view_product_page_btn
    console.log('Clicking on the view product button...');
    const viewProductBtn = page.locator('#view_product_page_btn');
    await viewProductBtn.waitFor({ timeout });
    await viewProductBtn.click();

    // 6. Wait until the page has loaded
    console.log('Waiting for page to load...');
    await page.waitForLoadState('networkidle', { timeout });

    console.log('Age gate completed');
    return true;

  } catch (error) {
    console.error('Error during age gate process:', error.message);
    return false;
  }
}


async function claimGame(url, user) {
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
    if (url.includes("https://store.steampowered.com/agecheck/app")) {
      try {
        await page.waitForSelector('#agegate_birthday_desc', { timeout: 5000 });
        // Select a random day between 1 and 31
        const dayIndex = Math.floor(Math.random() * 31) + 1;
        await page.selectOption('#ageDay', { value: dayIndex.toString() });

        // Select a random month between January and December
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const monthIndex = Math.floor(Math.random() * months.length);
        await page.selectOption('#ageMonth', { value: months[monthIndex] });

        // Select a year between 1900 and the current year
        const currentDate = new Date();
        const yearIndex = Math.floor(Math.random() * (currentDate.getFullYear() - 1900 + 1)) + 1900;
        await page.fill('#ageYear', yearIndex.toString());

        await Promise.all([
          page.click('#view_product_page_btn'),
          page.waitForNavigation({ waitUntil: 'networkidle2' })
        ]);
      } catch (error) {
        console.error("Age gate not found or failed to handle");
      }
    }
    try {
      await page.waitForSelector('#freeGameBtn', { timeout: 5000 }); // Wait for the free game button to appear
      await page.click('#freeGameBtn');
      console.log("purchased (using #freeGameBtn)");
    } catch (error) {
      try {
        const button = await page.locator('.btn_green_steamui.btn_medium[data-action="add_to_account"]');
        if ((await button.textContent()) === "Add to Account") {
          await button.click();
          console.log("purchased (using .btn_green_steamui.btn_medium with text 'Add to Account' and data-action='add_to_account')");
        } else {
          console.error(`Button found but text is not 'Add to Account': ${await button.textContent()}`);
        }
      } catch (error) {
        try {
          const button = await page.locator('.btn_green_steamui.btn_medium');
          if ((await button.textContent()) === "Add to Account") {
            await button.click();
            console.log("purchased (using .btn_green_steamui.btn_medium with text 'Add to Account')");
          } else {
            console.error(`Button found but text is not 'Add to Account': ${await button.textContent()}`);
          }
        } catch (error) {
          console.error(`Failed to claim game: Button not found`);
        }
      }
    }

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
if (cfg.debug) fs.writeFileSync(path.resolve(cfg.dir.browser, 'cookies.json'), JSON.stringify(await context.cookies()));
await context.close();