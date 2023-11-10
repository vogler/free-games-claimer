import { firefox } from "playwright-firefox"; // stealth plugin needs no outdated playwright-extra
import { authenticator } from "otplib";
import {
  datetime,
  handleSIGINT,
  html_game_list,
  jsonDb,
  notify,
  prompt,
  stealth,
} from "./util.js";
import path from "path";
import { existsSync } from "fs";
import { cfg } from "./config.js";

// ### SETUP
const URL_CLAIM = "https://www.playstation.com/" + cfg.ps_locale + "/ps-plus/whats-new/";

console.log(datetime(), "started checking playstation");

const db = await jsonDb("playstation.json", {});
db.data ||= {};

handleSIGINT();

const notify_games = [];
let user;
let page;
let context;
setup();

export async function setup() {
  // https://playwright.dev/docs/auth#multi-factor-authentication
  context = await firefox.launchPersistentContext(cfg.dir.browser, {
    // chrome will not work in linux arm64, only chromium
    // channel: 'chrome', // https://playwright.dev/docs/browsers#google-chrome--microsoft-edge
    headless: cfg.headless,
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

  page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist
  startPlaystation();
}

async function startPlaystation() {
  try {
    await performLogin();
    await getAndSaveUser();
    if (cfg.ps_plus_games) {
      await claimPSPlusGames();
    }
    if (cfg.ps_game_catalog) {
      await claimGameCatalog();
    }
    if (cfg.ps_classics_catalog) {
      console.log("NOT IMPLEMENTED");
      // for some reason these games are not linked on the website so we would need to search for them manually?
    }
  } catch (error) {
    console.error(error);
    process.exitCode ||= 1;
    if (error.message && process.exitCode != 130)
      notify(`playstation failed: ${error.message.split("\n")[0]}`);
  } finally {
    await db.write(); // write out json db
    if (notify_games.filter((g) => g.status != "existed").length) {
      // don't notify if all were already claimed
      notify(
        `playstation (${user}):<br>${html_game_list(notify_games)}`
      );
    }
    if (page.video()) console.log('Recorded video:', await page.video().path());
    await context.close();
  }
}

async function performLogin() {
  // the page gets stuck sometimes and requires a reload
  await page.goto(URL_CLAIM, { waitUntil: "domcontentloaded" });

  const signInLocator = page.locator('button[data-track-click="web:select-sign-in-button"]').first();
  const profileIconLocator = page.locator(".profile-icon").first();

  const mainPageBaseUrl = "https://playstation.com";
  const loginPageBaseUrl = "https://my.account.sony.com";

  async function isSignedIn() {
    await Promise.any([
      signInLocator.waitFor(),
      profileIconLocator.waitFor(),
    ]);
    return !(await signInLocator.isVisible());
  }

  if (!(await isSignedIn())) {
    await signInLocator.click();

    await page.waitForLoadState("networkidle");

    if (await page.url().indexOf(mainPageBaseUrl) === 0) {
      if (await isSignedIn()) {
        return; // logged in using saved cookie
      } else {
        console.error("stuck in login loop, try clearing cookies");
      }
    } else if (await page.url().indexOf(loginPageBaseUrl) === 0) {
      console.error("Not signed in anymore.");
      await signInToPSN();
      await page.waitForURL(URL_CLAIM);
      if (!(await isSignedIn())) {
        console.log("Login attempt failed. Trying again.");
        return await performLogin();
      }
    } else {
      console.error("lost! where am i?", await page.url());
    }
  }
}

async function signInToPSN() {
  await page.waitForSelector("#kekka-main");
  if (!cfg.debug) context.setDefaultTimeout(cfg.login_timeout); // give user some extra time to log in
  console.info(`Login timeout is ${cfg.login_timeout / 1000} seconds!`);

  // ### FETCH EMAIL/PASS
  if (cfg.ps_email && cfg.ps_password)
    console.info("Using email and password from environment.");
  else
    console.info(
      "Press ESC to skip the prompts if you want to login in the browser (not possible in headless mode)."
    );
  const email = cfg.ps_email || (await prompt({ message: "Enter email" }));
  const password =
    email &&
    (cfg.ps_password ||
      (await prompt({
        type: "password",
        message: "Enter password",
      })));

  // ### FILL IN EMAIL/PASS
  if (email && password) {
    await page.locator("#signin-entrance-input-signinId").fill(email);
    await page.locator("#signin-entrance-button").click(); // Next button
    await page.waitForSelector("#signin-password-input-password");
    await page.locator("#signin-password-input-password").fill(password);
    await page.locator("#signin-password-button").click();

    // ### CHECK FOR CAPTCHA
    page.frameLocator('iframe[title="Verification challenge"]').locator("#FunCaptcha")
      .waitFor()
      .then(() => {
        console.error(
          "Got a captcha during login (likely due to too many attempts)! You may solve it in the browser, get a new IP or try again in a few hours."
        );
        notify(
          "playstation: got captcha during login. Please check."
        );
      })
      .catch((_) => { });

    // handle MFA
    await page.locator('input[title="Enter Code"]');
    console.log("Two-Step Verification - Enter security code");
    console.log(await page.locator(".description-regular").innerText());
    const otp =
      (cfg.ps_otpkey &&
        authenticator.generate(cfg.ps_otpkey)) ||
      (await prompt({
        type: "text",
        message: "Enter two-factor sign in code",
        validate: (n) =>
          n.toString().length == 6 ||
          "The code must be 6 digits!",
      })); // can't use type: 'number' since it strips away leading zeros and codes sometimes have them
    await page.type('input[title="Enter Code"]', otp.toString());
    await page
      .locator(".checkbox-container")
      .locator("button")
      .first()
      .click(); // Trust this Browser
    await page.click("button.primary-button");
  } else {
    console.log("Waiting for you to login in the browser.");
    await notify(
      "playstation: no longer signed in and not enough options set for automatic login."
    );
    if (cfg.headless) {
      console.log(
        "Run `SHOW=1 node playstation` to login in the opened browser."
      );
      await context.close();
      process.exit(1);
    }
  }
  if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);
}

async function getAndSaveUser() {
  user = await page.locator(".psw-c-secondary").innerText();
  console.log(`Signed in as '${user}'`);
  db.data[user] ||= {};
}

async function purchaseFromCart() {
  const iFrame = await page.frameLocator('iframe[name="embeddedcart"]');
  const totalPrice = await iFrame.locator("#total-price .summary__row--value").innerText();

  if (totalPrice.includes("0,00") && totalPrice.length == 5) {
    console.log("Actually free game");
    await iFrame.locator(".password-prompt__input").fill(cfg.ps_password);
    await iFrame.locator("#verification-ImmediatePaymentWarning").click();
    await iFrame.locator(".confirm-purchase__button").click();
  } else {
    console.log("Something seems to be wrong with the total price '" + totalPrice + "' expecting 0,00 and 5 length");
  }
}

async function claimGame(url) {
  console.log("Open: " + url);
  await page.goto(url, { waitUntil: 'networkidle' });

  if (await page.url().includes("/error")) {
    console.log("Landed on an error page. The game might not exist in your region. Skipping.");
    return;
  }
  const signInLocator = page.locator('button[data-track-click="web:select-sign-in-button"]').first();

  if (await signInLocator.isVisible()) {
    console.log("lost the login - trying to recover");
    await performLogin();
    await claimGame(url);
    return;
  }

  let prefix;
  if (url.includes("store.playstation.com")) {
    const gameDiv = await page.locator(".psw-l-anchor").first();
    if (gameDiv.isVisible()) {
      prefix = ".psw-l-anchor ";
    }
    else {
      prefix = ".psw-l-grid ";
    }
  } else {
    prefix = ".gamehero ";
  }

  const title = await page.locator(prefix + "h1").first().innerText();

  const game_id = page
    .url()
    .split("/")
    .filter((x) => !!x)
    .pop();
  db.data[user][game_id] ||= { title, time: datetime(), url: page.url() }; // this will be set on the initial run only!
  console.log("Current title:", title);
  const notify_game = { title, url, status: "failed" };
  notify_games.push(notify_game); // status is updated below

  // SELECTORS
  const purchased = page
    .locator(prefix + 'a[data-track-click="ctaWithPrice:download"]:visible')
    .first();
  const addToCart = page   // the base game may not be the free one, look for any edition
    .locator(prefix + 'button[data-track-click="ctaWithPrice:addToCart"]:visible')
    .first();
  const inCart = page   // the base game may not be the free one, look for any edition
    .locator(prefix + 'button[data-track-click="ctaWithPrice:inCart"]:visible')
    .first();
  const addToLibrary = page   // the base game may not be the free one, look for any edition
    .locator(prefix + 'button[data-track-click="ctaWithPrice:addToLibrary"]:visible')
    .first();
  const cantPurchase = page   // the base game may not be the free one, look for any edition
    .locator(prefix + 'span[data-qa="mfeCtaMain#cantPurchaseText"]:visible')
    .first();

  await Promise.any([addToCart.waitFor(), inCart.waitFor(), addToLibrary.waitFor(), purchased.waitFor(), cantPurchase.waitFor()]);

  if (await purchased.isVisible() || await cantPurchase.isVisible()) {
    console.log("Already in library! Nothing to claim.");
    notify_game.status = "existed";
    db.data[user][game_id].status ||= "existed"; // does not overwrite claimed or failed
    await db.write();
  } else if (await inCart.isVisible()) {
    console.log("Not in library yet! But in cart.");
    await inCart.click();

    await purchaseFromCart();

    await purchased.waitFor();
    notify_game.status = "claimed";
    db.data[user][game_id].status = "claimed";
    db.data[user][game_id].time = datetime(); // claimed time overwrites failed/dryrun time
    console.log("Claimed successfully!");
    await db.write();
  } else if (await addToLibrary.isVisible()) {
    console.log("Not in library yet! Click ADD TO LIBRARY.");
    await addToLibrary.click();

    await Promise.any([purchased.waitFor(), cantPurchase.waitFor()]);
    notify_game.status = "claimed";
    db.data[user][game_id].status = "claimed";
    db.data[user][game_id].time = datetime(); // claimed time overwrites failed/dryrun time
    console.log("Claimed successfully!");
    await db.write();
  } else if (await addToCart.isVisible()) {
    console.log("Not in library yet! Click ADD TO CART.");
    const psIcon = await page.locator(prefix + "span[data-qa='mfeCtaMain#offer0#serviceIcon#ps-plus']").first();
    if (!await psIcon.isVisible()) {
      console.log("No PS+ icon present. The game might not be free in your region. Skipping.");
      const p = path.resolve(cfg.dir.screenshots, 'playstation', `${game_id}.png`);
      if (!existsSync(p)) await page.screenshot({ path: p, fullPage: false });
      return;
    }
    await addToCart.click();

    await purchaseFromCart();

    await Promise.any([purchased.waitFor(), cantPurchase.waitFor()]);
    notify_game.status = "claimed";
    db.data[user][game_id].status = "claimed";
    db.data[user][game_id].time = datetime(); // claimed time overwrites failed/dryrun time
    console.log("Claimed successfully!");
    await db.write();
  }

  notify_game.status = db.data[user][game_id].status; // claimed or failed

  const p = path.resolve(cfg.dir.screenshots, 'playstation', `${game_id}.png`);
  if (!existsSync(p)) await page.screenshot({ path: p, fullPage: false });
}

async function claimPSPlusGames() {
  // ### GET LIST OF FREE GAMES
  console.log("Claim PS+ games");
  const monthlyGamesBlock = await page.locator(
    ".cmp-experiencefragment--your-latest-monthly-games"
  );
  const monthlyGamesLocator = await monthlyGamesBlock.locator(".box").all();

  const monthlyGamesPageLinks = await Promise.all(
    monthlyGamesLocator.map(async (el) => {
      const urlSlug = await el
        .locator(".cta__primary")
        .getAttribute("href");
      // standardize URLs
      return (urlSlug.charAt(0) === "/"
        ? `https://www.playstation.com${urlSlug}`   // base url may not be present, add it back
        : urlSlug)
        .split('#').shift();  // url may have anchor tag, remove it
    })
  );
  console.log("PS+ games:", monthlyGamesPageLinks);

  for (const url of monthlyGamesPageLinks) {
    if (!isClaimedUrl(url)) {
      await claimGame(url);
    }
  }
}

async function claimGameCatalog() {
  console.log("Claim game catalog");
  await page.goto("https://www.playstation.com/" + cfg.ps_locale + "/ps-plus/games/#game-cat-a-z");

  const catalogGames = await page.locator(".autogameslist a").all();

  const catalogGameUrls = await Promise.all(
    catalogGames.map(async (catalogGame) => {
      const urlSlug = await catalogGame.getAttribute("href");
      return urlSlug.replace("en-gb", cfg.ps_locale).replace("en-us", cfg.ps_locale).substring(0, urlSlug.indexOf("?"));
    })
  );
  console.log("Total catalog games:", catalogGameUrls.length);
  const filteredCatalogGameUrls = catalogGameUrls.filter(function (url) { return !isClaimedUrl(url); }).sort();
  console.log("Non claimed catalog games:", filteredCatalogGameUrls.length, "Hint: Not all of the games are free in your region.");

  for (const url of filteredCatalogGameUrls) {
    await claimGame(url);
  }
}

function isClaimedUrl(url) {
  try {
    const status = db.data[user][url.split("/").filter((x) => !!x).pop()]["status"];
    return status === "existed" || status === "claimed";
  } catch (error) {
    return false;
  }
}
