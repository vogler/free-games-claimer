import chalk from 'chalk';
import { chromium, type BrowserContext, type Page } from 'patchright';
import { FingerprintInjector } from 'fingerprint-injector';
import { FingerprintGenerator } from 'fingerprint-generator';
import { datetime, filenamify, jsonDb, prompt, notify, handleSIGINT } from './src/util.js';
import { cfg } from './src/config.js';

interface CheckInStatus {
  isLoggedIn: boolean;
  isCheckedIn: boolean;
  streak: number;
  earned: number;
  total: number;
}

interface CheckInRecord {
  date: string;
  status: 'claimed' | 'already_claimed' | 'error';
  streak: number;
  earned: number;
  total: number;
}

interface MiDatabase {
  history: CheckInRecord[];
}

const detectRegion = async (page: Page): Promise<string> => {
  console.log(datetime(), 'Detecting account storefront region...');
  await page.goto('https://www.mi.com/', { waitUntil: 'domcontentloaded' });

  const currentUrl = page.url();
  const match = currentUrl.match(/mi\.com\/([a-z]{2}(?:-[a-z]{2})?)/i);
  if (!match) {
    throw new Error(`Failed to detect storefront region from URL: ${currentUrl}`);
  }
  const region = match[1].toLowerCase();

  console.log('Detected region:', chalk.cyan(region));
  return region;
};

const navigateToPointsCenter = async (page: Page, region: string): Promise<void> => {
  const pointsCenterUrl = `https://www.mi.com/${region}/points-center`;
  console.log(datetime(), `Navigating to Points Center (${pointsCenterUrl})...`);
  await page.goto(pointsCenterUrl, { waitUntil: 'domcontentloaded' });

  const taskSection = page.locator('.points-task__check, .points-task');
  await taskSection.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
    console.log('Task section not immediately visible, continuing...');
  });
};

