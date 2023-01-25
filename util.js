// https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// not the same since these will give the absolute paths for this file instead of for the file using them
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// explicit object instead of Object.fromEntries since the built-in type would loose the keys, better type: https://dev.to/svehla/typescript-object-fromentries-389c
const dataDir = s => path.resolve(__dirname, 'data', s);
export const dirs = {
  data: dataDir('.'),
  browser: dataDir('browser'),
  screenshots: dataDir('screenshots'),
};

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
export const jsonDb = async file => {
  const db = new Low(new JSONFile(dataDir(file)));
  await db.read();
  return db;
};

// date and time as UTC (no timezone offset) in nicely readable and sortable format, e.g., 2022-10-06 12:05:27.313
export const datetime = (d = new Date()) => d.toISOString().replace('T', ' ').replace('Z', '');
// same as datetime() but for local timezone, e.g., UTC + 2h for the above in DE
export const datetimeLocal = (d = new Date()) => datetime(new Date(d.getTime() - new Date().getTimezoneOffset() * 60000));
export const filenamify = s => s.replaceAll(':', '.').replace(/[^a-z0-9 _\-.]/gi, '_'); // alternative: https://www.npmjs.com/package/filenamify - On Unix-like systems, / is reserved. On Windows, <>:"/\|?* along with trailing periods are reserved.

// stealth with playwright: https://github.com/berstend/puppeteer-extra/issues/454#issuecomment-917437212
const newStealthContext = async (browser, contextOptions = {}, debug = false) => {
  if (!debug) { // only need to fix userAgent in headless mode
    const dummyContext = await browser.newContext();
    const originalUserAgent = await (await dummyContext.newPage()).evaluate(() => navigator.userAgent);
    await dummyContext.close();
    // console.log('originalUserAgent:', originalUserAgent); // Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/96.0.4664.110 Safari/537.36
    contextOptions = {
      ...contextOptions,
      userAgent: originalUserAgent.replace("Headless", ""), // HeadlessChrome -> Chrome, TODO needed?
    };
  }
};

export const stealth = async (context) => {
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
  const stealth = {
    callbacks: [],
    async evaluateOnNewDocument(...args) {
      this.callbacks.push({ cb: args[0], a: args[1] });
    }
  };
  for (const e of enabledEvasions) {
    const evasion = await import(`puppeteer-extra-plugin-stealth/evasions/${e}/index.js`);
    evasion.default().onPageCreated(stealth);
  }
  for (let evasion of stealth.callbacks) {
    await context.addInitScript(evasion.cb, evasion.a);
  }
};

// notifications via apprise CLI
import { exec } from 'child_process';
import { cfg } from './config.js';

export const notify = (html) => {
  if (!cfg.notify) return;
  exec(`apprise ${cfg.notify} -i html -b '${html}'`, (error, stdout, stderr) => {
    if (error) {
        console.log(`error: ${error.message}`);
        if (error.message.includes('command not found')) {
          console.info('Run `pip install apprise`. See https://github.com/vogler/free-games-claimer#notifications');
        }
        return;
    }
    if (stderr) console.error(`stderr: ${stderr}`);
    if (stdout) console.log(`stdout: ${stdout}`);
  });
}
