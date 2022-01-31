//@ts-check
const { chromium } = require('playwright'); // stealth plugin needs no outdated playwright-extra
const path = require('path');
const debug = process.env.PWDEBUG == '1'; // runs headful and opens https://playwright.dev/docs/inspector

// const URL_LOGIN = 'https://www.amazon.de/ap/signin'; // wrong. needs some session args to be valid?
const URL_CLAIM = 'https://gaming.amazon.com/home';
const TIMEOUT = 20 * 1000; // 20s, default is 30s

// could change to .mjs to get top-level-await, but would then also need to change require to import and dynamic import for stealth below would just add more async/await
(async () => {
  // https://playwright.dev/docs/auth#multi-factor-authentication
  const context = await chromium.launchPersistentContext(path.resolve(__dirname, 'userDataDir'), {
    channel: 'chrome', // https://playwright.dev/docs/browsers#google-chrome--microsoft-edge
    headless: false,
    viewport: { width: 1280, height: 1280 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36', // see replace of Headless in newStealthContext above. TODO update if browser is updated!
  });

  // stealth with playwright: https://github.com/berstend/puppeteer-extra/issues/454#issuecomment-917437212
  // https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth/evasions
  const enabledEvasions = [
    'chrome.app',
    'chrome.csi',
    'chrome.loadTimes',
    'chrome.runtime',
    // 'defaultArgs',
    'iframe.contentWindow',
    'media.codecs',
    'navigator.hardwareConcurrency',
    'navigator.languages',
    'navigator.permissions',
    'navigator.plugins',
    // 'navigator.vendor',
    'navigator.webdriver',
    'sourceurl',
    // 'user-agent-override', // doesn't work since playwright has no page.browser()
    'webgl.vendor',
    'window.outerdimensions'
  ];
  const evasions = enabledEvasions.map(e => new require(`puppeteer-extra-plugin-stealth/evasions/${e}`));
  const stealth = {
    callbacks: [],
    async evaluateOnNewDocument(...args) {
      this.callbacks.push({ cb: args[0], a: args[1] })
    }
  }
  evasions.forEach(e => e().onPageCreated(stealth));
  for (let evasion of stealth.callbacks) {
    await context.addInitScript(evasion.cb, evasion.a);
  }
  // end stealth setup

  if (!debug) context.setDefaultTimeout(TIMEOUT);
  // const page = /* context.pages().length ? context.pages[0] : */ await context.newPage();
  const page = context.pages()[0];
  console.log('userAgent:', await page.evaluate(() => navigator.userAgent));

  const clickIfExists = async selector => {
    if (await page.locator(selector).count() > 0)
      await page.click(selector);
  };

  await page.goto(URL_CLAIM, {waitUntil: 'domcontentloaded'}); // default 'load' takes forever
  await clickIfExists('[aria-label="Cookies usage disclaimer banner"] button:has-text("Accept Cookies")'); // to not waste screen space in --debug
  while (await page.locator('button:has-text("Sign in")').count() > 0) {
    console.error("Not signed in anymore. Please login and then navigate to the 'Free Games' page.");
    await page.click('button:has-text("Sign in")');
    if (!debug) context.setDefaultTimeout(0); // give user time to log in without timeout
    await page.waitForNavigation({url: 'https://gaming.amazon.com/home?signedIn=true'});
    if (!debug) context.setDefaultTimeout(TIMEOUT);
  }
  console.log('Signed in.');
  const game_sel = 'div[data-a-target="offer-list-FGWP_FULL"] .offer__action:has-text("Claim game")';
  await page.waitForSelector('div[data-a-target="offer-list-FGWP_FULL"]');
  const n = await page.locator(game_sel).count();
  console.log('Number of free unclaimed games:', n);
  console.log('Number of already claimed games:', await page.locator('div[data-a-target="offer-list-FGWP_FULL"] p:has-text("Claimed")').count());
  const games = await page.$$(game_sel);
  // for (let i=1; i<=n; i++) {
  for (const card of games) {
    // const card = page.locator(`:nth-match(${game_sel}, ${i})`); // this will reevaluate after games are claimed and index will be wrong
    // const title = await card.locator('h3').first().innerText();
    const title = await (await card.$('h3')).innerText();
    console.log('Current free game:', title);
    await (await card.$('button')).click();
    // await page.pause();
  }
  // claim games in linked stores. Origin: key, Epic Games Store: linked
  {
    const game_sel = 'div[data-a-target="offer-list-FGWP_FULL"] .offer__action:has(p:text-is("Claim"))';
    do {
      let n = await page.locator(game_sel).count();
      console.log('Number of free unclaimed games in external stores:', n);
      const card = await page.$(game_sel);
      if (!card) break;
      const title = await (await card.$('h3')).innerText();
      console.log('Current free game:', title);
      await (await card.$('button')).click();
      // await page.waitForNavigation();
      await page.click('button:has-text("Claim now")');
      // TODO only Origin shows a key, check for 'Claimed' or code
      const code = await page.inputValue('input');
      console.log('Code to redeem game:', code);
      // await page.pause();
      await page.goto(URL_CLAIM, {waitUntil: 'domcontentloaded'});
      n = await page.locator(game_sel).count();
    } while (n);
  }
  await context.close();
})();
