import { firefox } from 'playwright-firefox'; // stealth plugin needs no outdated playwright-extra
import path from 'path';
import { resolve, jsonDb, datetime, filenamify, prompt, notify, html_game_list, handleSIGINT } from './util.js';
import { cfg } from './config.js';
import { existsSync } from "fs";

const screenshot = (...a) => resolve(cfg.dir.screenshots, 'gog', ...a);

const URL_CLAIM = 'https://www.gog.com/en';

console.log(datetime(), 'started checking gog');

const db = await jsonDb('gog.json', {});

// https://playwright.dev/docs/auth#multi-factor-authentication
const context = await firefox.launchPersistentContext(cfg.dir.browser, {
  headless: cfg.headless,
  viewport: { width: cfg.width, height: cfg.height },
  locale: "en-US", // ignore OS locale to be sure to have english text for locators -> done via /en in URL
  recordVideo: cfg.record ? { dir: path.resolve('data/record/'), size: { width: cfg.width, height: cfg.height } } : undefined, // will record a .webm video for each page navigated; without size, video would be scaled down to fit 800x800
  recordHar: cfg.record ? { path: `data/record/gog-${datetime()}.har` } : undefined, // will record a HAR file with network requests and responses; can be imported in Chrome devtools
  handleSIGINT: false, // have to handle ourselves and call context.close(), otherwise recordings from above won't be saved
});

handleSIGINT(context);

if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);

const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist
// console.debug('userAgent:', await page.evaluate(() => navigator.userAgent));

const notify_games = [];
let user;

try {
  await context.addCookies([{name: 'CookieConsent', value: '{stamp:%274oR8MJL+bxVlG6g+kl2we5+suMJ+Tv7I4C5d4k+YY4vrnhCD+P23RQ==%27%2Cnecessary:true%2Cpreferences:true%2Cstatistics:true%2Cmarketing:true%2Cmethod:%27explicit%27%2Cver:1%2Cutc:1672331618201%2Cregion:%27de%27}', domain: 'www.gog.com', path: '/'}]); // to not waste screen space when non-headless

  await page.goto(URL_CLAIM, { waitUntil: 'domcontentloaded' }); // default 'load' takes forever

  // page.click('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll').catch(_ => { }); // does not work reliably, solved by setting CookieConsent above
  const signIn = page.locator('a:has-text("Sign in")').first();
  await Promise.any([signIn.waitFor(), page.waitForSelector('#menuUsername')]);
  while (await signIn.isVisible()) {
    console.error('Not signed in anymore.');
    await signIn.click();
    // it then creates an iframe for the login
    await page.waitForSelector('#GalaxyAccountsFrameContainer iframe'); // TODO needed?
    const iframe = page.frameLocator('#GalaxyAccountsFrameContainer iframe');
    if (!cfg.debug) context.setDefaultTimeout(cfg.login_timeout); // give user some extra time to log in
    console.info(`Login timeout is ${cfg.login_timeout/1000} seconds!`);
    if (cfg.gog_email && cfg.gog_password) console.info('Using email and password from environment.');
    else console.info('Press ESC to skip the prompts if you want to login in the browser (not possible in headless mode).');
    const email = cfg.gog_email || await prompt({message: 'Enter email'});
    const password = email && (cfg.gog_password || await prompt({type: 'password', message: 'Enter password'}));
    if (email && password) {
      iframe.locator('a[href="/logout"]').click().catch(_ => { }); // Click 'Change account' (email from previous login is set in some cookie)
      await iframe.locator('#login_username').fill(email);
      await iframe.locator('#login_password').fill(password);
      await iframe.locator('#login_login').click();
      // handle MFA, but don't await it
      iframe.locator('form[name=second_step_authentication]').waitFor().then(async () => {
        console.log('Two-Step Verification - Enter security code');
        console.log(await iframe.locator('.form__description').innerText());
        const otp = await prompt({type: 'text', message: 'Enter two-factor sign in code', validate: n => n.toString().length == 4 || 'The code must be 4 digits!'}); // can't use type: 'number' since it strips away leading zeros and codes sometimes have them
        await iframe.locator('#second_step_authentication_token_letter_1').pressSequentially(otp.toString(), {delay: 10});
        await iframe.locator('#second_step_authentication_send').click();
        await page.waitForTimeout(1000); // TODO still needed with wait for username below?
      }).catch(_ => { });
      // iframe.locator('iframe[title=reCAPTCHA]').waitFor().then(() => {
      // iframe.locator('.g-recaptcha').waitFor().then(() => {
      iframe.locator('text=Invalid captcha').waitFor().then(() => {
        console.error('Got a captcha during login (likely due to too many attempts)! You may solve it in the browser, get a new IP or try again in a few hours.');
        notify('gog: got captcha during login. Please check.');
        // TODO solve reCAPTCHA?
      }).catch(_ => { });
      await page.waitForSelector('#menuUsername');
    } else {
      console.log('Waiting for you to login in the browser.');
      await notify('gog: no longer signed in and not enough options set for automatic login.');
      if (cfg.headless) {
        console.log('Run `SHOW=1 node gog` to login in the opened browser.');
        await context.close();
        process.exit(1);
      }
    }
    await page.waitForSelector('#menuUsername');
    if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);
  }
  user = await page.locator('#menuUsername').first().textContent(); // innerText is uppercase due to styling!
  console.log(`Signed in as ${user}`);
  db.data[user] ||= {};

  if (cfg.gog_giveaway) {
    await claimGiveaway();
  }
  if (cfg.gog_freegames) {
    await claimFreegames();
  }
} catch (error) {
  process.exitCode ||= 1;
  console.error('--- Exception:');
  console.error(error); // .toString()?
  if (error.message && process.exitCode != 130)
    notify(`gog failed: ${error.message.split('\n')[0]}`);
} finally {
  await db.write(); // write out json db
  if (notify_games.filter(g => g.status != 'existed').length) { // don't notify if all were already claimed
    notify(`gog (${user}):<br>${html_game_list(notify_games)}`);
  }
}

