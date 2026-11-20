import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedRange,
  collectionCandidates,
  evaluateAuction,
  evaluateFlip,
  evaluateSale,
  maxBuyPrice,
  median,
  netAfterTax,
  resalePrice,
  reviewListing,
  salesStats,
  screenAuctions,
  screenFlips,
} from '../extension/lib/analysis.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../extension/lib/constants.js';

const H = 3_600_000;
const DAY = 24 * H;
const NOW = 1_795_171_000_000;
const settings = { ...DEFAULT_SETTINGS, budget: 5000, minProfit: 20, minRoi: 0.1, minSales7d: 3 };
const track = (id, rarity = 'or', title = `Titre ${id}`) => ({ id: String(id), title, artist: 'Artiste', rarity });
const sales = (...pairs) => pairs.map(([hoursAgo, price]) => ({ at: NOW - hoursAgo * H, price }));

test('taxe de 5 % arrondie au-dessus', () => {
  assert.equal(netAfterTax(440), 418);
  assert.equal(netAfterTax(441), 418); // 22,05 → 23
  assert.equal(netAfterTax(10), 9);
  assert.equal(netAfterTax(0), 0);
  assert.equal(netAfterTax(-5), 0);
});

test('fourchette autorisée : 75–200 % de la cote, bornée par la rareté', () => {
  // Relevé sur le site : PADAWAN (Populaire), cote 441 → 330 à 800.
  assert.deepEqual(allowedRange(441, 'single'), { min: 330, max: 800 });
  assert.deepEqual(allowedRange(2000, 'or'), { min: 1500, max: 4000 });
  assert.deepEqual(allowedRange(100, 'or'), { min: 200, max: 200 });
});

test('prix d’achat max selon gain et rendement minimum', () => {
  assert.equal(maxBuyPrice(1100, { minProfit: 20, minRoi: 0.1 }), 1000);
  assert.equal(maxBuyPrice(100, { minProfit: 20, minRoi: 0 }), 80);
  assert.equal(maxBuyPrice(10, { minProfit: 20 }), 0);
});

test('médiane', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test('statistiques de ventes : volume, rythme, médiane récente, tendance', () => {
  const s = salesStats(sales([1, 100], [2, 110], [3, 90], [30, 120], [50, 100], [200, 300], [210, 300], [220, 300]), NOW);
  assert.equal(s.total, 8);
  assert.equal(s.count24h, 3);
  assert.equal(s.count7d, 5);
  assert.equal(s.perDay, 5 / 7);
  assert.equal(s.recentMedian, 100);
  assert.equal(s.lastPrice, 100);
  assert.equal(s.momentum, (100 - 300) / 300);
});

test('un titre tout récent compte son rythme sur au moins 1 jour', () => {
  const s = salesStats(sales([1, 400], [2, 450], [5, 500]), NOW);
  assert.equal(s.perDay, 3);
});

test('statistiques sans vente', () => {
  const s = salesStats([], NOW);
  assert.equal(s.count7d, 0);
  assert.equal(s.recentMedian, null);
});

test('prix de revente : sous le concurrent, dans la fourchette', () => {
  const stats = { recentMedian: 1000 };
  assert.equal(resalePrice({ quote: 1000, rarity: 'or', stats, competitor: 950 }), 949);
  assert.equal(resalePrice({ quote: 1000, rarity: 'or', stats, competitor: null }), 1000);
  assert.equal(resalePrice({ quote: 1000, rarity: 'or', stats, competitor: 600 }), 750); // plancher 75 %
});

test('premier tri des pistes d’achat', () => {
  const items = [
    { track: track(1), best: 800, quote: 1000 }, // 950 - 800 = 150
    { track: track(2), best: 950, quote: 1000 }, // trop proche de la cote
    { track: track(3), best: 600, quote: 1000 }, // 350, la meilleure
    { track: track(4), best: 6000, quote: 9000 }, // hors budget
  ];
  const out = screenFlips(items, { budget: 5000, minProfit: 20, screenRatio: 0.88 });
  assert.deepEqual(out.map((x) => x.track.id), ['3', '1']);
  assert.equal(out[0].potential, 350);
});

test('achat-revente rentable et liquide', () => {
  const detail = {
    quote: 1000,
    range: { min: 750, max: 2000 },
    listings: [
      { id: 1, price: 760, mine: false, serial: 900 },
      { id: 2, price: 990, mine: false },
      { id: 3, price: 700, mine: true },
    ],
    history: sales([2, 1000], [5, 1010], [20, 980], [40, 1000], [60, 1020]),
  };
  const r = evaluateFlip(detail, track(9), NOW, settings);
  assert.equal(r.buy.id, 1); // ma propre annonce est ignorée
  assert.equal(r.resale, 989); // sous le 2e vendeur
  assert.equal(r.net, 939);
  assert.equal(r.profit, 179);
  assert.ok(r.ok);
  assert.deepEqual(r.reasons, []);
});

test('achat-revente écarté si le titre ne se vend pas', () => {
  const detail = {
    quote: 1000,
    listings: [{ id: 1, price: 760, mine: false }],
    history: sales([500, 1000]),
  };
  const r = evaluateFlip(detail, track(9), NOW, settings);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(), /Peu de ventes/);
});

