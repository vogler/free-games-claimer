// import { firefox } from 'playwright-firefox';
import { chromium } from 'patchright';
import { datetime, filenamify, prompt, handleSIGINT } from './src/util.js';
import { cfg } from './src/config.js';

// can probably be removed and hard-code headers for mobile view
import { FingerprintInjector } from 'fingerprint-injector';
import { FingerprintGenerator } from 'fingerprint-generator';

const { fingerprint, headers } = new FingerprintGenerator().getFingerprint({
  devices: ['mobile'],
  operatingSystems: ['android'],
});

const context = await chromium.launchPersistentContext(cfg.dir.browser, {
  headless: cfg.headless,
  // viewport: { width: cfg.width, height: cfg.height },
  locale: 'en-US', // ignore OS locale to be sure to have english text for locators -> done via /en in URL
  recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined, // will record a .webm video for each page navigated; without size, video would be scaled down to fit 800x800
  recordHar: cfg.record ? { path: `data/record/aliexpress-${filenamify(datetime())}.har` } : undefined, // will record a HAR file with network requests and responses; can be imported in Chrome devtools
  handleSIGINT: false, // have to handle ourselves and call context.close(), otherwise recordings from above won't be saved
  // e.g. for coins, mobile view is needed, otherwise it just says to install the app
  userAgent: fingerprint.navigator.userAgent,
  viewport: {
    width: fingerprint.screen.width,
    height: fingerprint.screen.height,
  },
  extraHTTPHeaders: {
    'accept-language': headers['accept-language'],
  },
  // https://peter.sh/experiments/chromium-command-line-switches/
  args: [
    '--hide-crash-restore-bubble',
  ],
});
handleSIGINT(context);
// await stealth(context);
await new FingerprintInjector().attachFingerprintToPlaywright(context, { fingerprint, headers });

context.setDefaultTimeout(cfg.debug ? 0 : cfg.timeout);

const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist

const auth = async url => {
  console.log('auth', url);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // redirects to https://login.aliexpress.com/?return_url=https%3A%2F%2Fwww.aliexpress.com%2Fp%2Fcoin-pc-index%2Findex.html
  await Promise.any([page.waitForURL(/.*login\.aliexpress.com.*/).then(async () => {
    // manual login
    console.error('Not logged in! Will wait for 120s for you to login in the browser or terminal...');
    context.setDefaultTimeout(120 * 1000);
    // or try automated
    page.locator('span:has-text("Switch account")').click().catch(_ => {}); // sometimes no longer logged in, but previous user/email is pre-selected -> in this case we want to go back to the classic login
    const login = page.locator('#root'); // not universal: .content, .nfm-login
    const email = cfg.ae_email || await prompt({ message: 'Enter email' });
    const emailInput = login.locator('input[label="Email or phone number"]');
    await emailInput.fill(email);
    await emailInput.blur(); // otherwise Continue button stays disabled
    const continueButton = login.locator('button:has-text("Continue")');
    await continueButton.click({ force: true }); // normal click waits for button to no longer be covered by their suggestion menu, so we have to force click somewhere for the menu to close and then click
    const password = email && (cfg.ae_password || await prompt({ type: 'password', message: 'Enter password' }));
    await login.locator('input[label="Password"]').fill(password);
    await login.locator('button:has-text("Sign in")').click();
    const error = login.locator('.nfm-login-input-error-text');
    error.waitFor().then(async _ => console.error('Login error (please restart):', await error.innerText())).catch(_ => console.log('No login error.'));
    await page.waitForURL(u => u.toString().startsWith(url)); // e.g. https://m.aliexpress.com/p/coin-index/index.html?_immersiveMode=true&from=pc302
    // TODO the following won't be executed anymore due to the navigation - patchright issue?
    context.setDefaultTimeout(cfg.debug ? 0 : cfg.timeout);
    console.log('Logged in!'); // this should still be printed, but isn't...
    // await page.addLocatorHandler(page.getByRole('button', { name: 'Accept cookies' }), btn => btn.click());
    // page.getByRole('button', { name: 'Accept cookies' }).click().then(_ => console.log('Accepted cookies')).catch(_ => { });
  }), page.locator('.app-game').waitFor()]);
};

// copied URLs from AliExpress app on tablet which has menu for the used webview
const urls = {
  // only work with mobile view:
  coins: 'https://www.aliexpress.com/p/coin-pc-index/index.html',
  grow: 'https://m.aliexpress.com/p/ae_fruit/index.html', // firefox: stuck at 60% loading, chrome: loads, but canvas
  gogo: 'https://m.aliexpress.com/p/gogo-match-cc/index.html', // closes firefox?!
  // only show notification to install the app
  euro: 'https://m.aliexpress.com/p/european-cup/index.html', // doesn't load
  merge: 'https://m.aliexpress.com/p/merge-market/index.html',
};

const coins = async () => {
  console.log('Checking coins...');
  const collectBtn = page.locator('.signVersion-panel div:has-text("Collect")').first();
  const moreBtn = page.locator('.signVersion-panel div:has-text("Earn more coins")').first();
  await Promise.any([
    collectBtn.click().then(_ => console.log('Collected coins for today!')),
    moreBtn.waitFor().then(_ => console.log('No more coins to collect today!')),
  ]); // sometimes did not make it click the collect button... moreBtn.isVisible() as alternative also didn't work
  // await collectBtn.click().catch(_ => moreBtn.waitFor()); // TODO change this since it's going to delay by timeout if already collected
  console.log(await page.locator('.marquee-content:has-text(" coins")').first().innerText());
  const n = (await page.locator('.marquee-item:has-text(" coins")').first().innerText()).replace(' coins', '');
  console.log('Coins:', n);
  // console.log('Streak:', await page.locator('.title-box').innerText());
  // console.log('Tomorrow:', await page.locator('.addcoin').innerText());
};

// const grow = async () => {
//   await page.pause();
// };
//
// const gogo = async () => {
//   await page.pause();
// };
//
// const euro = async () => {
//   await page.pause();
// };
//
// const merge = async () => {
//   await page.pause();
// };

try {
  // await coins();
  await [
    coins,
    // grow,
    // gogo,
    // euro,
    // merge,
  ].reduce((a, f) => a.then(async _ => {
    await auth(urls[f.name]);
    await f();
    console.log();
  }), Promise.resolve());

  // await page.pause();
} catch (error) {
  process.exitCode ||= 1;
  console.error('--- Exception:');
  console.error(error); // .toString()?
}
if (page.video()) console.log('Recorded video:', await page.video().path());
await context.close();
