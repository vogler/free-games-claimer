export const PRIME_LOGIN_SELECTORS = Object.freeze({
  email: '#ap_email',
  emailSubmit: '#continue',
  password: '#ap_password',
  passwordSubmit: '#signInSubmit',
});

export const GOG_LOGIN_SELECTORS = Object.freeze({
  anonymous: 'button.menu-v3__top-bar-anonymous-only[gog-menu-v3-auth-action="login"]',
  account: 'button.menu-v3__top-bar-logged-in-only[gog-menu-v3-dropdown-trigger="user"]',
  username: '.menu-v3__mobile-nav-account-name',
});
