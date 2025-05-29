import { chromium } from 'patchright';
import { handleSIGINT, prompt } from '../src/util.js';
import { cfg } from '../src/config.js';

const context = await chromium.launchPersistentContext(cfg.dir.browser, {
    headless: false, // don't use cfg.headless headless here since SHOW=0 will lead to captcha
    locale: 'en-US', // ignore OS locale to be sure to have english text for locators
    recordVideo: cfg.record ? { dir: 'data/record/', size: { width: cfg.width, height: cfg.height } } : undefined, // will record a .webm video for each page navigated; without size, video would be scaled down to fit 800x800
    handleSIGINT: false, // have to handle ourselves and call context.close(), otherwise recordings from above won't be saved
    // https://peter.sh/experiments/chromium-command-line-switches/
    args: [
        '--hide-crash-restore-bubble',
        '--ignore-gpu-blocklist', // required for OpenGL to be enabled
    ],
});

handleSIGINT(context);

const page = context.pages().length ? context.pages()[0] : await context.newPage(); // should always exist
await page.goto('https://get.webgl.org/');
console.log(await page.locator('h1').innerText());
await page.goto('https://webglreport.com/?v=2');
console.log(await page.locator('tr:has-text("Unmasked Renderer")').innerText());
console.log('Waiting. You can check chrome://gpu as well via noVNC. Press ctrl-c to quit...')
// without --ignore-gpu-blocklist: OpenGL Disabled, WebGL: Software only, hardware acceleration unavailable.
// Unmasked Renderer: ANGLE (Mesa, llvmpipe (LLVM 15.0.7 128 bits), OpenGL 4.5)
// with --ignore-gpu-blocklist: OpenGL Enabled, WebGL: Hardware accelerated
// Unmasked Renderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)