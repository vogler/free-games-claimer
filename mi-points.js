import { chromium } from 'playwright-extra';

import { resolve, jsonDb, datetime, stealth, notify } from './src/util.js';
import { existsSync } from 'fs';
import { cfg } from './src/config.js';

// IMPORTANT: Enable stealth plugin to avoid detection
chromium.use(stealth);

const EMAIL = cfg.mi_email;
const PASSWORD = cfg.mi_password;

// Sanitize email for filename (replace @ and other special chars)
function cookieFileForEmail(email) {
  const safe = email.replace(/[^a-zA-Z0-9._-]/g, '_');
  return resolve(`data/mi-cookies-${safe}.json`);
}

if (!EMAIL || !PASSWORD) {
  console.error('ERROR: Please set MI_EMAIL and MI_PASSWORD.');
  process.exit(1);
}

const COOKIE_FILE = cookieFileForEmail(EMAIL);

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-position=0,0',
      `--window-size=${cfg.width},${cfg.height}`
    ]
  });

  const contextOptions = {
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: cfg.width, height: cfg.height }
  };

  // Load cookies if available for this email
  if (existsSync(COOKIE_FILE)) {
    console.log(`🍪 Loading cookies for ${EMAIL} from ${COOKIE_FILE}...`);
    contextOptions.storageState = COOKIE_FILE;
  } else {
    console.log(`No cookie file found for ${EMAIL}, starting fresh login.`);
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const startTime = Date.now();

  try {
    console.log('--- Xiaomi Points Claimer Start ---');
    console.log(`Using account: ${EMAIL}`);

    // 1. Target: Points Center
    console.log('Navigating to Points Center...');

    // Catch errors while loading (e.g. Access Denied)
    const response = await page.goto('https://www.mi.com/de/points-center', {
      waitUntil: 'domcontentloaded',
      timeout: cfg.timeout
    });

    // Immediate status check after load
    if (response && response.status() === 403) {
      console.error('🚨 403 FORBIDDEN - Immediately blocked. Xiaomi does not like your IP or browser fingerprint.');
      await takeScreenshot(page, 'xiaomi-blocked.png');
      process.exit(1);
    }

    await page.waitForTimeout(randomDelay(3000, 5000));
    const title = await page.title();
    if (title.includes('Access Denied')) {
      console.error('🚨 Access Denied detected in title');
      await takeScreenshot(page, 'xiaomi-blocked.png');
      process.exit(1);
    }

    // 2. Accept cookie banner if present
    try {
      const cookieBtn = page.locator('#truste-consent-button');
      if (await cookieBtn.isVisible({ timeout: 5000 })) {
        console.log('Clicking cookie banner...');
        await cookieBtn.click();
        await page.waitForTimeout(randomDelay(2000, 6000));
      }
    } catch (e) {
      if (cfg.debug) {
        console.log('No cookie banner detected or click failed (continuing).');
      }
    }

    // 3. Claim points
    console.log('Searching for claim button...');

    const claimButton = page.locator('.points-task__info .mi-btn--primary').first();
    try {
      await claimButton.waitFor({
        state: 'visible',
        timeout: cfg.timeout
      });
    } catch (e) {
      console.log('⚠️ Claim button not found within timeout.');
    }

    if (await claimButton.isVisible()) {
      const classAttribute = await claimButton.getAttribute('class');
      if (classAttribute && classAttribute.includes('mi-btn--disabled')) {
        console.log('🛑 Already claimed today (button disabled).');
      } else {
        console.log('🔘 Claim button found, preparing to click...');

        if (cfg.interactive) {
          const readline = await import('readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          });
          const shouldContinue = await new Promise(resolve => {
            rl.question('Interactive mode: Press ENTER to claim, or "skip": ', answer => {
              rl.close();
              resolve(answer.trim().toLowerCase() !== 'skip');
            });
          });
          if (!shouldContinue) {
            console.log('Skipping claim (interactive mode).');
            if (cfg.notify) notify(cfg.notify_title || 'Xiaomi Points', 'Skipped claim.');
            return;
          }
        }

        if (cfg.dryrun) {
          console.log('💧 DRYRUN: would click claim button now.');
        } else {
          // Check we're still on points-center before clicking
          const currentUrl = page.url();
          if (!currentUrl.includes('points-center')) {
            console.log('⚠️ Not on points-center page, skipping claim.');
          } else {
            console.log('🖱️ Clicking claim button...');
            await takeScreenshot(page, 'debug-before-claim-click.png');
            await humanClick(page, claimButton);

            // Robust login detection: URL change OR login elements
            try {
              await Promise.race([
                page.waitForURL(
                  url => url.toString().includes('account.xiaomi.com') || 
                         url.toString().includes('login') ||
                         url.toString().includes('mi-account'),
                  { timeout: 8000 }
                ),
                page.waitForSelector(
                  'input[name="account"], input[id="username"], input[name="email"], input[type="email"]',
                  { timeout: 8000 }
                )
              ]);
              console.log('🔒 Login page detected.');
              await performLogin(page, context);

              // Return to points center after login
              console.log('Returning to points center after login...');
              await page.goto('https://www.mi.com/de/points-center', {
                waitUntil: 'domcontentloaded',
                timeout: cfg.timeout
              });
              await page.waitForTimeout(randomDelay(4000, 8000));

              // Retry claim if button still available
              const retryClaimBtn = page.locator('.points-task__info .mi-btn--primary').first();
              if (await retryClaimBtn.isVisible({ timeout: 5000 })) {
                const retryClass = await retryClaimBtn.getAttribute('class');
                if (!retryClass?.includes('mi-btn--disabled')) {
                  await humanClick(page, retryClaimBtn);
                  console.log('✅ Successfully clicked claim button after login.');
                  await takeScreenshot(page, 'xiaomi-claimed-after-login.png');
                } else {
                  console.log('✅ Claim button disabled after login (success).');
                }
              } else {
                console.log('✅ No retry needed after login.');
              }
            } catch (e) {
              console.log('✅ Initial click successful, no login required.');
            }
          }
        }

        await page.waitForTimeout(randomDelay(1000, 3000));
        await takeScreenshot(page, 'xiaomi-final-state.png');
      }
    } else {
      console.log('⚠️ Claim button not visible on page.');
    }

    if (cfg.time) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`⏱️ Total runtime: ${duration} seconds.`);
    }

    if (cfg.notify) {
      notify(
        cfg.notify_title || 'Xiaomi Points',
        cfg.dryrun 
          ? `DRYRUN: Xiaomi points claim simulated for ${EMAIL}.`
          : `Xiaomi points claim completed for ${EMAIL}.`
      );
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    await takeScreenshot(page, 'xiaomi-error.png');

    if (cfg.notify) {
      notify(
        cfg.notify_title || 'Xiaomi Points',
        `Error for ${EMAIL}: ${error.message}`
      );
    }

    if (cfg.nowait) process.exit(1);
  } finally {
    await browser.close();
  }
})();