async function claimGiveaway() {
  console.log("Claiming giveaway");
  const banner = page.locator('#giveaway');
  if (!await banner.count()) {
    console.log('Currently no free giveaway!');
  } else {
    const text = await page.locator('.giveaway-banner__title').innerText();
    const title = text.match(/Claim (.*)/)[1];
    const slug = await banner.getAttribute('href');
    const url = `https://gog.com${slug}`;
    console.log(`Current free game: ${title} - ${url}`);
    db.data[user][title] ||= { title, time: datetime(), url };
    if (cfg.dryrun) process.exit(1);
    await page.locator('#giveaway:not(.is-loading)').waitFor(); // otherwise screenshot is sometimes with loading indicator instead of game title
    await banner.screenshot({ path: screenshot(`${filenamify(title)}.png`) }); // overwrites every time - only keep first?

    // await banner.getByRole('button', { name: 'Add to library' }).click();
    // instead of clicking the button, we visit the auto-claim URL which gives as a JSON response which is easier than checking the state of a button
    await page.goto('https://www.gog.com/giveaway/claim');
    const response = await page.innerText('body');
    // console.log(response);
    // {} // when successfully claimed
    // {"message":"Already claimed"}
    // {"message":"Unauthorized"}
    // {"message":"Giveaway has ended"}
    let status;
    if (response == '{}') {
      status = 'claimed';
      console.log('  Claimed successfully!');
    } else {
      const message = JSON.parse(response).message;
      if (message == 'Already claimed') {
        status = 'existed'; // same status text as for epic-games
        console.log('  Already in library! Nothing to claim.');
      } else {
        console.log(response);
        status = message;
      }
    }
    db.data[user][title].status ||= status;
    notify_games.push({ title, url, status });

    if (status == 'claimed' && !cfg.gog_newsletter) {
      console.log("Unsubscribe from 'Promotions and hot deals' newsletter");
      await page.goto('https://www.gog.com/en/account/settings/subscriptions');
      await page.locator('li:has-text("Marketing communications through Trusted Partners") label').uncheck();
      await page.locator('li:has-text("Promotions and hot deals") label').uncheck();
    }
  }
}

