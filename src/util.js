// https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const { FingerprintGenerator } = _require('fingerprint-generator');
const { FingerprintInjector } = _require('fingerprint-injector');
const _fingerprintGenerator = new FingerprintGenerator({ browsers: [{ name: 'chrome', minVersion: 130 }], devices: ['desktop'], operatingSystems: ['windows'] });
const _fingerprintInjector = new FingerprintInjector();

// Load a persistent fingerprint from disk, generating it once on first run.
// A real user always appears as the same "computer" - same canvas hash, WebGL renderer, fonts, etc.
// Regenerating every run is more suspicious than a stable identity.
// Delete data/fingerprint.json to force a new fingerprint (e.g. after changing WIDTH/HEIGHT).
export const generateFingerprint = (width = 1920, height = 1080) => {
  const fpFile = dataDir('fingerprint.json');
  if (existsSync(fpFile)) {
    try {
      return JSON.parse(_require('node:fs').readFileSync(fpFile, 'utf8'));
    } catch (_) { /* corrupted file - regenerate */ }
  }
  let fp;
  try {
    fp = _fingerprintGenerator.getFingerprint({ screen: { minWidth: width, maxWidth: width, minHeight: height, maxHeight: height } });
  } catch (_) {
    fp = _fingerprintGenerator.getFingerprint();
  }
  try {
    writeFileSync(fpFile, JSON.stringify(fp, null, 2));
    console.log('Generated new browser fingerprint, saved to', fpFile);
  } catch (_) { /* non-critical */ }
  return fp;
};
// not the same since these will give the absolute paths for this file instead of for the file using them
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// explicit object instead of Object.fromEntries since the built-in type would loose the keys, better type: https://dev.to/svehla/typescript-object-fromentries-389c
export const dataDir = s => path.resolve(__dirname, '..', 'data', s);

// Remove stale browser profile lock left behind by a crashed/killed previous run.
// Firefox uses parent.lock, Chromium/patchright uses SingletonLock.
// On Windows the file is held open by the process, so if removal fails the profile is still in use.
export const clearBrowserLock = (dir) => {
  for (const lockName of ['parent.lock', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const lockFile = path.join(dir, lockName);
    if (existsSync(lockFile)) {
      try {
        unlinkSync(lockFile);
        console.log('Removed stale browser lock file:', lockFile);
      } catch (_) {
        console.error(`Browser profile is already in use: ${lockFile}`);
        console.error('Close other browser instances sharing this profile, or set a different BROWSER_DIR.');
        process.exit(1);
      }
    }
  }
};

// Write a lastrun timestamp so Docker HEALTHCHECK can verify the scheduler is alive.
export const writeLastRun = (script) => {
  try {
    const p = dataDir('lastrun.json');
    writeFileSync(p, JSON.stringify({ script, time: new Date().toISOString() }));
  } catch (_) { /* non-critical */ }
};

// modified path.resolve to return null if first argument is '0', used to disable screenshots
export const resolve = (...a) => a.length && a[0] == '0' ? null : path.resolve(...a);

// json database
import { JSONFilePreset } from 'lowdb/node';
export const jsonDb = (file, defaultData) => JSONFilePreset(dataDir(file), defaultData);

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// date and time as UTC (no timezone offset) in nicely readable and sortable format, e.g., 2022-10-06 12:05:27.313
export const datetimeUTC = (d = new Date()) => d.toISOString().replace('T', ' ').replace('Z', '');
// same as datetimeUTC() but for local timezone, e.g., UTC + 2h for the above in DE
export const datetime = (d = new Date()) => datetimeUTC(new Date(d.getTime() - d.getTimezoneOffset() * 60000));
export const filenamify = s => s.replaceAll(':', '.').replace(/[^a-z0-9 _\-.]/gi, '_'); // alternative: https://www.npmjs.com/package/filenamify - On Unix-like systems, / is reserved. On Windows, <>:"/\|?* along with trailing periods are reserved.

export const handleSIGINT = (context = null) => process.on('SIGINT', async () => { // e.g. when killed by Ctrl-C
  console.error('\nInterrupted by SIGINT. Exit!');
  process.exitCode = 130; // 128+SIGINT to indicate to parent that process was killed
  if (context) await context.close(); // in order to save recordings also on SIGINT, we need to disable Playwright's handleSIGINT and close the context ourselves
});

// Retry wrapper - retries an async function on failure with delay between attempts.
export const withRetry = async (label, fn, { retries = 3, delayMs = 30000 } = {}) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= retries - 1) throw e;
      console.error(`${label}: attempt ${i + 1}/${retries} failed: ${e.message?.split('\n')[0]}`);
      console.log(`Retrying in ${delayMs / 1000}s...`);
      await delay(delayMs);
    }
  }
};

