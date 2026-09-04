import { chromium } from 'patchright';
import path from 'path';
import { existsSync, writeFileSync } from 'fs';
import fs from 'fs';
import { resolve, jsonDb, datetime, prompt, notify, html_game_list, handleSIGINT } from './src/util.js';
import { cfg } from './src/config.js';

// Constants
const GAMERPOWER_API_URL = 'https://www.gamerpower.com/api/giveaways?platform=steam&type=game';
const URL_CLAIM = 'https://store.steampowered.com/?l=english';

console.log(datetime(), 'started checking steam');

const db = await jsonDb('steam.json', {});
handleSIGINT();

// Assert removed to allow manual login via VNC

// Module-level variables
const notify_games = [];
let user;
let context;
let page;
let exceptionOccurred = false;

const screenshot = (...a) => resolve(cfg.dir.screenshots, 'steam', ...a);

// ============================================================================
// Helper Functions
// ============================================================================

function extractGameIdFromUrl(url) {
  const pattern = "/app/";
  const startIndex = url.indexOf(pattern);
  if (startIndex === -1) return null;

  let game_id = url.substring(startIndex + pattern.length);
  const endIndex = game_id.indexOf("/");
  if (endIndex !== -1) {
    game_id = game_id.substring(0, endIndex);
  }
  return game_id || null;
}

function isGameAlreadyClaimed(giveawayUrl) {
  const userGiveaways = db.data[cfg.steam_username] || {};

  if (userGiveaways[giveawayUrl]) {
    const entry = userGiveaways[giveawayUrl];
    console.log(`[isGameAlreadyClaimed] Already claimed: ${giveawayUrl} -> ${entry.steamUrl} (${entry.status})`);
    return true;
  }

  console.log(`[isGameAlreadyClaimed] Not yet claimed: ${giveawayUrl}`);
  return false;
}

function markGameAsClaimed(giveawayUrl, steamUrl, gameId, title, status) {
  db.data[cfg.steam_username] ||= {};
  db.data[cfg.steam_username][giveawayUrl] = {
    steamUrl,
    gameId,
    title,
    status,
    time: datetime()
  };
  console.log(`[markGameAsClaimed] Stored: ${giveawayUrl} -> ${steamUrl} (${status})`);
}

async function dumpHtml(pg, errorContext) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `/tmp/steam-debug-${timestamp}.html`;
    const html = await pg.content();
    fs.writeFileSync(filename, html);
    console.log(`HTML dumped to: ${filename}`);
    console.log(`Error context: ${errorContext}`);
    return filename;
  } catch (dumpError) {
    console.error('Failed to dump HTML:', dumpError.message);
    return null;
  }
}

// ============================================================================
// Fetch Giveaways (no browser needed)
// ============================================================================

async function fetchGamerPowerGiveaways() {
  console.log('Fetching giveaways from GamerPower API...');
  const response = await fetch(GAMERPOWER_API_URL);

  if (!response.ok) {
    throw new Error(`Failed to fetch GamerPower data: ${response.statusText}`);
  }

  const data = await response.json();

  // Handle "no active giveaways" response: {"status":0,"status_message":"No active giveaways available..."}
  if (!Array.isArray(data)) {
    if (data.status === 0 && data.status_message) {
      console.log(`GamerPower: ${data.status_message}`);
      return [];
    }
    throw new Error(`Unexpected GamerPower response: ${JSON.stringify(data)}`);
  }

  console.log(`Fetched ${data.length} giveaways from GamerPower`);
  return data;
}

function filterUnclaimedGiveaways(giveaways) {
  const unclaimed = giveaways.filter(item => !isGameAlreadyClaimed(item.open_giveaway_url));
  console.log(`${unclaimed.length} of ${giveaways.length} giveaways need to be claimed`);
  return unclaimed;
}

// ============================================================================
// Browser Functions
// ============================================================================

async function initBrowser() {
  console.log('Starting browser...');
  context = await chromium.launchPersistentContext(cfg.dir.browser, {
    headless: cfg.headless,
    locale: "en-US",
    recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined,
    recordHar: cfg.record ? { path: `data/record/eg-${datetime()}.har` } : undefined,
    handleSIGINT: false,
    args: [
      '--hide-crash-restore-bubble',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-webgpu',
    ],
  });

  page = context.pages().length ? context.pages()[0] : await context.newPage();
  console.log('Browser started');
}

async function closeBrowser() {
  if (context) {
    await context.close();
    console.log('Browser closed');
  }
}

