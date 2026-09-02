import { chromium, type BrowserContext, type Page } from 'patchright';
import chalk from 'chalk';
import { datetime, filenamify, jsonDb, prompt, notify, handleSIGINT } from './src/util.js';
import { cfg } from './src/config.js';

interface CheckInStatus {
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

const ensureLoggedIn = async (page: Page, context: BrowserContext): Promise<void> => {
  console.log(datetime(), 'Checking authentication at Xiaomi Account...');
  await page.goto('https://account.xiaomi.com/', { waitUntil: 'domcontentloaded' });

  const accountInput = page.locator('input[name="account"]');
  const isLoginForm = await accountInput.isVisible().catch(() => false);

  if (!isLoginForm) {
    console.log(chalk.green('Already authenticated!'));
    return;
  }

  console.log('Login form detected. Proceeding with authentication...');

  // Accept cookies if banner is present
  const cookieBtn = page.locator('.mi-cookie-banner__button');
  await cookieBtn.click().catch(() => {});

  const email = cfg.mi_email || await prompt({ message: 'Enter Xiaomi email/phone' });
  if (!email) throw new Error('Xiaomi email is required for login');
  await accountInput.fill(email);

  const passwordInput = page.locator('input[name="password"]');
  const password = cfg.mi_password || await prompt({ type: 'password', message: 'Enter Xiaomi password' });
  if (!password) throw new Error('Xiaomi password is required for login');
  await passwordInput.fill(password);

  // Ensure terms agreement checkbox is checked
  const checkbox = page.locator('.ant-checkbox-input');
  if (await checkbox.isVisible() && !await checkbox.isChecked()) {
    await checkbox.check().catch(async () => {
      await page.locator('.ant-checkbox').click().catch(() => {});
    });
  }

  // Submit credentials
  const submitBtn = page.locator('button[type="submit"]');
  await submitBtn.click();

  console.log(`Waiting up to ${cfg.login_timeout / 1000}s for login / 2FA completion...`);
  context.setDefaultTimeout(cfg.login_timeout);

  await page.waitForURL(url => !url.pathname.includes('/fe/service/login'), { timeout: cfg.login_timeout });
  context.setDefaultTimeout(cfg.debug ? 0 : cfg.timeout);

  console.log(chalk.green('Successfully authenticated!'));
};

const detectRegion = async (page: Page): Promise<string> => {
  console.log(datetime(), 'Detecting account storefront region...');
  await page.goto('https://www.mi.com/', { waitUntil: 'domcontentloaded' });

  const currentUrl = page.url();
  const match = currentUrl.match(/mi\.com\/([a-z]{2}(?:-[a-z]{2})?)/i);
  const region = match ? match[1].toLowerCase() : 'de';

  console.log('Detected region:', chalk.cyan(region));
  return region;
};

const navigateToPointsCenter = async (page: Page, region: string): Promise<void> => {
  const pointsCenterUrl = `https://www.mi.com/${region}/points-center`;
  console.log(datetime(), `Navigating to Points Center (${pointsCenterUrl})...`);
  await page.goto(pointsCenterUrl, { waitUntil: 'domcontentloaded' });

  const taskSection = page.locator('.points-task__check');
  await taskSection.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
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
    const taskGroup = apiData.data.taskGroups?.[0];
    const checkIn = taskGroup?.dailyCheckIn;
    const isCheckedIn = Boolean(checkIn?.isCheckedIn);
    const streak = Number(checkIn?.streakDay || checkIn?.streakDayInCycle || 0);
    const total = Number(apiData.data.tokens || 0);
    const cycleRewards = checkIn?.streakCycle?.cycleRewards || [];
    const currentDayReward = cycleRewards.find((r: { dayInCycle: number; tokens: number }) => r.dayInCycle === checkIn?.streakDayInCycle);
    const earned = currentDayReward?.tokens || 10;

    return { isCheckedIn, streak, earned, total };
  }

  // Fallback: scrape directly from DOM
  const totalText = await page.locator('.points-task__info-number').innerText().catch(() => '0');
  const total = Number(totalText.replace(/,/g, '')) || 0;

  const earnedText = await page.locator('.points-task__day-token--today').innerText().catch(() => '+10');
  const earned = Number(earnedText.replace(/\D/g, '')) || 10;

  const hasCompletedDay = await page.locator('.points-task__day-title--completed').count() > 0;
  const isButtonDisabled = await page.locator('button.points-task__info-login[disabled]').isVisible().catch(() => false);
  const isCheckedIn = hasCompletedDay || isButtonDisabled;

  return { isCheckedIn, streak: 1, earned, total };
};

const claimDailyPoints = async (page: Page, region: string): Promise<CheckInStatus> => {
  const initialStatus = await getCheckInStatus(page, region);

  if (initialStatus.isCheckedIn) {
    console.log(chalk.yellow('Already checked in for today!'));
    return initialStatus;
  }

  console.log(datetime(), 'Claiming daily points...');

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

  const context = await chromium.launchPersistentContext(cfg.dir.browser, {
    headless: cfg.headless,
    viewport: { width: cfg.width, height: cfg.height },
    locale: 'en-US',
    recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined,
    recordHar: cfg.record ? { path: `data/record/mi-${filenamify(datetime())}.har` } : undefined,
    handleSIGINT: false,
    args: ['--hide-crash-restore-bubble'],
  });

  handleSIGINT(context);
  if (!cfg.debug) context.setDefaultTimeout(cfg.timeout);

  const page = context.pages().length ? context.pages()[0] : await context.newPage();
  await page.setViewportSize({ width: cfg.width, height: cfg.height });

  try {
    await ensureLoggedIn(page, context);
    const region = await detectRegion(page);
    await navigateToPointsCenter(page, region);

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

    await saveHistory(record);

    console.log();
    console.log(chalk.bold('================ Xiaomi Points ================'));
    console.log('Status:      ', wasAlreadyCheckedIn ? chalk.yellow('Already Checked In') : chalk.green(`Claimed (+${finalStatus.earned} points)`));
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
