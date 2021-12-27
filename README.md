# epicgames-claimer

Tried https://github.com/Revadike/epicgames-freebies-claimer, but it does not work anymore since epicgames introduced hcaptcha:
https://github.com/Revadike/epicgames-freebies-claimer/issues/172

Played around with puppeteer before, now trying newer https://playwright.dev which is pretty similar.
Playwright Inspector and `codegen` to generate scripts are nice, but failed to generate the right code for iframe.
Works up to button 'I Agree', then it shows an hcaptcha.

- https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra
  - https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth
  - https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-recaptcha
  - `playwright-extra@next`: https://github.com/berstend/puppeteer-extra/pull/303#issuecomment-775277480
