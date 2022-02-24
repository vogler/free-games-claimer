
// stealth with playwright: https://github.com/berstend/puppeteer-extra/issues/454#issuecomment-917437212
const newStealthContext = async (browser, contextOptions = {}) => {
  if (!debug) { // fix userAgent in headless mode
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

const stealth = async (context) => {
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
  const evasions = enabledEvasions.map(e => require(`puppeteer-extra-plugin-stealth/evasions/${e}`));
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
}

module.exports = { stealth };