async function performLogin(page, context) {
  console.log('✍️ Starting login process...');
  await takeScreenshot(page, 'debug-login-page.png');

  // Multiple selectors for email field
  const emailSelectors = [
    'input[name="account"]',
    'input[id="username"]',
    'input[name="email"]',
    'input[type="email"]',
    'input[placeholder*="email"], input[placeholder*="Email"], input[placeholder*="E-Mail"]'
  ];

  let emailField = null;
  for (const selector of emailSelectors) {
    try {
      emailField = page.locator(selector).first();
      await emailField.waitFor({ state: 'visible', timeout: 3000 });
      console.log(`✅ Email field found: ${selector}`);
      break;
    } catch (e) {
      if (cfg.debug) console.log(`Trying next email selector: ${selector}`);
    }
  }

  if (!emailField) throw new Error('No email input field found on login page');

  await emailField.type(EMAIL, { delay: 80 + Math.random() * 120 });

  // Multiple selectors for password
  const pwdSelectors = [
    'input[name="password"]',
    'input[id="pwd"]',
    'input[name="pwd"]',
    'input[type="password"]'
  ];

  let pwdField = null;
  for (const selector of pwdSelectors) {
    try {
      pwdField = page.locator(selector).first();
      await pwdField.waitFor({ state: 'visible', timeout: 3000 });
      console.log(`✅ Password field found: ${selector}`);
      break;
    } catch (e) {}
  }

  if (!pwdField) throw new Error('No password input field found');

  await pwdField.type(PASSWORD, { delay: 80 + Math.random() * 120 });

  // Checkbox if present
  const agreement = page.locator('.agreement-checkbox, input[type="checkbox"]:not([disabled])');
  if (await agreement.isVisible({ timeout: 2000 })) {
    await agreement.check();
    console.log('✅ Agreement checkbox checked.');
  }

  // Submit button with multiple selectors
  const submitSelectors = [
    'button[type="submit"]',
    '.login-btn',
    '.btn-login',
    'input[type="submit"]',
    '.btn-primary'
  ];

  let submitBtn = null;
  for (const selector of submitSelectors) {
    try {
      submitBtn = page.locator(selector).first();
      await submitBtn.waitFor({ state: 'visible', timeout: 2000 });
      console.log(`✅ Submit button found: ${selector}`);
      break;
    } catch (e) {}
  }

  if (submitBtn) {
    await humanClick(page, submitBtn);
  } else {
    console.log('⚠️ No submit button found, trying Enter key...');
    await page.keyboard.press('Enter');
  }

  // Wait for successful login (leave login page)
  await page.waitForURL(
    url => !url.toString().includes('account.xiaomi.com') && 
           !url.toString().includes('login') &&
           !url.toString().includes('mi-account'),
    { timeout: cfg.login_timeout }
  );
  console.log('✅ Login successful.');
  await takeScreenshot(page, 'debug-post-login.png');

  // Save session for this specific email
  await context.storageState({ path: COOKIE_FILE });
  console.log(`💾 Session cookies saved for ${EMAIL} at ${COOKIE_FILE}.`);
}