async function doLogin() {
  const username = cfg.steam_username;
  const password = cfg.steam_password;

  if (username && password) {
    console.log('Using STEAM_USERNAME and STEAM_PASSWORD from config.');
    await page.waitForSelector('div[data-featuretarget=login] input', { timeout: 10000 });
    const inputs = await page.locator('div[data-featuretarget=login] input').all();

    if (inputs.length < 2) {
      throw new Error(`Expected 2 login inputs, found ${inputs.length}`);
    }

    await inputs[0].fill(username);
    await inputs[1].fill(password);
    const submitButton = await page.locator('div[data-featuretarget=login] button[type=submit]');
    await submitButton.click();

    await page.waitForTimeout(2000);
    await handleOTPIfNeeded();
  } else {
    console.log('No STEAM_USERNAME/PASSWORD provided. Please login via VNC (e.g. by scanning the QR code).');
    const waitingTime = cfg.login_timeout ? cfg.login_timeout / 1000 : 180;
    console.log(`Waiting up to ${waitingTime} seconds for you to login...`);
    try {
      // After logging in, Steam usually redirects back to the homepage, where #account_pulldown appears
      await page.waitForSelector('#account_pulldown', { timeout: cfg.login_timeout || 180000 });
      console.log('Manual login detected successfully.');
    } catch (e) {
      console.log('Timeout waiting for manual login. Continuing anyway, but checking login state may fail.');
    }
  }
}

async function handleOTPIfNeeded() {
  const otpInputs = await page.locator('div[data-featuretarget=login] form input[maxlength="1"]').all();

  if (otpInputs.length === 5) {
    console.log('OTP prompt detected. Please enter your 5-digit OTP code.');

    let otpCode = '';
    while (otpCode.length !== 5) {
      otpCode = await prompt({ message: 'Enter 5-digit OTP code' });
      if (otpCode.length !== 5) {
        console.log('OTP must be exactly 5 characters. Please try again.');
      }
    }

    for (let i = 0; i < 5; i++) {
      await otpInputs[i].fill(otpCode[i]);
    }

    console.log('OTP entered. Waiting for verification...');
    await page.waitForNavigation({ timeout: 30000 }).catch(() => {
      console.log('Navigation timeout after OTP entry, continuing...');
    });
  }
}

