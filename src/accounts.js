// Shared accounts database: maps platform + email -> username
import { jsonDb } from './util.js';

const accountsDb = await jsonDb('accounts.json', {});

/**
 * Get username for email from accounts db (if known)
 * @param {string} platform - Platform name (e.g., 'epic-games', 'gog', 'steam')
 * @param {string} email - User's email
 * @returns {string|undefined} - Username if known, undefined otherwise
 */
export function getUsername(platform, email) {
  return accountsDb.data[platform]?.[email];
}

/**
 * Save username for email to accounts db
 * @param {string} platform - Platform name
 * @param {string} email - User's email
 * @param {string} username - Username to save
 */
export function setUsername(platform, email, username) {
  accountsDb.data[platform] ||= {};
  if (accountsDb.data[platform][email] !== username) {
    accountsDb.data[platform][email] = username;
    console.log(`[Accounts] Saved: ${platform}/${email} -> ${username}`);
  }
}

/**
 * Write accounts db to disk
 */
export async function writeAccountsDb() {
  await accountsDb.write();
}
