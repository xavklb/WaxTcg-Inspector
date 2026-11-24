import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SELL_PRIORITY,
  evaluateSale,
  filterSaleCandidates,
  mergeSaleCandidates,
  preScore,
  rankSales,
  saleChance,
  withoutListed,
} from '../extension/lib/analysis.js';

const H = 3_600_000;
const NOW = 1_795_171_000_000;
const t = (id, rarity = 'or', over = {}) => ({ id: String(id), title: `Titre ${id}`, artist: 'Artiste', artistId: `a${id}`, rarity, ...over });
const sales = (n, price, everyHours = 12) => Array.from({ length: n }, (_, i) => ({ at: NOW - (i + 1) * everyHours * H, price }));
const cand = (over = {}) => ({
  track: t(1),
  value: 1000,
  duplicates: 1,
  lastCopy: false,
  sellSerial: 50,
  sellIsFavorite: false,
  protectedArtist: false,
  wanted: false,
  wishes: 0,
  requests: 0,
  posts: [],
  ...over,
});
const market = (over = {}) => ({ quote: 1000, range: { min: 750, max: 2000 }, listings: [], history: sales(6, 1000), ...over });

test('numéros déjà en vente : retirés de ma collection', () => {
  const stats = { copies: { 1: [[10, null], [20, null], [30, null]], 2: [[5, null]] }, values: { 1: 100 } };
  const out = withoutListed(stats, { 1: [30], 3: [1] });
  assert.deepEqual(out.copies['1'], [[10, null], [20, null]]);
  assert.deepEqual(out.copies['2'], [[5, null]]);
  assert.equal(out.values, stats.values);
  assert.equal(withoutListed(stats, {}), stats);
  assert.deepEqual(stats.copies['1'].length, 3, 'les stats d’origine ne bougent pas');
});

test('une seule liste : doublons et hype enrichis par la demande, plus les cartes demandées', () => {
  const collection = [
    { track: t(1), value: 900, duplicates: 2, lastCopy: false, sellSerial: 80, reason: 'duplicate' },
    { track: t(2, 'single'), value: 500, duplicates: 0, lastCopy: true, sellSerial: 3, reason: 'hype' },
  ];
  const demand = [
    { track: t(1), wishes: 0, requests: 2, posts: [{ who: 'Lina' }, { who: 'Kenzo' }], owned: 3, value: 900, sellSerial: 80 },
    { track: t(3, 'hit'), wishes: 120, requests: 0, posts: [], owned: 1, value: 400, sellSerial: 7, lastCopy: true, upgradedFrom: 'single' },
  ];
  const out = mergeSaleCandidates(collection, demand);
  const byId = Object.fromEntries(out.map((c) => [c.track.id, c]));
  assert.equal(out.length, 3);
  assert.equal(byId[1].reason, 'duplicate');
  assert.equal(byId[1].wanted, true);
  assert.equal(byId[1].requests, 2);
  assert.equal(byId[2].wanted, false);
  assert.equal(byId[3].reason, 'demand');
  assert.equal(byId[3].duplicates, 0);
  assert.equal(byId[3].wishes, 120);
  assert.equal(byId[3].ratio, 2); // 400 / cote de base Hit (200)
  assert.equal(byId[3].upgradedFrom, 'single');
});

test('coups de cœur et artistes protégés : écartés si je le demande, et comptés', () => {
  const list = [
    cand({ track: t(1) }),
    cand({ track: t(2), sellIsFavorite: true }),
    cand({ track: t(3), protectedArtist: true }),
    cand({ track: t(4), sellIsFavorite: true, protectedArtist: true }),
    cand({ track: t(5), favorite: true, sellIsFavorite: false }), // un autre numéro a un cœur : on vend un numéro libre
  ];
  const ids = (r) => r.kept.map((c) => c.track.id);
  assert.deepEqual(ids(filterSaleCandidates(list)), ['1', '2', '3', '4', '5']);
  assert.deepEqual(ids(filterSaleCandidates(list, { sellFavorites: false, sellProtectedArtists: true })), ['1', '3', '5']);
  assert.deepEqual(ids(filterSaleCandidates(list, { sellFavorites: true, sellProtectedArtists: false })), ['1', '2', '5']);
  const none = filterSaleCandidates(list, { sellFavorites: false, sellProtectedArtists: false });
  assert.deepEqual(ids(none), ['1', '5']);
  assert.deepEqual(none.liked, { favorites: 2, protectedArtists: 2 });
});

