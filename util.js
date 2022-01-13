
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
