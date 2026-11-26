// Les trois analyses du panneau. Chacune lit l'API via `api.get(path)` (voir api.js)
// puis délègue les calculs à analysis.js. Aucune action de jeu n'est jamais envoyée.
import { FACEOFF, MARKET, RARITIES, RARITY } from './constants.js';
import { buildCards, cheatSheet, deckPoints, deckStrength, findBestDeck, isValidDeck } from './deck.js';
import {
  SNEP_API_LATEST,
  artistQuery,
  evaluateUpgrade,
  isoMinusDays,
  matchTrack,
  normalizeName,
  normalizeTitle,
  parseSnepHtml,
  rarityRank,
  searchQuery,
  snepSinglesUrl,
  targetRarity,
} from './snep.js';
import {
  collectionCandidates,
  demandCandidates,
  evaluateAuction,
  evaluateFlip,
  evaluateSale,
  filterSaleCandidates,
  mergeSaleCandidates,
  preScore,
  rankSales,
  reviewListing,
  screenAuctions,
  screenFlips,
  withoutListed,
} from './analysis.js';
import { PREFILL_EXTRA_DETAILS, prefillPlan } from './prefill.js';

const DETAIL_TTL = 5 * 60_000;

function wallet(game) {
  const s = game?.state ?? {};
  return { notes: s.notes ?? 0, gems: s.gems ?? 0 };
}

const budgetOf = (settings, w) => (settings.budget > 0 ? settings.budget : w.notes);

/** Horloge alignée sur le serveur (les dates de l'historique sont celles du serveur). */
function serverClock(serverNow, now) {
  const offset = Number.isFinite(serverNow) ? serverNow - now() : 0;
  return () => now() + offset;
}

const okFirst = (cmp) => (a, b) => Number(b.ok) - Number(a.ok) || cmp(a, b);

/** Achat sous la cote puis revente : quels titres acheter, et jusqu'à quel prix. */
export async function runBuy(api, settings, { now = Date.now, progress = () => {} } = {}) {
  progress('Lecture de ton solde…');
  const game = await api.get('/api/game');
  const clock = serverClock(game?.serverNow, now);
  const w = wallet(game);
  const budget = budgetOf(settings, w);
  const rarities = RARITIES.filter((r) => RARITY[r].min <= budget);

  const items = new Map();
  for (const [i, r] of rarities.entries()) {
    progress(`Lecture du Marché : ${RARITY[r].label} (${i + 1}/${rarities.length})…`);
    const qs = new URLSearchParams({
      sort: 'price',
      count: String(settings.scanCount),
      rarity: r,
      max: String(Math.floor(budget)),
    });
    const data = await api.get(`/api/market?${qs}`);
    for (const it of data?.items ?? []) if (it?.track?.id) items.set(it.track.id, it);
  }

  const candidates = screenFlips([...items.values()], {
    budget,
    minProfit: settings.minProfit,
    screenRatio: settings.screenRatio,
  });
  const top = candidates.slice(0, settings.maxDetails);
  const results = [];
  for (const [i, c] of top.entries()) {
    progress(`Ventes récentes : ${c.track.title} (${i + 1}/${top.length})…`);
    const detail = await api.get(`/api/market/${c.track.id}`, { ttlMs: DETAIL_TTL });
    const ev = evaluateFlip(detail, c.track, clock(), { ...settings, budget });
    if (ev) results.push(ev);
  }
  results.sort(okFirst((a, b) => b.profit - a.profit));
  return { at: now(), wallet: w, budget, scanned: items.size, screened: candidates.length, checked: top.length, results };
}

/** Enchères (Or et plus) qui se terminent bientôt sous leur valeur de revente. */
export async function runAuctions(api, settings, { now = Date.now, progress = () => {} } = {}) {
  progress('Lecture de ton solde…');
  const game = await api.get('/api/game');
  const w = wallet(game);
  const budget = budgetOf(settings, w);

  progress('Lecture des enchères…');
  const data = await api.get('/api/auctions', { ttlMs: 30_000 });
  const serverNow = Number.isFinite(data?.serverNow) ? data.serverNow : now();
  const open = data?.open ?? [];
  const candidates = screenAuctions(open, serverNow, { ...settings, budget });
  const top = candidates.slice(0, settings.maxDetails);

  const results = [];
  for (const [i, a] of top.entries()) {
    progress(`Ventes récentes : ${a.track.title} (${i + 1}/${top.length})…`);
    const detail = await api.get(`/api/market/${a.track.id}`, { ttlMs: DETAIL_TTL });
    results.push(evaluateAuction(a, detail, serverNow, { ...settings, budget }));
  }
  results.sort(okFirst((a, b) => b.profit - a.profit));
  return { at: now(), wallet: w, budget, open: open.length, screened: candidates.length, checked: top.length, results };
}

