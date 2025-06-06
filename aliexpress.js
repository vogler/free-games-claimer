// import { chromium } from 'patchright';
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
  locale: 'en-US', // always use English for locator texts
  recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined,
  recordHar: cfg.record ? { path: `data/record/aliexpress-${filenamify(datetime())}.har` } : undefined,
  handleSIGINT: false,
  userAgent: fingerprint.navigator.userAgent,
  viewport: {
    width: fingerprint.screen.width,
    height: fingerprint.screen.height,
  },
  extraHTTPHeaders: {
    'accept-language': headers['accept-language'],
  },
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
  await Promise.any([page.waitForURL(/.*login\.aliexpress.com.*/).then(async () => {
    console.error('Not logged in! Will wait for 120s for you to login in the browser or terminal...');
    context.setDefaultTimeout(120 * 1000);
    page.locator('span:has-text("Switch account")').click().catch(_ => {});
    const login = page.locator('#root');
    const email = cfg.ae_email || await prompt({ message: 'Enter email' });
    const emailInput = login.locator('input[label="Email or phone number"]');
    await emailInput.fill(email);
    await emailInput.blur();
    const continueButton = login.locator('button:has-text("Continue")');
    await continueButton.click({ force: true });
    const password = email && (cfg.ae_password || await prompt({ type: 'password', message: 'Enter password' }));
    await login.locator('input[label="Password"]').fill(password);
    await login.locator('button:has-text("Sign in")').click();
    const error = login.locator('.nfm-login-input-error-text');
    error.waitFor().then(async _ => console.error('Login error (please restart):', await error.innerText())).catch(_ => console.log('No login error.'));
    await page.waitForURL(u => u.toString().startsWith(url));
    context.setDefaultTimeout(cfg.debug ? 0 : cfg.timeout);
    console.log('Logged in!');
  }), page.locator('.app-game').waitFor()]);
};

// copied URLs from AliExpress app on tablet which has menu for the used webview
const urls = {
  coins: 'https://www.aliexpress.com/p/coin-pc-index/index.html',
  grow: 'https://m.aliexpress.com/p/ae_fruit/index.html',
  gogo: 'https://m.aliexpress.com/p/gogo-match-cc/index.html',
  euro: 'https://m.aliexpress.com/p/european-cup/index.html',
  merge: 'https://m.aliexpress.com/p/merge-market/index.html',
};

// Function to check and click the hideDoubleButton inside the modal if present
const clickHideDoubleButtonIfVisible = async () => {
  try {
    const modal = page.locator('.DoubleSignSelectModal');
    if (await modal.isVisible({ timeout: 3000 })) {
      const btn = modal.locator('.hideDoubleButton');
      if (await btn.isVisible()) {
        await btn.click();
        console.log('hideDoubleButton was found and clicked.');
      } else {
        console.log('hideDoubleButton is not visible inside the modal.');
      }
    } else {
      console.log('DoubleSignSelectModal is not visible.');
    }
  } catch (err) {
    console.error('Error while clicking hideDoubleButton:', err);
  }
};

const coins = async () => {
  console.log('Checking coins...');
  const collectBtn = page.locator('.signVersion-panel div:has-text("Collect")').first();
  const moreBtn = page.locator('.signVersion-panel div:has-text("Earn more coins")').first();
  await Promise.any([
    collectBtn.click().then(_ => console.log('Collected coins for today!')),
    moreBtn.waitFor().then(_ => console.log('No more coins to collect today!')),
  ]);
  console.log(await page.locator('.marquee-content:has-text(" coins")').first().innerText());
  const n = (await page.locator('.marquee-item:has-text(" coins")').first().innerText()).replace(' coins', '');
  console.log('Coins:', n);
};

try {
  await [
    async () => {
      await auth(urls.coins);
      await clickHideDoubleButtonIfVisible();
      await coins();
    },
    // grow,
    // gogo,
    // euro,
    // merge,
  ].reduce((a, f) => a.then(async () => {
    await f();
    console.log();
  }), Promise.resolve());
} catch (error) {
  process.exitCode ||= 1;
  console.error('--- Exception:');
  console.error(error);
}

if (page.video()) console.log('Recorded video:', await page.video().path());
await context.close();