// Helper: natural delays
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper: screenshots with config support
async function takeScreenshot(page, filename) {
  const dir = cfg.dir.screenshots;
  if (dir === '0') return;
  const path = `${dir}/${filename}`;
  await page.screenshot({ path, fullPage: true });
  if (cfg.debug) console.log(`📸 Screenshot: ${path}`);
}

// Helper: ROBUST human-like click with element validation
async function humanClick(page, selectorOrLocator) {
  let element;
  try {
    element = typeof selectorOrLocator === 'string'
      ? page.locator(selectorOrLocator).first()
      : selectorOrLocator;

    await element.waitFor({ state: 'visible', timeout: 3000 });
    await element.waitFor({ state: 'attached', timeout: 2000 });
  } catch (e) {
    throw new Error(`humanClick failed: Element not found/visible (${selectorOrLocator})`);
  }

  const box = await element.boundingBox();
  if (box) {
    const viewport = page.viewportSize();
    if (box.y < 0 || box.y + box.height > viewport.height) {
      console.log('📜 Scrolling to element...');
      const targetY = box.y - viewport.height / 2;
      const steps = 5 + Math.floor(Math.random() * 5);
      for (let i = 1; i <= steps; i++) {
        await page.mouse.wheel(0, (targetY / steps) * i);
        await page.waitForTimeout(randomDelay(50, 150));
      }
      await page.waitForTimeout(randomDelay(500, 1000));
    }
  }

  if (box) {
    const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
    const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);
    await page.mouse.move(targetX, targetY, { steps: 35 });
    await page.waitForTimeout(randomDelay(300, 600));
    await page.mouse.down();
    await page.waitForTimeout(randomDelay(100, 250));
    await page.mouse.up();
  }

  console.log('🖱️ Executing force click...');
  await element.click({
    force: true,
    noWaitAfter: true,
    trial: true
  });

  await page.waitForTimeout(randomDelay(1500, 3000));
}
