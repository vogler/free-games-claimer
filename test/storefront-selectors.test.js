import assert from 'node:assert/strict';
import test from 'node:test';

import { GOG_LOGIN_SELECTORS, PRIME_LOGIN_SELECTORS } from '../src/storefront-selectors.js';

test('Prime login targets Amazon credential controls by unique IDs', () => {
  assert.equal(PRIME_LOGIN_SELECTORS.email, '#ap_email');
  assert.equal(PRIME_LOGIN_SELECTORS.emailSubmit, '#continue');
  assert.equal(PRIME_LOGIN_SELECTORS.password, '#ap_password');
  assert.equal(PRIME_LOGIN_SELECTORS.passwordSubmit, '#signInSubmit');
  assert.notEqual(PRIME_LOGIN_SELECTORS.email, '[name=email]');
});

test('Prime email selector distinguishes the optional email step from the remembered-account claim', () => {
  assert.notEqual(PRIME_LOGIN_SELECTORS.email, '#ap-claim');
  assert.equal(PRIME_LOGIN_SELECTORS.password, '#ap_password');
});

test('GOG auth state targets the current desktop menu controls without nth selectors', () => {
  assert.equal(GOG_LOGIN_SELECTORS.anonymous, 'button.menu-v3__top-bar-anonymous-only[gog-menu-v3-auth-action="login"]');
  assert.equal(GOG_LOGIN_SELECTORS.account, 'button.menu-v3__top-bar-logged-in-only[gog-menu-v3-dropdown-trigger="user"]');
  assert.equal(GOG_LOGIN_SELECTORS.username, '.menu-v3__mobile-nav-account-name');
  assert.doesNotMatch(GOG_LOGIN_SELECTORS.anonymous, /nth|first/);
  assert.doesNotMatch(GOG_LOGIN_SELECTORS.account, /nth|first/);
});