const getCheckInStatus = async (page: Page, region: string): Promise<CheckInStatus> => {
  const apiData = await page.evaluate(async (reg: string) => {
    try {
      const res = await fetch(`https://ams-go.buy.mi.com/${reg}/tokens/center/task`, { credentials: 'include' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, region);

  if (apiData?.data) {
    const isLoggedIn = Boolean(apiData.data.isLoggedIn);
    const taskGroup = apiData.data.taskGroups?.[0];
    const checkIn = taskGroup?.dailyCheckIn;
    const isCheckedIn = Boolean(checkIn?.isCheckedIn);
    const streak = Number(checkIn?.streakDay || checkIn?.streakDayInCycle || 0);
    const total = Number(apiData.data.tokens || 0);
    const cycleRewards = checkIn?.streakCycle?.cycleRewards || [];
    const currentDayReward = cycleRewards.find((r: { dayInCycle: number; tokens: number }) => r.dayInCycle === checkIn?.streakDayInCycle);
    const earned = currentDayReward?.tokens || 10;

    return { isLoggedIn, isCheckedIn, streak, earned, total };
  }

  // Fallback: scrape directly from DOM
  const totalText = await page.locator('.points-task__info-number').innerText().catch(() => '0');
  const total = Number(totalText.replace(/,/g, '')) || 0;

  const earnedText = await page.locator('.points-task__day-token--today').innerText().catch(() => '+10');
  const earned = Number(earnedText.replace(/\D/g, '')) || 10;

  const hasCompletedDay = await page.locator('.points-task__day-title--completed').count() > 0;
  const isButtonDisabled = await page.locator('button.points-task__info-login[disabled]').isVisible().catch(() => false);
  const isCheckedIn = hasCompletedDay || isButtonDisabled;

  return { isLoggedIn: true, isCheckedIn, streak: 1, earned, total };
};

const ensureLoggedIn = async (page: Page, context: BrowserContext, region: string): Promise<void> => {
  console.log(datetime(), 'Checking authentication status on Mi Store...');
  const status = await getCheckInStatus(page, region);

  if (status.isLoggedIn) {
    console.log(chalk.green('Already authenticated on Mi Store!'));
    return;
  }

  console.log(chalk.yellow('Not logged in on Mi Store. Starting login flow...'));

  // Trigger login from Points Center to establish the proper SSO callback for buy.mi.com
  await page.evaluate(() => {
    const loginBtn = document.querySelector('.points-task__info-login') as HTMLButtonElement | null;
    if (loginBtn) {
      loginBtn.click();
    } else {
      const headerUser = document.querySelector('.site-header__user, a[href*="/user"]') as HTMLElement | null;
      headerUser?.click();
    }
  });

  // Wait for navigation to Xiaomi Account login page
  await page.waitForURL(url => url.hostname.includes('account.xiaomi.com'), { timeout: 15000 }).catch(() => {});

  const accountInput = page.locator('input[name="account"]');
  await accountInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

  // Dismiss cookie banner on login page
  const cookieBtn = page.locator('.mi-cookie-banner__button');
  await cookieBtn.click({ timeout: 2000 }).catch(() => {});

  const email = cfg.mi_email || await prompt({ message: 'Enter Xiaomi email/phone (press Enter to log in via browser)' });
  if (email) {
    await accountInput.fill(email);
    const passwordInput = page.locator('input[name="password"]');
    const password = cfg.mi_password || await prompt({ type: 'password', message: 'Enter Xiaomi password' });
    if (password) {
      await passwordInput.fill(password);
      const checkbox = page.locator('.ant-checkbox-input');
      if (await checkbox.isVisible() && !await checkbox.isChecked()) {
        await checkbox.check().catch(async () => {
          await page.locator('.ant-checkbox').click().catch(() => {});
        });
      }
      const submitBtn = page.locator('button[type="submit"]');
      await submitBtn.click();
    }
  }

  console.log(`Waiting up to ${cfg.login_timeout / 1000}s for login / 2FA completion in browser or terminal...`);
  context.setDefaultTimeout(cfg.login_timeout);

  let lastIdentityError: string | null = null;
  const responseListener = async (res: any) => {
    const url = res.url();
    if (url.includes('account.xiaomi.com/identity/') || url.includes('account.xiaomi.com/pass/')) {
      try {
        const text = await res.text();
        const cleanJson = text.replace(/^&&&START&&&/, '');
        const data = JSON.parse(cleanJson);
        if (data.code !== undefined && data.code !== 0 && (data.tips || data.description || data.desc)) {
          lastIdentityError = data.tips || data.description || data.desc;
        }
      } catch {}
    }
  };
  page.on('response', responseListener);

  try {
    // Check if 2FA / Identity verification page appears
    const is2FARequired = await Promise.race([
      page.waitForURL(url => url.pathname.includes('/fe/service/identity') || url.pathname.includes('verify'), { timeout: 15000 }).then(() => true).catch(() => false),
      page.waitForURL(url => !url.hostname.includes('account.xiaomi.com') && (url.hostname.includes('mi.com') || url.hostname.includes('buy.mi.com')), { timeout: 15000 }).then(() => false).catch(() => false),
    ]);

    if (is2FARequired && page.url().includes('account.xiaomi.com')) {
      console.log(chalk.cyan('Identity / 2FA verification required...'));

      const codeInput = page.locator('input.mi-input__inner, input.miui-input__inner, input[type="text"]:not([name="account"]), input[type="tel"], input[type="number"]');
      const sendEmailBtn = page.locator('button.miui-btn-primary, button.mi-button--primary, button[type="submit"]');

      // Wait for the verification SPA to render either the Send button or the code input
      await Promise.race([
        sendEmailBtn.waitFor({ state: 'visible', timeout: 10000 }),
        codeInput.waitFor({ state: 'visible', timeout: 10000 }),
      ]).catch(() => {});

      // Check for any visible error messages (e.g. rate limits or API errors)
      const checkError = async () => {
        if (lastIdentityError) {
          throw new Error(`Xiaomi verification error: ${lastIdentityError}`);
        }
        const domError = await page.locator('[class*="Notification"], [class*="tips"], [class*="error"], [role="alert"]').first().innerText().catch(() => '');
        if (domError && !domError.includes('Senden') && !domError.includes('Send') && !domError.includes('Hilfe') && !domError.includes('Help')) {
          throw new Error(`Xiaomi verification error: ${domError}`);
        }
      };

      await checkError();

      // If code input is not visible yet, click the Send button to dispatch the email code
      if (!await codeInput.isVisible().catch(() => false)) {
        if (await sendEmailBtn.isVisible().catch(() => false)) {
          console.log(datetime(), 'Triggering verification code email...');
          await sendEmailBtn.click().catch(() => {});
          await page.waitForTimeout(1000);
          await checkError();
        }
      }

      // Wait for the code input field to be rendered
      await codeInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      await checkError();

      if (await codeInput.isVisible().catch(() => false)) {
        const otp = await prompt({
          type: 'text',
          message: 'Enter 2FA verification code sent to your email',
          validate: (n: string) => n.toString().length === 6 || 'The code must be 6 digits!',
        });

        if (otp) {
          await codeInput.fill(otp);
          await codeInput.press('Enter').catch(() => {});

          // Target the main submit button at the bottom of the form
          const submitCodeBtn = page.locator('button.miui-btn-primary, button.mi-button--primary, button[type="submit"]').last();
          if (await submitCodeBtn.isVisible().catch(() => false)) {
            await submitCodeBtn.click({ force: true }).catch(() => {});
          }
          await page.waitForTimeout(1000);
          await checkError();
        }
      }
    }
  } finally {
    page.off('response', responseListener);
  }

  // Wait for redirect back from account.xiaomi.com to mi.com
  await page.waitForURL(url => !url.hostname.includes('account.xiaomi.com') && (url.hostname.includes('mi.com') || url.hostname.includes('buy.mi.com')), { timeout: cfg.login_timeout });
  context.setDefaultTimeout(cfg.debug ? 0 : cfg.timeout);

  // Ensure we are on the points-center page
  await navigateToPointsCenter(page, region);
  console.log(chalk.green('Successfully authenticated on Mi Store!'));
};

const claimDailyPoints = async (page: Page, region: string): Promise<CheckInStatus> => {
  const initialStatus = await getCheckInStatus(page, region);

  if (!initialStatus.isLoggedIn) {
    console.log(chalk.red('Not logged in on Points Center. Cannot claim points.'));
    return initialStatus;
  }

  if (initialStatus.isCheckedIn) {
    console.log(chalk.yellow('Already checked in for today!'));
    return initialStatus;
  }

  console.log(datetime(), 'Claiming daily points...');

  // Try clicking check-in button or coin icon
  const checkInBtn = page.locator('button.points-task__info-login:not([disabled])');
  const todayIcon = page.locator('.points-task__day-icon--today');

  if (await checkInBtn.isVisible().catch(() => false)) {
    await checkInBtn.click({ force: true }).catch(() => {});
  } else if (await todayIcon.isVisible().catch(() => false)) {
    await todayIcon.click({ force: true }).catch(() => {});
  }

  // Direct API call fallback in page context
  await page.evaluate(async (reg: string) => {
    try {
      await fetch(`https://ams-go.buy.mi.com/${reg}/tokens/task/check_in`, { credentials: 'include' });
    } catch {}
  }, region);

  await page.waitForTimeout(2500);

  const updatedStatus = await getCheckInStatus(page, region);
  return updatedStatus;
};

const saveHistory = async (record: CheckInRecord): Promise<void> => {
  const db = await jsonDb('mi.json', { history: [] } as MiDatabase);
  db.data ||= { history: [] };
  db.data.history.push(record);
  await db.write();

  if (cfg.notify) {
    const message = [
      '<b>Xiaomi Mi Points Center</b>',
      `Status: ${record.status}`,
      `Streak: ${record.streak} day(s)`,
      `Earned today: +${record.earned} points`,
      `Total points: ${record.total.toLocaleString()}`,
    ].join('<br>');
    await notify(message).catch(err => console.error('Notification error:', err));
  }
};

const main = async (): Promise<void> => {
  console.log(datetime(), 'Started checking Xiaomi Mi Points Center');

  const { fingerprint, headers } = new FingerprintGenerator().getFingerprint({
    devices: ['desktop'],
    operatingSystems: ['macos', 'windows', 'linux'],
  });

  const context = await chromium.launchPersistentContext(cfg.dir.browser, {
    headless: cfg.headless,
    viewport: { width: cfg.width, height: cfg.height },
    locale: 'en-US',
    recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined,
    recordHar: cfg.record ? { path: `data/record/mi-${filenamify(datetime())}.har` } : undefined,
    handleSIGINT: false,
    userAgent: fingerprint.navigator.userAgent,
    extraHTTPHeaders: {
      'accept-language': headers['accept-language'] || 'en-US,en;q=0.9',
    },
    args: ['--hide-crash-restore-bubble'],
  });

  handleSIGINT(context);
  await new FingerprintInjector().attachFingerprintToPlaywright(context, { fingerprint, headers });

  if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);

  // Suppress TrustArc cookie consent banners across mi.com (essential cookies only)
  await context.addCookies([
    { name: 'notice_behavior', value: 'implied,eu', domain: '.mi.com', path: '/' },
    { name: 'notice_preferences', value: '0:', domain: '.mi.com', path: '/' },
    { name: 'notice_gdpr_prefs', value: '0:', domain: '.mi.com', path: '/' },
    { name: 'cmapi_cookie_privacy', value: 'permit 1 required', domain: '.mi.com', path: '/' },
  ]);

  const page = context.pages().length ? context.pages()[0] : await context.newPage();
  await page.setViewportSize({ width: cfg.width, height: cfg.height });

  try {
    const region = await detectRegion(page);
    await navigateToPointsCenter(page, region);
    await ensureLoggedIn(page, context, region);

    const initialStatus = await getCheckInStatus(page, region);
    const wasAlreadyCheckedIn = initialStatus.isCheckedIn;

    const finalStatus = await claimDailyPoints(page, region);

    const record: CheckInRecord = {
      date: datetime(),
      status: wasAlreadyCheckedIn ? 'already_claimed' : 'claimed',
      streak: finalStatus.streak,
      earned: wasAlreadyCheckedIn ? 0 : finalStatus.earned,
      total: finalStatus.total,
    };

    if (finalStatus.isLoggedIn) {
      await saveHistory(record);
    }

    console.log();
    console.log(chalk.bold('================ Xiaomi Points ================'));
    console.log('Status:      ', !finalStatus.isLoggedIn ? chalk.red('Login Failed') : wasAlreadyCheckedIn ? chalk.yellow('Already Checked In') : chalk.green(`Claimed (+${finalStatus.earned} points)`));
    console.log('Streak:      ', `${finalStatus.streak} day(s)`);
    console.log('Total Points:', chalk.bold(finalStatus.total.toLocaleString()));
    console.log(chalk.bold('==============================================='));
    console.log();
  } catch (error) {
    process.exitCode = 1;
    console.error('--- Exception:', error);
  } finally {
    if (page.video()) {
      console.log('Recorded video:', await page.video()?.path());
    }
    await context.close();
  }
};

await main();