async function getLoginLink() {
  try {
    const loginLink = page.locator('a.global_action_link');
    const href = await loginLink.getAttribute('href', { timeout: 1000 });

    if (href && href.includes('/login/')) {
      return loginLink;
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function doLoginIfNeeded() {
  const loginLink = await getLoginLink();

  if (loginLink) {
    console.log('Not signed in to steam. Navigating to login page...');
    await loginLink.click();
    await page.waitForLoadState('networkidle');
    await doLogin();

    const stillNeedsLogin = await getLoginLink();
    if (stillNeedsLogin) {
      throw new Error('Login failed - still showing login link after login attempt');
    }

    console.log('Login completed successfully');
  }
}

async function ensureLoggedIn() {
  await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' });
  console.log('Navigated to Steam store page');

  // Decline cookies
  await context.addCookies([{
    name: 'cookieSettings',
    value: '%7B%22version%22%3A1%2C%22preference_state%22%3A2%2C%22content_customization%22%3Anull%2C%22valve_analytics%22%3Anull%2C%22third_party_analytics%22%3Anull%2C%22third_party_content%22%3Anull%2C%22utm_enabled%22%3Atrue%7D',
    domain: 'store.steampowered.com',
    path: '/'
  }]);

  await doLoginIfNeeded();

  user = await page.locator("#account_pulldown").first().innerText();
  console.log('Logged in as:', user);

  // Initialize user data structure
  db.data[cfg.steam_username] ||= {};
}

// ============================================================================
// Claiming Functions
// ============================================================================

async function claimGiveaway(giveaway) {
  const giveawayUrl = giveaway.open_giveaway_url;
  console.log(`\nProcessing: ${giveawayUrl}`);

  // Navigate to giveaway URL (will redirect to Steam)
  let steamUrl;
  try {
    await page.goto(giveawayUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    steamUrl = page.url();
  } catch (err) {
    console.log(`Failed to navigate to giveaway URL (e.g. adblocker blocked tracker): ${err.message}`);
    markGameAsClaimed(giveawayUrl, giveawayUrl, null, null, 'blocked_or_timeout');
    return;
  }

  // Check if it redirected to a Steam app page
  if (!steamUrl.includes("store.steampowered.com/app") && !steamUrl.includes("store.steampowered.com/agecheck/app")) {
    console.log(`Not a Steam game page: ${steamUrl}`);
    markGameAsClaimed(giveawayUrl, steamUrl, null, null, 'not_steam');
    return;
  }

  // Handle age gate if needed
  if (steamUrl.includes("agecheck/app")) {
    await handleAgeGate();
  }

  // Get game info
  const title = await page.locator('#appHubAppName').first().innerText();
  const game_id = extractGameIdFromUrl(page.url());

  console.log(`Game: ${title} (${game_id})`);

  const notify_game = { title, url: steamUrl, status: 'failed' };
  notify_games.push(notify_game);

  // Check if already owned
  const alreadyOwnedCount = await page.locator('.game_area_already_owned').count();
  if (alreadyOwnedCount > 0) {
    console.log(`Already in library: ${title}`);
    markGameAsClaimed(giveawayUrl, steamUrl, game_id, title, 'existed');
    notify_game.status = 'existed';
    return;
  }

  // Try to claim
  let claimed = false;

  // Try #freeGameBtn
  if (await page.locator('#freeGameBtn').count() > 0) {
    await page.click('#freeGameBtn');
    console.log("Claimed using #freeGameBtn");
    claimed = true;
  }

  // Try .btn_green_steamui.btn_medium[data-action="add_to_account"]
  if (!claimed) {
    const addBtn = page.locator('.btn_green_steamui.btn_medium[data-action="add_to_account"]');
    if (await addBtn.count() > 0 && (await addBtn.first().textContent()) === "Add to Account") {
      await addBtn.first().click();
      console.log("Claimed using add_to_account button");
      claimed = true;
    }
  }

  // Try button with "Add to Account" text (may be multiple green buttons on page)
  if (!claimed) {
    const greenBtns = page.locator('.btn_green_steamui.btn_medium');
    const count = await greenBtns.count();
    for (let i = 0; i < count; i++) {
      const btn = greenBtns.nth(i);
      const text = await btn.textContent();
      if (text?.trim() === "Add to Account") {
        await btn.click();
        console.log("Claimed using green button");
        claimed = true;
        break;
      }
    }
  }

  if (!claimed) {
    throw new Error(`Failed to claim game "${title}": No suitable claim button found`);
  }

  console.log(`Successfully claimed: ${title}`);
  markGameAsClaimed(giveawayUrl, steamUrl, game_id, title, 'claimed');
  notify_game.status = 'claimed';

  // Take screenshot
  const p = screenshot(`${game_id}.png`);
  if (!existsSync(p)) await page.screenshot({ path: p, fullPage: false });
}

async function handleAgeGate() {
  console.log('Handling age gate...');
  await page.waitForTimeout(1000);

  const ageGateVisible = await page.locator('.age_gate').count() > 0;
  if (!ageGateVisible) return;

  const daySelect = page.locator('#ageDay');
  if (await daySelect.count() > 0) {
    await daySelect.selectOption('21');
    await page.locator('#ageMonth').selectOption('January');
    await page.locator('#ageYear').selectOption('1990');
  }

  const viewBtn = page.locator('#view_product_page_btn');
  if (await viewBtn.count() > 0) {
    await viewBtn.click();
    await page.waitForLoadState('networkidle');
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  // Step 1: Fetch giveaways (no browser needed)
  const giveaways = await fetchGamerPowerGiveaways();
  const unclaimedGiveaways = filterUnclaimedGiveaways(giveaways);

  if (unclaimedGiveaways.length === 0) {
    console.log('No new giveaways to claim. Exiting.');
    await db.write();
    return;
  }

  // Step 2: Start browser only if there are games to claim
  await initBrowser();

  try {
    // Step 3: Login to Steam
    await ensureLoggedIn();

    // Step 4: Claim each giveaway
    for (const giveaway of unclaimedGiveaways) {
      await claimGiveaway(giveaway);
    }

    console.log('\nFinished claiming all giveaways');
    writeFileSync(`data/steam.json`, JSON.stringify(db.data, null, 2));

  } catch (error) {
    exceptionOccurred = true;
    await dumpHtml(page, `Exception: ${error.message}`);
    console.error(error);
    process.exitCode ||= 1;
    if (error.message && process.exitCode != 130) {
      notify(`steam failed: ${error.message.split('\n')[0]}`);
    }
  } finally {
    await db.write();

    if (notify_games.filter(g => g.status !== 'existed').length) {
      notify(`steam (${user}):<br>${html_game_list(notify_games)}`);
    }

    if (cfg.debug) {
      fs.writeFileSync(path.resolve(cfg.dir.browser, 'cookies.json'), JSON.stringify(await context.cookies()));
    }

    if (exceptionOccurred) {
      console.log('Exception occurred - keeping browser open for debugging. Press Ctrl+C to exit.');
      await new Promise(() => { });
    } else {
      await closeBrowser();
    }
  }
}

await main();