test('aucune annonce d’un autre joueur : rien à acheter', () => {
  assert.equal(evaluateFlip({ quote: 1000, listings: [{ id: 1, price: 800, mine: true }], history: [] }, track(1), NOW, settings), null);
});

test('enchères : fenêtre de temps, budget, sous la cote', () => {
  const a = (id, over) => ({ id, track: track(id), quote: 2000, start: 1000, bid: 1200, next: 1280, endsAt: NOW + 30 * 60_000, mine: false, leading: false, ...over });
  const open = [
    a(1),
    a(2, { endsAt: NOW + 5 * H }), // trop loin
    a(3, { leading: true }), // déjà en tête
    a(4, { next: 1900 }), // trop proche de la cote
    a(5, { endsAt: NOW - 1000 }), // terminée
  ];
  const out = screenAuctions(open, NOW, { budget: 5000, auctionHorizonMin: 120, screenRatio: 0.88, minProfit: 20 });
  assert.deepEqual(out.map((x) => x.id), [1]);
  assert.equal(out[0].price, 1280);
});

test('enchère : mise max conseillée', () => {
  const auction = { id: 1, track: track(1), quote: 2000, start: 1000, bid: 1200, next: 1280, max: 4000, endsAt: NOW + 10 * 60_000 };
  const detail = { quote: 2000, range: { min: 1500, max: 4000 }, listings: [{ id: 7, price: 2100, mine: false }], history: sales([1, 2000], [3, 1950], [8, 2050], [30, 2000]) };
  const r = evaluateAuction(auction, detail, NOW, settings);
  assert.equal(r.resale, 2000);
  assert.equal(r.net, 1900);
  assert.equal(r.maxBid, 1727); // 1900 / 1,1
  assert.equal(r.profit, 620);
  assert.ok(r.ok);
  assert.equal(r.endsInMs, 10 * 60_000);
});

test('annonce dépassée par un autre vendeur', () => {
  const listing = { id: 5, trackId: '1', price: 1665, expiresAt: NOW + 47 * H };
  const detail = { quote: 2220, range: { min: 1665, max: 4440 }, listings: [{ id: 5, price: 1665, mine: true }, { id: 6, price: 1700, mine: false }], history: sales([10, 1800], [30, 1800], [60, 1200]) };
  const ok = reviewListing(listing, detail, track(1, 'platine'), NOW);
  assert.equal(ok.status, 'ok'); // la moins chère, même si bas : 1665 >= 0,9 × 1800

  const detail2 = { ...detail, listings: [{ id: 5, price: 1800, mine: true }, { id: 6, price: 1700, mine: false }] };
  const r = reviewListing({ ...listing, price: 1800 }, detail2, track(1, 'platine'), NOW);
  assert.equal(r.status, 'undercut');
  assert.equal(r.suggested, 1699);
  assert.equal(r.cantBeat, false);
});

test('annonce impossible à placer devant un concurrent au plancher', () => {
  const listing = { id: 5, trackId: '1', price: 900, expiresAt: NOW + 2 * H };
  const detail = { quote: 1000, range: { min: 750, max: 2000 }, listings: [{ id: 6, price: 750, mine: false }], history: [] };
  const r = reviewListing(listing, detail, track(1), NOW);
  assert.equal(r.status, 'undercut');
  assert.equal(r.suggested, 750);
  assert.equal(r.cantBeat, true);
  assert.equal(r.expiringSoon, true);
});

test('annonce trop basse par rapport aux ventes récentes', () => {
  const listing = { id: 5, trackId: '1', price: 800, expiresAt: NOW + 40 * H };
  const detail = { quote: 1000, range: { min: 750, max: 2000 }, listings: [{ id: 5, price: 800, mine: true }, { id: 6, price: 1200, mine: false }], history: sales([1, 1000], [2, 1000], [3, 1000]) };
  const r = reviewListing(listing, detail, track(1), NOW);
  assert.equal(r.status, 'low');
  assert.equal(r.suggested, 1000);
});

