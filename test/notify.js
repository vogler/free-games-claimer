/* eslint-disable no-constant-condition */
import { delay, html_game_list, notify } from '../src/util.js';
import { cfg } from '../src/config.js';

const URL_CLAIM = 'https://gaming.amazon.com/home'; // dummy URL

console.debug('NOTIFY:', cfg.notify);

if (true) {
  const notify_games = [
    // { title: 'Kerbal Space Program', status: 'claimed', url: URL_CLAIM },
    // { title: "Shadow Tactics - Aiko's Choice", status: 'claimed', url: URL_CLAIM },
    { title: 'Epistory - Typing Chronicles', status: 'claimed', url: URL_CLAIM },
  ];
  await notify(`epic-games:<br>${html_game_list(notify_games)}`);
}

if (false) {
  await delay(1000);
  const notify_games = [
    { title: 'Faraway 2: Jungle Escape', status: 'claimed', url: URL_CLAIM },
    { title: 'Chicken Police - Paint it RED!', status: 'claimed', url: URL_CLAIM },
    { title: 'Lawn Mowing Simulator', status: 'claimed', url: URL_CLAIM },
    { title: 'Breathedge', status: 'claimed', url: URL_CLAIM },
    { title: 'The Evil Within 2', status: `<a href="${URL_CLAIM}">redeem</a> H97S6FB38FA6D09DEA on gog.com`, url: URL_CLAIM },
    { title: 'Beat Cop', status: `<a href="${URL_CLAIM}">redeem</a> BMKM8558EC55F7B38F on gog.com`, url: URL_CLAIM },
    { title: 'Dishonored 2', status: `<a href="${URL_CLAIM}">redeem</a> NNEK0987AB20DFBF8F on gog.com`, url: URL_CLAIM },
  ];
  notify(`prime-gaming:<br>${html_game_list(notify_games)}`);
}

if (false) {
  await delay(1000);
  const notify_games = [
    { title: 'Haven Park', status: 'claimed', url: URL_CLAIM },
  ];
  notify(`gog:<br>${html_game_list(notify_games)}`);
}
