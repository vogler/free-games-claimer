// GamerPower URL resolution module
// Resolves giveaway URLs to store URLs (Epic Games, Steam, etc.)
// Transparently handles caching and browser-based resolution

import { chromium } from 'patchright';
import { jsonDb, datetime, handleSIGINT } from './util.js';
import { cfg } from './config.js';

const gpCache = await jsonDb('gp-cache.json', {});

/**
 * Fetches giveaways from a GamerPower API URL
 * @param {string} apiUrl - The GamerPower API URL (e.g., https://www.gamerpower.com/api/giveaways?platform=steam&type=game)
 * @returns {Promise<Array>} - Array of giveaway objects from the API
 */
async function fetchGamerPowerGiveaways(apiUrl) {
  console.log('[GamerPower] Fetching giveaways from API...');
  const response = await fetch(apiUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch GamerPower data: ${response.statusText}`);
  }

  const data = await response.json();

  // API returns {status: 0, status_message: "..."} when no giveaways available
  if (!Array.isArray(data)) {
    const NO_GIVEAWAYS_MSG = 'No active giveaways available at the moment, please try again later.';
    if (data.status_message === NO_GIVEAWAYS_MSG) {
      console.log('[GamerPower] No active giveaways available');
      return [];
    }
    throw new Error(`GamerPower API error: ${data.status_message || JSON.stringify(data)}`);
  }

  console.log(`[GamerPower] Fetched ${data.length} giveaways`);
  return data;
}

/**
 * Checks if a giveaway URL is already cached
 * @param {string} giveawayUrl - The GamerPower open_giveaway_url
 * @returns {Object|null} - Cached entry or null if not cached
 */
function getCachedUrl(giveawayUrl) {
  return gpCache.data[giveawayUrl] || null;
}

/**
 * Strips query parameters from a URL
 * @param {string} url - The URL to clean
 * @returns {string} - URL without query parameters
 */
function stripQueryParams(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return url.split('?')[0];
  }
}

/**
 * Caches a resolved giveaway URL
 * @param {string} giveawayUrl - The GamerPower open_giveaway_url
 * @param {string} storeUrl - The resolved store URL (will be cleaned of query params)
 */
function cacheUrl(giveawayUrl, storeUrl) {
  const cleanUrl = stripQueryParams(storeUrl);
  gpCache.data[giveawayUrl] = {
    storeUrl: cleanUrl,
    time: datetime()
  };
  console.log(`[GamerPower] Cached: ${giveawayUrl} -> ${cleanUrl}`);
}

/**
 * Resolves giveaway URLs that aren't cached yet using a browser
 * @param {Array} urlsToResolve - Array of giveaway URLs to resolve
 * @returns {Promise<Object>} - Map of giveawayUrl -> storeUrl
 */
async function resolveUrlsWithBrowser(urlsToResolve) {
  if (urlsToResolve.length === 0) {
    return {};
  }

  console.log(`[GamerPower] Resolving ${urlsToResolve.length} URLs with browser...`);

  const context = await chromium.launchPersistentContext(cfg.dir.browser, {
    headless: cfg.headless,
    viewport: { width: cfg.width, height: cfg.height },
    locale: 'en-US',
    handleSIGINT: false,
    args: ['--hide-crash-restore-bubble'],
  });

  handleSIGINT(context);

  const page = context.pages().length ? context.pages()[0] : await context.newPage();

  const resolved = {};

  try {
    for (const giveawayUrl of urlsToResolve) {
      console.log(`[GamerPower] Resolving: ${giveawayUrl}`);
      await page.goto(giveawayUrl, { waitUntil: 'domcontentloaded' });
      const storeUrl = page.url();

      cacheUrl(giveawayUrl, storeUrl);
      resolved[giveawayUrl] = storeUrl;
    }

    await gpCache.write();
  } finally {
    await context.close();
  }

  return resolved;
}

/**
 * Main function: Fetches giveaways from GamerPower API and returns resolved store URLs
 *
 * This function:
 * 1. Fetches giveaways from the API (no browser needed)
 * 2. Returns cached store URLs immediately for known giveaways
 * 3. Opens a browser to resolve any new giveaway URLs (transparent to caller)
 * 4. Returns a list of { giveawayUrl, storeUrl } objects
 *
 * @param {string} apiUrl - The GamerPower API URL
 * @returns {Promise<Array<{giveawayUrl: string, storeUrl: string}>>} - Array of resolved URLs
 */
export async function gpUrlToStoreUrls(apiUrl) {
  const giveaways = await fetchGamerPowerGiveaways(apiUrl);

  const cachedResults = [];
  const urlsToResolve = [];

  for (const giveaway of giveaways) {
    const giveawayUrl = giveaway.open_giveaway_url;
    const cached = getCachedUrl(giveawayUrl);

    if (cached) {
      cachedResults.push({
        giveawayUrl,
        storeUrl: cached.storeUrl,
        title: giveaway.title
      });
    } else {
      urlsToResolve.push(giveawayUrl);
    }
  }

  console.log(`[GamerPower] ${cachedResults.length} cached, ${urlsToResolve.length} need resolution`);

  // Resolve any uncached URLs with browser
  const newlyResolved = await resolveUrlsWithBrowser(urlsToResolve);

  // Combine cached and newly resolved
  const allResults = [...cachedResults];

  for (const giveaway of giveaways) {
    const giveawayUrl = giveaway.open_giveaway_url;
    if (newlyResolved[giveawayUrl]) {
      allResults.push({
        giveawayUrl,
        storeUrl: newlyResolved[giveawayUrl],
        title: giveaway.title
      });
    }
  }

  return allResults;
}