async function claimGame(url){
  await page.goto(url, { waitUntil: 'networkidle' });

  const title = await page.locator("h1").first().innerText();

  const ageGateButton = page.locator("button.age-gate__button").first();
  if (await ageGateButton.isVisible()) {
    await ageGateButton.click();
  }

  const game_id = page
      .url()
      .split("/")
      .filter((x) => !!x)
      .pop();
    db.data[user][game_id] ||= { title, time: datetime(), url: page.url() }; // this will be set on the initial run only!
    console.log("Current free game:", title);
    const notify_game = { title, url, status: "failed" };
    notify_games.push(notify_game); // status is updated below

    const playforFree = page
        .locator('a.cart-button:visible')
        .first();
    const addToCart = page
        .locator('button.cart-button:visible')
        .first();
    const inLibrary = page
        .locator("button.go-to-library-button")
        .first();
    const inCart = page
        .locator('.cart-button__state-in-cart:visible')
        .first();

    await Promise.any([playforFree.waitFor(), addToCart.waitFor(), inCart.waitFor(), inLibrary.waitFor()]);

    if (await inLibrary.isVisible()) {
        console.log("Already in library! Nothing to claim.");
        notify_game.status = "existed";
        db.data[user][game_id].status ||= "existed"; // does not overwrite claimed or failed
        await db.write();
    } else if (await inCart.isVisible() || await addToCart.isVisible() || await playforFree.isVisible()) {
      if (await inCart.isVisible()) {
        console.log("Not in library yet! But in cart.");
        await inCart.click();
      } else if (await addToCart.isVisible()) {
        console.log("Not in library yet! Click ADD TO CART.");

        await addToCart.click();
        await inCart.isVisible();
        await inCart.click();
      } else if (await playforFree.isVisible()) {
        console.log("Play For Free. Can't be added to library!" + url);
        return;
      }

      await page.waitForURL('**/checkout/**');
      if (await page.locator('.order-message--error').isVisible()) {
        console.log("skipping : " + await page.locator('.order-message--error').innerText());
        await page.locator('span[data-cy="product-remove-button"]').click();
        return;
      }

      await page.locator('button[data-cy="payment-checkout-button"]').click();

      await page.waitForURL('**/order/status/**');
      await page.locator('p[data-cy="order-message"]').isVisible();
      
      notify_game.status = "claimed";
      db.data[user][game_id].status = "claimed";
      db.data[user][game_id].time = datetime(); // claimed time overwrites failed/dryrun time
      console.log("Claimed successfully!");
      await db.write();
    }

    const p = path.resolve(cfg.dir.screenshots, 'gog', `${game_id}.png`);
    if (!existsSync(p)) await page.screenshot({ path: p, fullPage: false }); // fullPage is quite long...
}

async function claimFreegames(){
  var freegames_url = cfg.gog_freegames_url;
  if (freegames_url.includes("&hideOwned=true")) {
    freegames_url = freegames_url.replace("&hideOwned=true", "");
  }
  if (!freegames_url.includes("priceRange=0,0")) {
    console.log("Filter for only free games not detected adding it manually.");
    freegames_url = freegames_url + "&priceRange=0,0";
  }
  console.log("claiming freegames from " + freegames_url);

  await page.goto(freegames_url, { waitUntil: 'networkidle' });
  await page.locator('label[selenium-id="hideOwnedCheckbox"]').click(); // when you add it to url immediately it shows more results
  await page.waitForTimeout(2500);
  var allLinks = [];
  var hasMorePages = true;
  do {
    const links = await page.locator(".product-tile").all();
    const gameUrls = await Promise.all(
        links.map(async (game) => {
          var urlSlug = await game.getAttribute("href");
          return urlSlug;
      })
    );
    for (const url of gameUrls) {
      allLinks.push(url);
    }
    if (await page.locator('.small-pagination__item--next.disabled').isVisible()){
      hasMorePages = false;
      console.log("last page");
    } else {
      await page.locator(".small-pagination__item--next").first().click();
      console.log("next page - waiting");
      await page.waitForTimeout(5000); // wait until page is loaded it takes some time with filters
    }
    
  } while (hasMorePages);
  console.log("Found total games: " + allLinks.length);
  allLinks = allLinks.filter(function (str) { return !str.endsWith("_prologue"); });
  allLinks = allLinks.filter(function (str) { return !str.endsWith("_demo"); });
  console.log("Filtered count: " + allLinks.length);

  for (const url of allLinks)
    {
        if (!isClaimedUrl(url))
        {
          console.log(url);
          await claimGame(url);
        }
    }
}

function isClaimedUrl(url) {
    try {
        var status = db.data[user][url.split("/").filter((x) => !!x).pop()]["status"];
        if (status === "existed" || status === "claimed") {
            return true;
        } else {
            return false;
        }
    } catch (error) {
        return false;
    }
}

if (page.video()) console.log('Recorded video:', await page.video().path());
await context.close();
