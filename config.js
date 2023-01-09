// import * as dotenv from 'dotenv';
// dotenv.config({ path: 'data/config.env' });

export const cfg = {
  debug: process.env.PWDEBUG == '1', // runs non-headless and opens https://playwright.dev/docs/inspector
  dryrun: process.env.DRYRUN == '1', // don't claim anything
  show: process.env.SHOW == '1', // run non-headless
  get headless() { return !this.debug && !this.show },
  width: Number(process.env.WIDTH) || 1280,
  height: Number(process.env.HEIGHT) || 1280,
  timeout: (Number(process.env.TIMEOUT) || 20) * 1000, // 20s, default for playwright is 30s
  novnc_port: process.env.NOVNC_PORT,
  eg_email: process.env.EG_EMAIL || process.env.EMAIL,
  eg_password: process.env.EG_PASSWORD || process.env.PASSWORD,
  pg_email: process.env.PG_EMAIL || process.env.EMAIL,
  pg_password: process.env.PG_PASSWORD || process.env.PASSWORD,
  gog_email: process.env.GOG_EMAIL || process.env.EMAIL,
  gog_password: process.env.GOG_PASSWORD || process.env.PASSWORD,
};