test('collection : doublons et cartes « hype »', () => {
  const tracks = [track(1, 'single'), track(2, 'hit'), track(3, 'single'), track(4, 'or')];
  const stats = {
    copies: {
      1: [[500, null]], // unique, valeur 441 = 7,35 × base 60 → hype
      2: [[30, null], [800, null], [1200, null]], // 2 doublons
      3: [[70, null]], // unique, valeur normale
      4: [[12, 'hit']], // unique, montée, valeur normale
    },
    values: { 1: 441, 2: 210, 3: 55, 4: 800 },
  };
  const out = collectionCandidates({ tracks, stats, hypeRatio: 3, minValue: 100 });
  assert.deepEqual(out.map((c) => c.track.id), ['2', '1']);
  assert.equal(out[0].duplicates, 2);
  assert.equal(out[0].sellSerial, 1200); // on vend le plus grand numéro
  assert.equal(out[0].favorite, false);
  assert.equal(out[1].lastCopy, true);
  assert.equal(out[1].reason, 'hype');
  assert.equal(out[1].protectedArtist, false);
});

test('collection : coups de cœur et artistes protégés proposés mais signalés', () => {
  const tracks = [track(2, 'hit'), { ...track(5, 'single'), artistId: '42' }, track(6, 'hit')];
  const stats = {
    copies: {
      2: [[30, null], [800, null], [1200, null]], // le n°1200 en coup de cœur
      5: [[9, null]], // hype, en coup de cœur, artiste protégé
      6: [[40, null], [41, null]], // doublon dont les deux numéros sont en coup de cœur
    },
    values: { 2: 210, 5: 900, 6: 250 },
    lockedSerials: { 2: [1200], 5: [9], 6: [40, 41] },
  };
  const out = collectionCandidates({ tracks, stats, protectedArtists: ['42'], hypeRatio: 3, minValue: 100 });
  const byId = Object.fromEntries(out.map((c) => [c.track.id, c]));
  assert.deepEqual(out.map((c) => c.track.id), ['6', '2', '5']);

  // Doublon : on vend un numéro libre, le coup de cœur reste signalé.
  assert.equal(byId[2].sellSerial, 800);
  assert.equal(byId[2].sellIsFavorite, false);
  assert.equal(byId[2].favorite, true);
  assert.deepEqual(byId[2].favoriteSerials, [1200]);

  // Tous les numéros en coup de cœur : il faudra retirer le cœur.
  assert.equal(byId[6].sellSerial, 41);
  assert.equal(byId[6].sellIsFavorite, true);

  assert.equal(byId[5].sellIsFavorite, true);
  assert.equal(byId[5].protectedArtist, true);
  assert.equal(byId[2].protectedArtist, false);
});

test('vente d’un doublon : recycler si la vente rapporte moins', () => {
  const cand = { track: track(1, 'or'), value: 210, duplicates: 1, lastCopy: false };
  const detail = { quote: 210, range: { min: 200, max: 420 }, listings: [{ id: 1, price: 200, mine: false }], history: sales([2, 205], [5, 200], [9, 210]) };
  const r = evaluateSale(cand, detail, NOW);
  assert.equal(r.fastPrice, 200);
  assert.equal(r.fastNet, 190);
  assert.equal(r.verdict, 'sell'); // 190 > recyclage Or (100)

  // Cas limite (fourchette artificiellement basse) : 5 ♫ de vente → 4 net, sous le recyclage Découverte (5).
  const cheap = evaluateSale(
    { ...cand, track: track(1, 'demo') },
    { quote: 6, range: { min: 5, max: 12 }, listings: [{ id: 1, price: 5, mine: false }], history: sales([1, 6]) },
    NOW,
  );
  assert.equal(cheap.fastNet, 4);
  assert.equal(cheap.verdict, 'recycle');
});

test('vente : cote qui baisse → vendre vite', () => {
  const cand = { track: track(1, 'single'), value: 441, duplicates: 0, lastCopy: true };
  const history = sales([1, 300], [2, 310], [3, 320], [4, 330], [5, 340], [6, 500], [7, 520], [8, 540], [9, 560], [10, 580]);
  const r = evaluateSale(cand, { quote: 441, range: { min: 330, max: 800 }, listings: [{ id: 1, price: 350, mine: false }], history }, NOW);
  assert.equal(r.verdict, 'sell-fast');
  assert.equal(r.fairPrice, 330); // médiane 320 ramenée au plancher
});

test('réglages : bornes et valeurs par défaut', () => {
  const s = normalizeSettings({ delayMs: 50, maxDetails: 500, minRoi: '0.2', budget: '' });
  assert.equal(s.delayMs, 400);
  assert.equal(s.maxDetails, 50);
  assert.equal(s.minRoi, 0.2);
  assert.equal(s.budget, DEFAULT_SETTINGS.budget);
  assert.deepEqual(normalizeSettings(undefined), { ...DEFAULT_SETTINGS });
});
