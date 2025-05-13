import { firefox } from 'playwright-firefox'; // stealth plugin needs no outdated playwright-extra
import { datetime, filenamify, prompt, handleSIGINT, stealth } from './src/util.js';
import { cfg } from './src/config.js';

// using https://github.com/apify/fingerprint-suite worked, but has no launchPersistentContext...
// from https://github.com/apify/fingerprint-suite/issues/162
import { FingerprintInjector } from 'fingerprint-injector';
import { FingerprintGenerator } from 'fingerprint-generator';

const { fingerprint, headers } = new FingerprintGenerator().getFingerprint({
    devices: ["mobile"],
    operatingSystems: ["android"],
});

const context = await firefox.launchPersistentContext(cfg.dir.browser, {
  headless: cfg.headless,
  // viewport: { width: cfg.width, height: cfg.height },
  locale: 'en-US', // ignore OS locale to be sure to have english text for locators -> done via /en in URL
  recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined, // will record a .webm video for each page navigated; without size, video would be scaled down to fit 800x800
  recordHar: cfg.record ? { path: `data/record/aliexpress-${filenamify(datetime())}.har` } : undefined, // will record a HAR file with network requests and responses; can be imported in Chrome devtools
  handleSIGINT: false, // have to handle ourselves and call context.close(), otherwise recordings from above won't be saved
  userAgent: fingerprint.navigator.userAgent,
  viewport: {
      width: fingerprint.screen.width,
      height: fingerprint.screen.height,
  },
  extraHTTPHeaders: {
      'accept-language': headers['accept-language'],
  },
});
handleSIGINT(context);
// await stealth(context);
await new FingerprintInjector().attachFingerprintToPlaywright(context, { fingerprint, headers });

context.setDefaultTimeout(cfg.debug ? 0 : cfg.timeout);

const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist

const auth = async (url) => {
  console.log('auth', url);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // redirects to https://login.aliexpress.com/?return_url=https%3A%2F%2Fwww.aliexpress.com%2Fp%2Fcoin-pc-index%2Findex.html
  await Promise.any([page.waitForURL(/.*login\.aliexpress.com.*/).then(async () => {
    // manual login
    console.error('Not logged in! Will wait for 120s for you to login...');
    // await page.waitForTimeout(120*1000);
    // or try automated
    page.locator('span:has-text("Switch account")').click().catch(_ => {}); // sometimes no longer logged in, but previous user/email is pre-selected -> in this case we want to go back to the classic login
    const login = page.locator('.login-container');
    const email = cfg.ae_email || await prompt({ message: 'Enter email' });
    const emailInput = login.locator('input[label="Email or phone number"]');
    await emailInput.fill(email);
    await emailInput.blur(); // otherwise Continue button stays disabled
    const continueButton = login.locator('button:has-text("Continue")');
    await continueButton.click({ force: true }); // normal click waits for button to no longer be covered by their suggestion menu, so we have to force click somewhere for the menu to close and then click
    await continueButton.click();
    const password = email && (cfg.ae_password || await prompt({ type: 'password', message: 'Enter password' }));
    await login.locator('input[label="Password"]').fill(password);
    await login.locator('button:has-text("Sign in")').click();
    const error = login.locator('.error-text');
    error.waitFor().then(async _ => console.error('Login error:', await error.innerText()));
    await page.waitForURL(url);
    // await page.addLocatorHandler(page.getByRole('button', { name: 'Accept cookies' }), btn => btn.click());
    page.getByRole('button', { name: 'Accept cookies' }).click().then(_ => console.log('Accepted cookies')).catch(_ => { });
  }), page.locator('#nav-user-account').waitFor()]).catch(_ => {});

  // await page.locator('#nav-user-account').hover();
  // console.log('Logged in as:', await page.locator('.welcome-name').innerText());
};

// copied URLs from AliExpress app on tablet which has menu for the used webview
const urls = {
  // works with desktop view, but stuck at 100% loading in mobile view:
  coins: 'https://www.aliexpress.com/p/coin-pc-index/index.html',
  // only work with mobile view:
  grow: 'https://m.aliexpress.com/p/ae_fruit/index.html', // firefox: stuck at 60% loading, chrome: loads, but canvas
  gogo: 'https://m.aliexpress.com/p/gogo-match-cc/index.html', // closes firefox?!
  // only show notification to install the app
  euro: 'https://m.aliexpress.com/p/european-cup/index.html', // doesn't load
  merge: 'https://m.aliexpress.com/p/merge-market/index.html',
};

const coins = async () => {
  // await auth(urls.coins);
  await Promise.any([page.locator('.checkin-button').click(), page.locator('.addcoin').waitFor()]);
  console.log('Coins:', await page.locator('.mycoin-content-right-money').innerText());
  console.log('Streak:', await page.locator('.title-box').innerText());
  console.log('Tomorrow:', await page.locator('.addcoin').innerText());
};

const grow = async () => {
  await page.pause();
};

const gogo = async () => {
  await page.pause();
};

const euro = async () => {
  await page.pause();
};

const merge = async () => {
  await page.pause();
};

try {
  // await coins();
  await [
    // coins,
    // grow,
    // gogo,
    // euro,
    merge,
  ].reduce((a, f) => a.then(async _ => { await auth(urls[f.name]); await f(); console.log() }), Promise.resolve());

  // await page.pause();
} catch (error) {
  process.exitCode ||= 1;
  console.error('--- Exception:');
  console.error(error); // .toString()?
}
if (page.video()) console.log('Recorded video:', await page.video().path());
await context.close();