export const stealth = async (context, fingerprint = null) => {
  // stealth with playwright: https://github.com/berstend/puppeteer-extra/issues/454#issuecomment-917437212
  // https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth/evasions
  const enabledEvasions = [
    'chrome.app',
    'chrome.csi',
    'chrome.loadTimes',
    'chrome.runtime', // partially broken in Chrome 100+, patched below
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
    'window.outerdimensions',
  ];
  const stealth = {
    callbacks: [],
    async evaluateOnNewDocument(...args) {
      this.callbacks.push({ cb: args[0], a: args[1] });
    },
  };
  for (const e of enabledEvasions) {
    const evasion = await import(`puppeteer-extra-plugin-stealth/evasions/${e}/index.js`);
    evasion.default().onPageCreated(stealth);
  }
  for (const evasion of stealth.callbacks) {
    await context.addInitScript(evasion.cb, evasion.a);
  }

  // fingerprint-injector: injects canvas fingerprint, WebGL renderer/vendor, font metrics,
  // navigator properties (hardwareConcurrency, deviceMemory, languages, plugins, etc.)
  // and sets matching sec-ch-ua / user-agent HTTP headers.
  // Must run BEFORE the chrome.runtime patch so the patch isn't overwritten.
  if (fingerprint) {
    await _fingerprintInjector.attachFingerprintToPlaywright(context, fingerprint);
  }

  // chrome.runtime patch: puppeteer-extra-plugin-stealth's version is broken in Chrome 100+
  // because the real runtime object structure changed. We patch it manually.
  // Without this, bot detectors see window.chrome.runtime === undefined which is detectable.
  await context.addInitScript(() => {
    if (!window.chrome) return;
    if (window.chrome.runtime && window.chrome.runtime.PlatformOs) return; // already set correctly (non-headless real Chrome)
    try {
      Object.defineProperty(window.chrome, 'runtime', {
        value: {
          PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
          PlatformArch: { ARM: 'arm', ARM64: 'arm64', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
          RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
          OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
          connect: () => { throw new Error('Extension context invalidated.'); },
          sendMessage: () => { throw new Error('Extension context invalidated.'); },
          id: undefined,
        },
        writable: false,
        enumerable: false,
        configurable: false,
      });
    } catch (_) { /* already defined by real Chrome runtime - that's fine */ }
  });
};

// used prompts before, but couldn't cancel prompt
// alternative inquirer is big (node_modules 29MB, enquirer 9.7MB, prompts 9.8MB, none 9.4MB) and slower
// open issue: prevents handleSIGINT() to work if prompt is cancelled with Ctrl-C instead of Escape: https://github.com/enquirer/enquirer/issues/372
import Enquirer from 'enquirer'; const enquirer = new Enquirer();
const timeoutPlugin = timeout => enquirer => { // cancel prompt after timeout ms
  enquirer.on('prompt', prompt => {
    const t = setTimeout(() => {
      prompt.hint = () => 'timeout';
      prompt.cancel();
    }, timeout);
    prompt.on('submit', _ => clearTimeout(t));
    prompt.on('cancel', _ => clearTimeout(t));
  });
};
enquirer.use(timeoutPlugin(cfg.login_timeout)); // TODO may not want to have this timeout for all prompts; better extend Prompt and add a timeout prompt option
// single prompt that just returns the non-empty value instead of an object
// @ts-ignore
export const prompt = o => enquirer.prompt({ name: 'name', type: 'input', message: 'Enter value', ...o }).then(r => r.name).catch(_ => {});
export const confirm = o => prompt({ type: 'confirm', message: 'Continue?', ...o });

// notifications via apprise CLI (set NOTIFY env var)
import { execFile } from 'child_process';
import { cfg } from './config.js';

export const notify = html => {
  notifyTelegram(html).catch(_ => {}); // fire-and-forget Telegram in parallel
  if (!cfg.notify) {
    if (cfg.debug) console.debug('notify: NOTIFY is not set!');
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const args = [cfg.notify, '-i', 'html', '-b', `'${html}'`];
    if (cfg.notify_title) args.push(...['-t', cfg.notify_title]);
    if (cfg.debug) console.debug(`apprise ${args.map(a => `'${a}'`).join(' ')}`);
    execFile('apprise', args, (error, stdout, stderr) => {
      if (error) {
        console.log(`error: ${error.message}`);
        if (error.message.includes('command not found')) {
          console.info('Run `pip install apprise` or set TG_TOKEN+TG_CHAT_ID for Telegram. See README.');
        }
        return reject(error);
      }
      if (stderr) console.error(`stderr: ${stderr}`);
      if (stdout) console.log(`stdout: ${stdout}`);
      resolve();
    });
  });
};

// Direct Telegram notification without Apprise (set TG_TOKEN and TG_CHAT_ID env vars).
// Works independently of NOTIFY/apprise - can be used alongside or as replacement.
export const notifyTelegram = async (html) => {
  if (!cfg.tg_token || !cfg.tg_chat_id) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.tg_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cfg.tg_chat_id,
        text: html,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) console.error('Telegram notification error:', await res.text());
  } catch (e) {
    console.error('Telegram notification failed:', e.message);
  }
};

export const escapeHtml = unsafe => unsafe.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\'', '&#039;');

export const html_game_list = games => games.map(g => `- <a href="${escapeHtml(g.url)}">${escapeHtml(g.title)}</a> (${g.status})`).join('<br>'); // status may intentionally contain HTML (e.g. redeem links from prime-gaming)
