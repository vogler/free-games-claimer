// following https://github.com/vogler/free-games-claimer/issues/474

const get = async (platform = 'android') => { // or ios
  const r = await fetch(`https://egs-platform-service.store.epicgames.com/api/v2/public/discover/home?count=10&country=DE&locale=en&platform=${platform}&start=0&store=EGS`);
  return await r.json();
};

// $ jq '.data[].topicId' -r
// $ jq '.data[] | {topicId,type} | flatten | @tsv' -r
// mobile-android-carousel          featured
// mobile-android-featured-breaker  featured
// mobile-android-genre-must-play   interactiveIconList
// mobile-android-1pp               featured
// mobile-android-fn-exp            imageOnly
// android-mega-sale                interactiveIconList
// mobile-android-free-game         freeGame
// mobile-android-genre-action      featured
// mobile-android-genre-free        interactiveIconList
// mobile-android-genre-paid        interactiveIconList
// $ jq '.data[].offers[].content | {slug: .mapping.slug, price: (.purchase[] | {decimal: .price.decimalPrice, type: .purchaseType})}'
// {
//   "slug": "dc-heroes-united-android-de4bc2",
//   "price": {
//     "decimal": 0,
//     "type": "Claim"
//   }
// }
// {
//   "slug": "ashworld-android-abd8de",
//   "price": {
//     "decimal": 4.79,
//     "type": "Purchase"
//   }
// }

const url = s => `https://store.epicgames.com/en-US/p/${s}`;

export const getPlatformGames = async platform => {
  const json = await get(platform);
  const free_game = json.data.filter(x => x.type == 'freeGame')[0];
  // console.log(free_game);
  return free_game.offers.map(offer => {
    const c = offer.content;
    // console.log(c.purchase)
    return { title: c.title, url: url(c.mapping.slug) };
  });
};

export const getGames = async () => [...await getPlatformGames('android'), ...await getPlatformGames('ios')];

// console.log(await getGames());
