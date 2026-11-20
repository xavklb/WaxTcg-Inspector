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

/**
 * Prix conseillé pour une carte demandée :
 * - quelqu'un en vend → juste sous le moins cher ;
 * - personne n'en vend → prime de demande sur la cote : ×2 (maximum autorisé) si plus de 100 souhaits,
 *   ×1,5 si plusieurs joueurs la cherchent ou si elle est souhaitée, ×1,25 sinon.
 */
export function evaluateDemandSale(cand, detail, now) {
  const others = otherListings(detail?.listings);
  const stats = salesStats(detail?.history, now);
  const quote = detail?.quote ?? cand.value ?? 0;
  const range = detail?.range ?? allowedRange(quote, cand.track.rarity);
  const cheapestOther = others[0]?.price ?? null;
  const fairPrice = clamp(Math.round(stats.recentMedian ?? quote), range.min, range.max);
  let premium = null;
  let price;
  if (cheapestOther == null) {
    premium = cand.wishes >= WISHES_HOT ? MARKET.above : cand.requests >= 2 || cand.wishes > 0 ? 1.5 : 1.25;
    price = clamp(Math.round(Math.max(fairPrice, quote) * premium), range.min, range.max);
  } else {
    price = clamp(cheapestOther - 1, range.min, range.max);
  }
  return {
    ...cand,
    quote,
    range,
    stats,
    cheapestOther,
    competitors: others.length,
    premium,
    price,
    net: netAfterTax(price),
    fairPrice,
    fairNet: netAfterTax(fairPrice),
    verdict: cheapestOther == null ? 'no-seller' : 'compete',
  };
}

/** Prix conseillés pour une carte de ma collection, avec la fiche détaillée du titre. */
export function evaluateSale(candidate, detail, now) {
  const others = otherListings(detail?.listings);
  const stats = salesStats(detail?.history, now);
  const quote = detail?.quote ?? candidate.value;
  const range = detail?.range ?? allowedRange(quote, candidate.track.rarity);
  const cheapestOther = others[0]?.price ?? null;
  const fairPrice = clamp(Math.round(stats.recentMedian ?? quote), range.min, range.max);
  const fastPrice = cheapestOther != null ? clamp(Math.min(fairPrice, cheapestOther - 1), range.min, range.max) : fairPrice;
  const recycle = RARITY[candidate.track.rarity]?.recycle ?? 0;

  let verdict = 'sell';
  if (candidate.duplicates > 0 && netAfterTax(fastPrice) <= recycle) verdict = 'recycle';
  else if (stats.count7d === 0) verdict = 'illiquid';
  else if (stats.momentum != null && stats.momentum <= -0.15) verdict = 'sell-fast';

  return {
    ...candidate,
    quote,
    range,
    stats,
    cheapestOther,
    competitors: others.length,
    fairPrice,
    fastPrice,
    fairNet: netAfterTax(fairPrice),
    fastNet: netAfterTax(fastPrice),
    recycle,
    verdict,
  };
}