test('chances de vendre sous 3 jours', () => {
  assert.equal(saleChance({ perDay: 0 }), 0.02);
  assert.ok(Math.abs(saleChance({ perDay: 1 }) - (1 - Math.exp(-3))) < 1e-9);
  assert.ok(saleChance({ perDay: 1, ahead: 2 }) < saleChance({ perDay: 1, ahead: 0 }), 'des annonces moins chères passent avant');
  assert.equal(saleChance({ perDay: 0, wanted: true }), 0.5);
  assert.equal(saleChance({ perDay: 0, wanted: true, noSeller: true }), 0.75);
  assert.equal(saleChance({ perDay: 0, wanted: true, noSeller: true, wishes: 300 }), 0.9);
  assert.equal(saleChance({ perDay: 50 }), 0.99);
});

test('priorité : un doublon qui se vend bien passe avant un dernier exemplaire de même prix', () => {
  const dup = evaluateSale(cand(), market(), NOW);
  const last = evaluateSale(cand({ duplicates: 0, lastCopy: true }), market(), NOW);
  assert.equal(dup.net, last.net);
  assert.equal(dup.gain, dup.net - 100); // au-delà du recyclage d'une Or
  assert.ok(dup.score > last.score);
  assert.ok(Math.abs(last.score - Math.round(last.net * last.chance * SELL_PRIORITY.lastCopy)) <= 1);
});

test('priorité : une carte qui ne se vend pas passe après une carte moins chère qui part vite', () => {
  const stuck = evaluateSale(cand({ value: 2000 }), market({ quote: 2000, range: { min: 1500, max: 4000 }, history: [] }), NOW);
  const quick = evaluateSale(cand({ value: 600 }), market({ quote: 600, range: { min: 450, max: 1200 }, history: sales(14, 600) }), NOW);
  assert.equal(stuck.verdict, 'illiquid');
  assert.ok(quick.score > stuck.score);
  assert.deepEqual(rankSales([stuck, quick]).map((r) => r.value), [600, 2000]);
});

test('priorité : très demandée sans vendeur, au prix maximum, en tête', () => {
  const hot = evaluateSale(cand({ duplicates: 0, lastCopy: true, wanted: true, wishes: 300 }), market({ history: [] }), NOW);
  const plain = evaluateSale(cand(), market({ listings: [{ id: 1, price: 1100, mine: false }] }), NOW);
  assert.equal(hot.verdict, 'no-seller');
  assert.equal(hot.price, 2000);
  assert.equal(hot.chance, 0.9);
  assert.equal(rankSales([plain, hot])[0], hot);
});

test('priorité : à gain égal, un coup de cœur ou un artiste protégé passe après', () => {
  const free = evaluateSale(cand(), market(), NOW);
  const fav = evaluateSale(cand({ sellIsFavorite: true }), market(), NOW);
  const prot = evaluateSale(cand({ protectedArtist: true }), market(), NOW);
  assert.ok(free.score > fav.score);
  assert.equal(fav.score, prot.score);
});

test('priorité : prix en baisse, vendre tout de suite', () => {
  const falling = [...sales(5, 700, 2), ...sales(10, 1000, 30).map((s) => ({ ...s, at: s.at - 20 * H }))];
  const r = evaluateSale(cand(), market({ history: falling }), NOW);
  const flat = evaluateSale(cand(), market({ history: sales(15, 750, 7) }), NOW);
  assert.equal(r.verdict, 'sell-fast');
  assert.equal(r.price, flat.price); // 750 dans les deux cas (plancher)
  assert.ok(r.score > flat.score);
});

test('mieux vaut recycler : toujours en fin de liste', () => {
  const recycle = evaluateSale(
    cand({ track: t(1, 'demo'), value: 6 }),
    market({ quote: 6, range: { min: 5, max: 12 }, listings: [{ id: 1, price: 5, mine: false }], history: sales(3, 6) }),
    NOW,
  );
  const small = evaluateSale(cand({ track: t(2, 'demo'), value: 30 }), market({ quote: 30, range: { min: 22, max: 60 }, history: [] }), NOW);
  assert.equal(recycle.verdict, 'recycle');
  assert.equal(rankSales([recycle, small])[1], recycle);
});

test('mes propres annonces comptent parmi celles qui passent avant', () => {
  const r = evaluateSale(cand(), market({ listings: [{ id: 9, price: 900, mine: true }, { id: 1, price: 1100, mine: false }] }), NOW);
  assert.equal(r.price, 1000); // prix des ventes, sous le moins cher des autres
  assert.equal(r.listedByMe, 1);
  assert.equal(r.ahead, 1);
});

test('premier tri : la valeur nette, la demande et les coups de cœur', () => {
  const big = cand({ value: 2000 });
  const small = cand({ value: 300 });
  const wanted = cand({ value: 300, wanted: true });
  const last = cand({ value: 2000, duplicates: 0, lastCopy: true });
  const fav = cand({ value: 2000, sellIsFavorite: true });
  assert.ok(preScore(big) > preScore(last));
  assert.ok(preScore(big) > preScore(fav));
  assert.ok(preScore(wanted) > preScore(small));
  assert.equal(preScore(cand({ track: t(1, 'demo'), value: 4 })), 0);
});
