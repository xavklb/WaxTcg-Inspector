// Calculs purs (sans accès réseau) : prix, taxe, liquidité, opportunités.
import { MARKET, RARITY } from './constants.js';
import { fmt, pct } from './format.js';

const DAY = 86_400_000;

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function median(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** Ce que le vendeur touche : prix moins la taxe du Marché (arrondie au-dessus). */
export function netAfterTax(price, rate = MARKET.taxRate) {
  if (!(price > 0)) return 0;
  return price - Math.ceil(price * rate);
}

/** Prix d'achat le plus haut qui garde au moins `minProfit` et `minRoi` pour une revente nette `net`. */
export function maxBuyPrice(net, { minProfit = 0, minRoi = 0 } = {}) {
  // + 1e-9 : évite que 1100 / 1,1 = 999,999… soit arrondi à 999.
  return Math.max(0, Math.floor(Math.min(net - minProfit, net / (1 + minRoi)) + 1e-9));
}

/** Fourchette de prix autorisée : 75–200 % de la cote, bornée par la rareté. */
export function allowedRange(quote, rarity) {
  const lim = RARITY[rarity] ?? { min: 1, max: Number.MAX_SAFE_INTEGER };
  const min = Math.max(lim.min, Math.floor(quote * MARKET.below));
  const max = Math.min(lim.max, Math.floor(quote * MARKET.above));
  return { min, max: Math.max(min, max) };
}

/**
 * Statistiques de ventes d'un titre à partir de son historique [{at, price}].
 * perDay : ventes par jour sur les 7 derniers jours (sur au moins 1 jour pour un titre récent).
 * momentum : écart entre la médiane des 5 dernières ventes et celle des 10 précédentes.
 */
export function salesStats(history, now) {
  const sales = (history ?? [])
    .filter((s) => s && s.price > 0 && Number.isFinite(s.at) && s.at <= now)
    .sort((a, b) => b.at - a.at);
  if (!sales.length) {
    return { total: 0, count7d: 0, count24h: 0, perDay: 0, recentMedian: null, lastPrice: null, lastAt: null, momentum: null };
  }
  const oldest = sales[sales.length - 1].at;
  const count7d = sales.filter((s) => now - s.at <= 7 * DAY).length;
  const spanDays = clamp((now - oldest) / DAY, 1, 7);
  const recent = median(sales.slice(0, 5).map((s) => s.price));
  const older = median(sales.slice(5, 15).map((s) => s.price));
  return {
    total: sales.length,
    count7d,
    count24h: sales.filter((s) => now - s.at <= DAY).length,
    perDay: count7d / spanDays,
    recentMedian: Math.round(recent),
    lastPrice: sales[0].price,
    lastAt: sales[0].at,
    momentum: older ? (recent - older) / older : null,
  };
}

/** Annonces des autres joueurs, de la moins chère à la plus chère. */
export function otherListings(listings) {
  return (listings ?? []).filter((l) => l && !l.mine && l.price > 0).sort((a, b) => a.price - b.price);
}

/**
 * Prix de revente réaliste : médiane des dernières ventes (ou la cote s'il n'y en a pas),
 * juste sous le concurrent le moins cher, dans la fourchette autorisée.
 */
export function resalePrice({ quote, rarity, range, stats, competitor }) {
  const r = range ?? allowedRange(quote, rarity);
  let target = stats?.recentMedian ?? quote;
  if (competitor != null) target = Math.min(target, competitor - 1);
  return clamp(Math.round(target), r.min, r.max);
}

function liquidityReason(stats, minSales7d) {
  return stats.count7d < minSales7d ? `Peu de ventes (${stats.count7d} en 7 j)` : null;
}

// ---------------------------------------------------------------- Achat-revente

/** Premier tri, sans requête supplémentaire, sur la liste du Marché. */
export function screenFlips(items, { budget, minProfit = 0, screenRatio = 0.88 }) {
  return (items ?? [])
    .filter((it) => it?.track?.id && it.quote > 0 && it.best > 0 && it.best <= budget)
    .filter((it) => it.best <= it.quote * screenRatio)
    .map((it) => ({ ...it, potential: netAfterTax(it.quote) - it.best }))
    .filter((it) => it.potential >= minProfit)
    .sort((a, b) => b.potential - a.potential);
}

/** Vérifie une piste d'achat-revente avec la fiche détaillée du titre (/api/market/{id}). */
export function evaluateFlip(detail, track, now, settings) {
  const others = otherListings(detail?.listings);
  if (!others.length) return null;
  const buy = others[0];
  const stats = salesStats(detail.history, now);
  const quote = detail.quote ?? 0;
  const resale = resalePrice({
    quote,
    rarity: track.rarity,
    range: detail.range,
    stats,
    competitor: others[1]?.price ?? null,
  });
  const net = netAfterTax(resale);
  const profit = net - buy.price;
  const roi = buy.price > 0 ? profit / buy.price : 0;
  const reasons = [];
  if (buy.price > settings.budget) reasons.push(`Au-dessus du budget (${fmt(buy.price)} ♫)`);
  if (profit < settings.minProfit) reasons.push(`Gain trop faible (${fmt(profit)} ♫)`);
  else if (roi < settings.minRoi) reasons.push(`Rendement trop faible (${pct(roi).replace('+', '')})`);
  const liq = liquidityReason(stats, settings.minSales7d);
  if (liq) reasons.push(liq);
  return {
    kind: 'flip',
    track,
    quote,
    buy,
    competitors: others.length,
    resale,
    net,
    profit,
    roi,
    maxBuy: maxBuyPrice(net, settings),
    stats,
    daysToSell: stats.perDay > 0 ? 1 / stats.perDay : null,
    ok: reasons.length === 0,
    reasons,
  };
}

// ---------------------------------------------------------------- Enchères

const auctionPrice = (a) => a.next ?? a.bid ?? a.start;

/** Premier tri des enchères ouvertes (/api/auctions). */
export function screenAuctions(open, serverNow, { budget, auctionHorizonMin = 120, screenRatio = 0.88, minProfit = 0 }) {
  return (open ?? [])
    .filter((a) => a?.track?.id && !a.mine && !a.leading && !a.passed && a.quote > 0)
    .filter((a) => a.endsAt > serverNow && a.endsAt - serverNow <= auctionHorizonMin * 60_000)
    .map((a) => ({ ...a, price: auctionPrice(a), potential: netAfterTax(a.quote) - auctionPrice(a) }))
    .filter((a) => a.price <= budget && a.price <= a.quote * screenRatio && a.potential >= minProfit)
    .sort((x, y) => y.potential - x.potential);
}

export function evaluateAuction(auction, detail, serverNow, settings) {
  const others = otherListings(detail?.listings);
  const stats = salesStats(detail?.history, serverNow);
  const quote = detail?.quote ?? auction.quote;
  const resale = resalePrice({
    quote,
    rarity: auction.track.rarity,
    range: detail?.range,
    stats,
    competitor: others[0]?.price ?? null,
  });
  const net = netAfterTax(resale);
  const price = auctionPrice(auction);
  const profit = net - price;
  const roi = price > 0 ? profit / price : 0;
  const maxBid = maxBuyPrice(net, settings);
  const reasons = [];
  if (price > settings.budget) reasons.push(`Au-dessus du budget (${fmt(price)} ♫)`);
  if (price > maxBid) reasons.push(`Mise minimale (${fmt(price)} ♫) au-dessus de ta mise max (${fmt(maxBid)} ♫)`);
  const liq = liquidityReason(stats, settings.minSales7d);
  if (liq) reasons.push(liq);
  return {
    kind: 'auction',
    auction,
    track: auction.track,
    quote,
    price,
    resale,
    net,
    profit,
    roi,
    maxBid,
    stats,
    competitors: others.length,
    endsInMs: auction.endsAt - serverNow,
    ok: reasons.length === 0,
    reasons,
  };
}

// ---------------------------------------------------------------- Vente

/** Contrôle d'une de mes annonces ouvertes face aux autres vendeurs et aux ventes récentes. */
export function reviewListing(listing, detail, track, now) {
  const others = otherListings(detail?.listings);
  const stats = salesStats(detail?.history, now);
  const quote = detail?.quote ?? 0;
  const range = detail?.range ?? allowedRange(quote, track?.rarity);
  const cheapestOther = others[0]?.price ?? null;
  const fair = stats.recentMedian ?? quote;
  let status = 'ok';
  let suggested = listing.price;

  if (cheapestOther != null && cheapestOther < listing.price) {
    status = 'undercut';
    suggested = clamp(cheapestOther - 1, range.min, range.max);
  } else if (fair > 0 && listing.price < fair * 0.9) {
    const target = cheapestOther != null ? Math.min(fair, cheapestOther - 1) : fair;
    const up = clamp(Math.round(target), range.min, range.max);
    if (up > listing.price) {
      status = 'low';
      suggested = up;
    }
  }
  const hoursLeft = (listing.expiresAt - now) / 3_600_000;
  const mineEntry = (detail?.listings ?? []).find((l) => l && l.id === listing.id);
  return {
    listing,
    serial: mineEntry?.serial ?? null,
    track,
    quote,
    range,
    stats,
    cheapestOther,
    competitors: others.length,
    status,
    suggested,
    cantBeat: status === 'undercut' && suggested >= cheapestOther,
    net: netAfterTax(listing.price),
    suggestedNet: netAfterTax(suggested),
    hoursLeft,
    expiringSoon: hoursLeft < 6,
  };
}

/**
 * Cartes de ma collection à envisager de vendre :
 * - les doublons (on garde toujours le plus petit numéro) ;
 * - les cartes « hype », dont la valeur dépasse `hypeRatio` × la cote de base de leur rareté.
 * Les coups de cœur et les artistes protégés ne sont pas exclus mais signalés :
 * favorite / sellIsFavorite (le numéro à vendre est en coup de cœur), protectedArtist.
 * `stats` vient de /api/stats : copies {id: [[numéro, rareté d'origine], …]}, values, lockedSerials.
 * `protectedArtists` vient de /api/game (state.protectArtists) : identifiants d'artistes.
 */
export function collectionCandidates({ tracks, stats, protectedArtists = [], hypeRatio = 3, minValue = 0 }) {
  const protectedIds = new Set((protectedArtists ?? []).map(String));
  const out = [];
  for (const track of tracks ?? []) {
    if (!track?.id) continue;
    const copies = (stats?.copies?.[track.id] ?? []).map(([serial, origin]) => ({ serial, origin }));
    if (!copies.length) continue;
    const locked = new Set(stats?.lockedSerials?.[track.id] ?? []);
    const keep = Math.min(...copies.map((c) => c.serial));

    const duplicates = copies.length - 1;
    const value = stats?.values?.[track.id] ?? 0;
    const base = RARITY[track.rarity]?.base ?? 0;
    const ratio = base ? value / base : 0;
    const hype = ratio >= hypeRatio && value >= minValue;
    if (duplicates <= 0 && !hype) continue;

    // Numéro à vendre : le plus grand qui n'est ni gardé ni en coup de cœur,
    // sinon le plus grand hors coup de cœur, sinon un coup de cœur (il faudra retirer le cœur).
    const bySerialDesc = [...copies].sort((a, b) => b.serial - a.serial);
    const sell =
      (duplicates > 0 && bySerialDesc.find((c) => !locked.has(c.serial) && c.serial !== keep)) ||
      bySerialDesc.find((c) => !locked.has(c.serial)) ||
      bySerialDesc[0];
    out.push({
      track,
      value,
      ratio,
      copies: copies.length,
      duplicates,
      sellSerial: sell.serial,
      lastCopy: duplicates <= 0,
      upgradedFrom: copies.find((c) => c.origin)?.origin ?? null,
      reason: duplicates > 0 ? 'duplicate' : 'hype',
      favorite: locked.size > 0,
      favoriteSerials: [...locked].sort((a, b) => a - b),
      sellIsFavorite: locked.has(sell.serial),
      protectedArtist: protectedIds.has(String(track.artistId)),
    });
  }
  return out.sort((a, b) => (b.duplicates > 0) - (a.duplicates > 0) || b.value - a.value);
}

// ---------------------------------------------------------------- Cartes demandées

const WISHES_HOT = 100; // au-delà, une carte sans vendeur peut viser le prix maximum autorisé

/**
 * Cartes demandées que je possède, en croisant :
 * - `wanted` : les cartes les plus souhaitées du Marché ({track, wishes, best}, /api/market) ;
 * - `wallPosts` : les annonces du mur WAX FM ({kind: 'want' | 'give', track, who, note, at, mine}, /api/wall).
 * Renvoie `mine` (cartes que j'ai, à vendre) et `others` (les plus souhaitées que je n'ai pas).
 */
export function demandCandidates({ wanted = [], wallPosts = [], tracks = [], stats = {}, protectedArtists = [] }) {
  const ownedTracks = new Map((tracks ?? []).filter((t) => t?.id).map((t) => [String(t.id), t]));
  const protectedIds = new Set((protectedArtists ?? []).map(String));
  const byId = new Map();
  const entry = (track) => {
    const id = String(track.id);
    if (!byId.has(id)) byId.set(id, { track: ownedTracks.get(id) ?? track, wishes: 0, marketBest: null, topWanted: false, posts: [] });
    return byId.get(id);
  };
  for (const w of wanted ?? []) {
    if (!w?.track?.id) continue;
    const e = entry(w.track);
    e.wishes = Number(w.wishes) || 0;
    e.marketBest = w.best ?? null;
    e.topWanted = true;
  }
  for (const p of wallPosts ?? []) {
    if (p?.kind !== 'want' || p.mine || !p.track?.id) continue;
    entry(p.track).posts.push({ who: p.who ?? '', note: p.note ?? '', at: p.at ?? null });
  }

  const mine = [];
  const others = [];
  for (const e of byId.values()) {
    const id = String(e.track.id);
    const copies = (stats?.copies?.[id] ?? []).map(([serial, origin]) => ({ serial, origin }));
    const posts = e.posts.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    const base = { track: e.track, wishes: e.wishes, topWanted: e.topWanted, marketBest: e.marketBest, posts, requests: posts.length };
    if (!copies.length) {
      if (e.topWanted) others.push(base);
      continue;
    }
    const locked = new Set(stats?.lockedSerials?.[id] ?? []);
    const bySerialDesc = [...copies].sort((a, b) => b.serial - a.serial);
    const sell = bySerialDesc.find((c) => !locked.has(c.serial)) ?? bySerialDesc[0];
    mine.push({
      ...base,
      owned: copies.length,
      value: stats?.values?.[id] ?? null,
      sellSerial: sell.serial,
      lastCopy: copies.length === 1,
      upgradedFrom: copies.find((c) => c.origin)?.origin ?? null,
      favorite: locked.size > 0,
      favoriteSerials: [...locked].sort((a, b) => a - b),
      sellIsFavorite: locked.has(sell.serial),
      protectedArtist: protectedIds.has(String(e.track.artistId)),
    });
  }
  mine.sort((a, b) => b.wishes - a.wishes || b.requests - a.requests || (b.value ?? 0) - (a.value ?? 0));
  others.sort((a, b) => b.wishes - a.wishes);
  return { mine, others };
}

// ---------------------------------------------------------------- Vente : quoi vendre en premier

/** Poids du classement des ventes (voir evaluateSale). */
export const SELL_PRIORITY = Object.freeze({
  horizonDays: 3, // durée d'annonce la plus longue (72 h)
  lastCopy: 0.5, // un dernier exemplaire compte pour moitié : tu perds la carte et sa valeur de collection
  liked: 0.7, // coup de cœur ou artiste protégé (si tu acceptes de les vendre) : à gain égal, ils passent après
  falling: 1.2, // prix en baisse : mieux vaut vendre tout de suite
  fallingMomentum: -0.15, // baisse des 5 dernières ventes face aux 10 précédentes
  wantedBoost: 1.5, // premier tri (avant les fiches) : une carte demandée part plus facilement
});

/** Retire de ma collection les numéros que j'ai déjà mis en vente, s'ils y figurent encore. */
export function withoutListed(stats, listedSerials = {}) {
  const ids = Object.keys(listedSerials ?? {});
  if (!stats?.copies || !ids.length) return stats;
  const copies = { ...stats.copies };
  for (const id of ids) {
    const listed = new Set((listedSerials[id] ?? []).map(Number));
    if (copies[id]) copies[id] = copies[id].filter(([serial]) => !listed.has(Number(serial)));
  }
  return { ...stats, copies };
}

/**
 * Une seule liste de cartes à vendre : mes doublons et cartes « hype » (collectionCandidates),
 * enrichis par la demande, plus les cartes demandées que j'ai (demandCandidates().mine).
 * Chaque carte porte `wanted` (souhaitée au Marché ou cherchée sur WAX FM), `wishes`, `requests` et `posts`.
 */
export function mergeSaleCandidates(collection = [], demand = []) {
  const byId = new Map();
  const noDemand = { wishes: 0, requests: 0, posts: [], topWanted: false, marketBest: null, wanted: false };
  for (const c of collection ?? []) if (c?.track?.id) byId.set(String(c.track.id), { ...noDemand, ...c });
  for (const d of demand ?? []) {
    if (!d?.track?.id) continue;
    const info = {
      wishes: d.wishes ?? 0,
      requests: d.requests ?? 0,
      posts: d.posts ?? [],
      topWanted: Boolean(d.topWanted),
      marketBest: d.marketBest ?? null,
    };
    info.wanted = info.wishes > 0 || info.requests > 0;
    const id = String(d.track.id);
    const known = byId.get(id);
    if (known) {
      Object.assign(known, info);
      continue;
    }
    const base = RARITY[d.track.rarity]?.base ?? 0;
    const value = d.value ?? 0;
    byId.set(id, {
      track: d.track,
      value,
      ratio: base ? value / base : 0,
      copies: d.owned,
      duplicates: d.owned - 1,
      sellSerial: d.sellSerial,
      lastCopy: d.lastCopy,
      upgradedFrom: d.upgradedFrom ?? null,
      reason: d.owned > 1 ? 'duplicate' : 'demand',
      favorite: d.favorite,
      favoriteSerials: d.favoriteSerials,
      sellIsFavorite: d.sellIsFavorite,
      protectedArtist: d.protectedArtist,
      ...info,
    });
  }
  return [...byId.values()];
}

/**
 * Écarte, selon mes réglages, les cartes en coup de cœur (le numéro à vendre a un cœur)
 * et les titres de mes artistes protégés. `liked` compte ces cartes, écartées ou non.
 */
export function filterSaleCandidates(cands, { sellFavorites = true, sellProtectedArtists = true } = {}) {
  const liked = { favorites: 0, protectedArtists: 0 };
  const kept = [];
  for (const c of cands ?? []) {
    if (c.sellIsFavorite) liked.favorites += 1;
    if (c.protectedArtist) liked.protectedArtists += 1;
    if ((c.sellIsFavorite && !sellFavorites) || (c.protectedArtist && !sellProtectedArtists)) continue;
    kept.push(c);
  }
  return { kept, liked };
}

const likedFactor = (c) => (c.sellIsFavorite ? SELL_PRIORITY.liked : 1) * (c.protectedArtist ? SELL_PRIORITY.liked : 1);
const keepFactor = (c) => (c.duplicates > 0 ? 1 : SELL_PRIORITY.lastCopy);
const recycleOf = (track) => RARITY[track?.rarity]?.recycle ?? 0;

/** Premier tri, avant de lire les fiches du Marché : valeur nette estimée, demande, coups de cœur. */
export function preScore(cand) {
  const net = netAfterTax(cand.value ?? 0);
  const gain = cand.duplicates > 0 ? net - recycleOf(cand.track) : net;
  return Math.max(0, gain) * keepFactor(cand) * likedFactor(cand) * (cand.wanted ? SELL_PRIORITY.wantedBoost : 1);
}

/**
 * Prime sur la cote quand personne d'autre n'en vend : ×2 (maximum autorisé) au-delà de 100 souhaits,
 * ×1,5 si plusieurs joueurs la cherchent ou si elle est souhaitée, ×1,25 sinon.
 */
export function demandPremium({ wishes = 0, requests = 0 } = {}) {
  if (wishes >= WISHES_HOT) return MARKET.above;
  return requests >= 2 || wishes > 0 ? 1.5 : 1.25;
}

/**
 * Chances de vendre sous `horizonDays` jours : les acheteurs arrivent au rythme des ventes des 7 derniers jours
 * (loi de Poisson) et prennent d'abord les annonces moins chères ou au même prix (`ahead`, les miennes comprises).
 * Une carte demandée a au moins 50 % de chances, 75 % sans autre vendeur, 90 % au-delà de 100 souhaits.
 */
export function saleChance({ perDay = 0, ahead = 0, wanted = false, noSeller = false, wishes = 0, horizonDays = SELL_PRIORITY.horizonDays } = {}) {
  const mu = Math.max(0, perDay) * horizonDays;
  let term = Math.exp(-mu);
  let below = 0; // P(moins de ahead + 1 acheteurs)
  for (let i = 0; i <= Math.min(Math.max(0, ahead), 50); i += 1) {
    below += term;
    term *= mu / (i + 1);
  }
  let p = 1 - below;
  if (wanted) p = Math.max(p, noSeller ? (wishes >= WISHES_HOT ? 0.9 : 0.75) : 0.5);
  return clamp(p, 0.02, 0.99);
}

/**
 * Prix conseillé, chances de vente et priorité d'une carte de ma collection, avec la fiche du titre (/api/market/{id}).
 *
 * Prix conseillé (`price`) :
 * - personne d'autre n'en vend : prime de demande sur la cote si elle est demandée (demandPremium),
 *   sinon le prix des dernières ventes ;
 * - sinon juste sous le moins cher des autres vendeurs, sans dépasser le prix des dernières ventes
 *   si elle n'est pas demandée.
 * `fairPrice` : le prix des dernières ventes (médiane des 5 dernières, ou la cote).
 *
 * Priorité (`score`, en ♫) = gain × chances de vendre sous 3 jours, puis :
 * ×0,5 pour un dernier exemplaire, ×0,7 pour un coup de cœur ou un artiste protégé, ×1,2 si le prix baisse.
 * Le gain d'un doublon est ce que la vente rapporte de plus que le recyclage.
 */
export function evaluateSale(cand, detail, now) {
  const listings = (detail?.listings ?? []).filter((l) => l && l.price > 0);
  const others = otherListings(listings);
  const stats = salesStats(detail?.history, now);
  const quote = detail?.quote ?? cand.value ?? 0;
  const range = detail?.range ?? allowedRange(quote, cand.track.rarity);
  const cheapestOther = others[0]?.price ?? null;
  const fairPrice = clamp(Math.round(stats.recentMedian ?? quote), range.min, range.max);
  const wanted = cand.wanted ?? ((cand.wishes ?? 0) > 0 || (cand.requests ?? 0) > 0);
  const recycle = recycleOf(cand.track);

  let premium = null;
  let price;
  if (cheapestOther == null) {
    premium = wanted ? demandPremium(cand) : null;
    price = premium ? clamp(Math.round(Math.max(fairPrice, quote) * premium), range.min, range.max) : fairPrice;
  } else {
    price = clamp(wanted ? cheapestOther - 1 : Math.min(fairPrice, cheapestOther - 1), range.min, range.max);
  }
  const net = netAfterTax(price);
  const ahead = listings.filter((l) => l.price <= price).length;
  const chance = saleChance({ perDay: stats.perDay, ahead, wanted, noSeller: cheapestOther == null, wishes: cand.wishes ?? 0 });
  const falling = stats.momentum != null && stats.momentum <= SELL_PRIORITY.fallingMomentum;
  const gain = cand.duplicates > 0 ? net - recycle : net;

  let verdict = 'sell';
  if (cand.duplicates > 0 && net <= recycle) verdict = 'recycle';
  else if (wanted && cheapestOther == null) verdict = 'no-seller';
  else if (stats.count7d === 0 && !wanted) verdict = 'illiquid';
  else if (falling) verdict = 'sell-fast';

  const score =
    verdict === 'recycle' ? 0 : Math.max(0, gain) * chance * keepFactor(cand) * likedFactor(cand) * (falling ? SELL_PRIORITY.falling : 1);

  return {
    ...cand,
    wanted,
    quote,
    range,
    stats,
    cheapestOther,
    competitors: others.length,
    ahead,
    listedByMe: listings.filter((l) => l.mine).length,
    cantBeat: cheapestOther != null && price >= cheapestOther,
    premium,
    price,
    net,
    fairPrice,
    fairNet: netAfterTax(fairPrice),
    recycle,
    gain,
    chance,
    falling,
    score: Math.round(score),
    verdict,
  };
}

/** Les ventes les plus intéressantes d'abord ; celles qu'il vaut mieux recycler à la fin. */
export function rankSales(sales) {
  return [...(sales ?? [])].sort(
    (a, b) => Number(a.verdict === 'recycle') - Number(b.verdict === 'recycle') || b.score - a.score || b.net - a.net,
  );
}