function summarizeDeck(cards) {
  return {
    cards,
    points: deckPoints(cards),
    strength: deckStrength(cards),
    valid: isValidDeck(cards),
    sheet: cheatSheet(cards),
  };
}

const MAX_SNEP_SEARCHES = 80;

/**
 * Certifications SNEP pas encore appliquées par WAX : lit le dernier lot de singles certifiés
 * sur snepmusique.com (`fetchText`), cherche chaque titre dans WAX et garde ceux encore
 * sous leur nouvelle rareté.
 */
export async function runSnep(api, settings, { now = Date.now, progress = () => {}, fetchText } = {}) {
  if (typeof fetchText !== 'function') throw new Error('Lecture du site du SNEP indisponible.');

  progress('Lecture des certifications du SNEP…');
  const certs = [];
  for (let page = 1; page <= 3; page += 1) {
    const items = parseSnepHtml(await fetchText(snepSinglesUrl(page))).filter((c) => /single/i.test(c.category));
    certs.push(...items);
    const latest = certs.reduce((m, c) => (c.certifiedOn && c.certifiedOn > m ? c.certifiedOn : m), '');
    if (!items.length || items.some((c) => c.certifiedOn && c.certifiedOn < isoMinusDays(latest, 6))) break;
  }
  if (!certs.length) throw new Error('Aucune certification lue sur le site du SNEP (la page a peut-être changé).');

  let publishedAt = null;
  try {
    const latestPost = JSON.parse(await fetchText(SNEP_API_LATEST));
    const t = Date.parse(`${latestPost?.[0]?.date_gmt}Z`);
    publishedAt = Number.isFinite(t) ? t : null;
  } catch {
    // information facultative
  }

  // Le dernier lot : les certifications constatées dans les 6 jours avant la plus récente.
  const latestCertifiedOn = certs.reduce((m, c) => (c.certifiedOn && c.certifiedOn > m ? c.certifiedOn : m), '');
  const cutoff = isoMinusDays(latestCertifiedOn, 6);
  const seen = new Set();
  const batch = certs.filter((c) => {
    const key = `${normalizeTitle(c.title)}|${normalizeName(c.artist)}`;
    if (!targetRarity(c.level) || !c.certifiedOn || c.certifiedOn < cutoff || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const game = await api.get('/api/game');
  const clock = serverClock(game?.serverNow, now);
  const w = wallet(game);
  const budget = budgetOf(settings, w);

  const pending = [];
  const already = [];
  const unmatched = [];
  const toCheck = batch.slice(0, MAX_SNEP_SEARCHES);
  for (const [i, cert] of toCheck.entries()) {
    progress(`Recherche dans WAX : ${cert.title} (${i + 1}/${toCheck.length})…`);
    const search = (q) => api.get(`/api/search?q=${encodeURIComponent(q)}`, { ttlMs: 10 * 60_000 });
    let track = matchTrack(cert, (await search(searchQuery(cert)))?.tracks ?? []);
    // Titre trop courant (ex. « Christophe » d'Orelsan, noyé parmi les sons du chanteur Christophe) :
    // seconde recherche par l'artiste principal.
    if (!track && artistQuery(cert)) track = matchTrack(cert, (await search(artistQuery(cert)))?.tracks ?? []);
    if (!track) {
      unmatched.push(cert);
      continue;
    }
    if (rarityRank(track.rarity) >= rarityRank(targetRarity(cert.level))) {
      already.push({ cert, track });
      continue;
    }
    const card = await api.get(`/api/cards/${track.id}`, { ttlMs: 5 * 60_000 });
    pending.push(evaluateUpgrade(cert, track, card, { budget, now: clock() }));
  }
  pending.sort((a, b) => Number(b.affordable) - Number(a.affordable) || (b.profit ?? -Infinity) - (a.profit ?? -Infinity));

  return {
    at: now(),
    wallet: w,
    budget,
    publishedAt,
    latestCertifiedOn,
    batchSize: batch.length,
    checked: toCheck.length,
    pending,
    already,
    unmatched,
  };
}

/** Fans de tous les artistes de ma collection (/api/artists?started=1, 60 par page comme le site). */
export async function fetchArtistFans(api, { progress = () => {}, maxPages = 40 } = {}) {
  const size = FACEOFF.artistsPageSize;
  const fans = {};
  let pages = null;
  for (let page = 0; page < maxPages && (pages == null || page < pages); page += 1) {
    progress(`Fans des artistes (${page + 1}/${pages ?? '…'})…`);
    const qs = new URLSearchParams({ started: '1', offset: String(page * size), limit: String(size) });
    const data = await api.get(`/api/artists?${qs}`, { ttlMs: FACEOFF.fansCacheMs });
    pages = Math.ceil((Number(data?.total) || 0) / size);
    const items = data?.items ?? [];
    for (const it of items) {
      if (it?.artist?.id != null && Number.isFinite(it.artist.fans)) fans[String(it.artist.id)] = it.artist.fans;
    }
    if (items.length < size) break;
  }
  return fans;
}

/**
 * Face to Face : le meilleur deck de 5 cartes de ma collection, comparé à mon deck actuel.
 * `fansCache` ({get, set}, optionnel) garde les fans des artistes 24 h entre deux analyses.
 */
export async function runDeck(api, settings, { now = Date.now, progress = () => {}, fansCache = null } = {}) {
  progress('Lecture de ta collection…');
  const game = await api.get('/api/game');
  const stats = await api.get('/api/stats');
  progress('Lecture de ton deck Face to Face…');
  const faceoff = await api.get('/api/faceoff', { ttlMs: 30_000 });

  // « L'artiste le plus suivi gagne » : il faut le vrai nombre de fans de chaque artiste.
  let fans = {};
  let fansSource = 'approx';
  let fansAt = null;
  const cached = await fansCache?.get?.();
  if (cached?.fans && Object.keys(cached.fans).length && now() - cached.at < FACEOFF.fansCacheMs) {
    fans = cached.fans;
    fansSource = 'cache';
    fansAt = cached.at;
  } else {
    try {
      fans = await fetchArtistFans(api, { progress });
      fansSource = Object.keys(fans).length ? 'api' : 'approx';
      fansAt = now();
      if (fansSource === 'api') await fansCache?.set?.({ at: fansAt, fans });
    } catch (e) {
      if (e?.code === 'ABORTED') throw e;
      fans = {};
    }
  }

  progress('Recherche du meilleur deck…');
  await new Promise((resolve) => setTimeout(resolve, 0)); // laisse le message s'afficher
  const cards = buildCards(game?.tracks ?? [], { values: stats?.values ?? {}, fans });
  const byId = new Map(cards.map((c) => [c.id, c]));
  const deckIds = (faceoff?.deck ?? []).map(String);
  const current = deckIds.map((id) => byId.get(id)).filter(Boolean);
  const best = findBestDeck(cards, { current });

  return {
    at: now(),
    wallet: wallet(game),
    gemsToday: faceoff?.gemsToday ?? null,
    gemsMax: faceoff?.gemsMax ?? null,
    collection: cards.length,
    fansSource,
    fansAt,
    current: current.length ? summarizeDeck(current) : null,
    missingFromDeck: deckIds.length - current.length,
    best: best ? summarizeDeck(best.cards) : null,
  };
}

/**
 * Mes annonces à corriger, et les cartes de ma collection à mettre en vente, les plus intéressantes d'abord :
 * doublons, cartes « hype » et cartes demandées (souhaits du Marché, annonces « Cherche » de WAX FM).
 * Selon les réglages, les cartes en coup de cœur et les titres de mes artistes protégés sont écartés.
 */
export async function runSell(api, settings, { now = Date.now, progress = () => {} } = {}) {
  progress('Lecture de ta collection…');
  const game = await api.get('/api/game');
  const clock = serverClock(game?.serverNow, now);
  const stats = await api.get('/api/stats');
  progress('Lecture de tes annonces…');
  const market = await api.get('/api/market?sort=recent&count=90', { ttlMs: 30_000 });

  const tracks = new Map();
  for (const t of [...(game?.tracks ?? []), ...(market?.mine?.tracks ?? [])]) if (t?.id) tracks.set(t.id, t);

  const open = (market?.mine?.listings ?? []).filter((l) => l.status === 'open');
  const listings = [];
  for (const [i, l] of open.entries()) {
    const track = tracks.get(l.trackId) ?? { id: l.trackId, title: `Titre ${l.trackId}`, artist: '', rarity: null };
    progress(`Tes annonces : ${track.title} (${i + 1}/${open.length})…`);
    const detail = await api.get(`/api/market/${l.trackId}`, { ttlMs: DETAIL_TTL });
    listings.push(reviewListing(l, detail, track, clock()));
  }
  const rank = { undercut: 0, low: 1, ok: 2 };
  listings.sort((a, b) => rank[a.status] - rank[b.status] || a.hoursLeft - b.hoursLeft);

  // Un numéro déjà en vente n'est jamais proposé une seconde fois.
  const listedSerials = {};
  for (const r of listings) if (r.serial != null) (listedSerials[String(r.listing.trackId)] ??= []).push(r.serial);
  const owned = withoutListed(stats, listedSerials);
  const listedTracks = new Set(open.map((l) => String(l.trackId)));

  // Cartes demandées : les plus souhaitées du Marché et les annonces « Cherche » du mur WAX FM.
  progress('Lecture des cartes demandées…');
  let wallPosts = [];
  try {
    wallPosts = (await api.get('/api/wall', { ttlMs: 30_000 }))?.posts ?? [];
  } catch (e) {
    if (e?.code === 'ABORTED') throw e;
  }
  const protectedArtists = game?.state?.protectArtists ?? [];
  const collection = collectionCandidates({
    tracks: game?.tracks ?? [],
    stats: owned,
    protectedArtists,
    hypeRatio: settings.hypeRatio,
    minValue: settings.minHypeValue,
  });
  const demand = demandCandidates({ wanted: market?.wanted ?? [], wallPosts, tracks: game?.tracks ?? [], stats: owned, protectedArtists });
  const { kept, liked } = filterSaleCandidates(mergeSaleCandidates(collection, demand.mine), settings);

  // Les fiches du Marché (1 requête chacune) vont aux cartes les plus prometteuses.
  const ranked = [...kept].sort((a, b) => preScore(b) - preScore(a));
  const top = ranked.slice(0, settings.maxDetails);
  const sales = [];
  for (const [i, c] of top.entries()) {
    progress(`Ta collection : ${c.track.title} (${i + 1}/${top.length})…`);
    const detail = await api.get(`/api/market/${c.track.id}`, { ttlMs: DETAIL_TTL });
    sales.push(evaluateSale(c, detail, clock()));
  }

  // Vente groupée : tant qu'il manque des ventes pour remplir les places libres, on lit d'autres fiches.
  // Un numéro en coup de cœur ne peut pas être prérempli : inutile de lire sa fiche.
  const free = Math.max(0, MARKET.maxOpenListings - open.length);
  const extra = ranked.slice(top.length).filter((c) => !c.sellIsFavorite).slice(0, PREFILL_EXTRA_DETAILS);
  for (const c of extra) {
    const ready = prefillPlan(sales, free).length;
    if (ready >= free) break;
    progress(`Places d’annonce à remplir : ${ready}/${free} · ${c.track.title}…`);
    const detail = await api.get(`/api/market/${c.track.id}`, { ttlMs: DETAIL_TTL });
    sales.push(evaluateSale(c, detail, clock()));
  }

  return {
    at: now(),
    wallet: wallet(game),
    collectionValue: stats?.value ?? null,
    rank: stats?.rank ?? null,
    players: stats?.players ?? null,
    openCount: open.length,
    maxOpen: MARKET.maxOpenListings,
    listings,
    candidates: kept.length,
    checked: sales.length,
    toSell: rankSales(sales),
    liked,
    options: { sellFavorites: settings.sellFavorites !== false, sellProtectedArtists: settings.sellProtectedArtists !== false },
    demandOthers: demand.others.filter((o) => !listedTracks.has(String(o.track.id))),
    wantPosts: wallPosts.filter((p) => p?.kind === 'want' && !p.mine).length,
  };
}
