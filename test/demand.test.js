import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demandCandidates, evaluateDemandSale } from '../extension/lib/analysis.js';

const NOW = 1_795_171_000_000;
const t = (id, over = {}) => ({ id: String(id), title: `Titre ${id}`, artist: 'Artiste', artistId: `a${id}`, rarity: 'or', ...over });

test('cartes demandées : souhaits du Marché + annonces « Cherche », hors les miennes', () => {
  const tracks = [t(1), t(2), t(3, { artistId: 'p' })];
  const stats = {
    copies: { 1: [[10, null]], 2: [[5, null], [80, null]], 3: [[7, null]] },
    values: { 1: 900, 2: 800, 3: 700 },
    lockedSerials: { 2: [80], 3: [7] },
  };
  const wanted = [
    { track: t(1), wishes: 300, best: null },
    { track: t(9), wishes: 150, best: 4000 }, // je ne l'ai pas
  ];
  const wallPosts = [
    { kind: 'want', track: t(2), who: 'Lina', note: 'svp', at: 200 },
    { kind: 'want', track: t(2), who: 'Kenzo', note: '', at: 300 },
    { kind: 'want', track: t(3), who: 'Max', at: 100 },
    { kind: 'want', track: t(1), who: 'Moi', at: 400, mine: true }, // mon annonce
    { kind: 'give', track: t(1), who: 'Wen', at: 500 }, // une offre, pas une demande
    { kind: 'want', track: t(8), who: 'Axel', at: 50 }, // je ne l'ai pas
  ];
  const { mine, others } = demandCandidates({ wanted, wallPosts, tracks, stats, protectedArtists: ['p'] });

  assert.deepEqual(mine.map((c) => c.track.id), ['1', '2', '3']);
  const [c1, c2, c3] = mine;
  assert.equal(c1.wishes, 300);
  assert.equal(c1.requests, 0);
  assert.equal(c1.lastCopy, true);
  assert.equal(c2.requests, 2);
  assert.equal(c2.posts[0].who, 'Kenzo'); // la plus récente d'abord
  assert.equal(c2.sellSerial, 5); // le n°80 est en coup de cœur
  assert.equal(c2.favorite, true);
  assert.deepEqual(c2.favoriteSerials, [80]);
  assert.equal(c2.sellIsFavorite, false);
  assert.equal(c3.sellIsFavorite, true);
  assert.equal(c3.protectedArtist, true);
  assert.deepEqual(others.map((o) => o.track.id), ['9']);
});

test('carte demandée sans vendeur : prime selon la demande', () => {
  const detail = { quote: 1000, range: { min: 750, max: 2000 }, listings: [], history: [] };
  const base = { track: t(1), value: 1000, requests: 0 };
  const hot = evaluateDemandSale({ ...base, wishes: 300 }, detail, NOW);
  assert.equal(hot.verdict, 'no-seller');
  assert.equal(hot.premium, 2);
  assert.equal(hot.price, 2000); // maximum autorisé
  assert.equal(hot.net, 1900);
  assert.equal(evaluateDemandSale({ ...base, wishes: 0, requests: 2 }, detail, NOW).price, 1500);
  assert.equal(evaluateDemandSale({ ...base, wishes: 20, requests: 0 }, detail, NOW).price, 1500);
  assert.equal(evaluateDemandSale({ ...base, wishes: 0, requests: 1 }, detail, NOW).price, 1250);
});

test('carte demandée déjà en vente : juste sous le moins cher des autres', () => {
  const detail = {
    quote: 1000,
    range: { min: 750, max: 2000 },
    listings: [{ id: 1, price: 1400, mine: false }, { id: 2, price: 900, mine: true }],
    history: [],
  };
  const r = evaluateDemandSale({ track: t(1), value: 1000, wishes: 50, requests: 1 }, detail, NOW);
  assert.equal(r.verdict, 'compete');
  assert.equal(r.price, 1399);
  assert.equal(r.competitors, 1);
  assert.equal(r.premium, null);
});

test('carte demandée : jamais sous le prix plancher autorisé', () => {
  const detail = { quote: 1000, range: { min: 750, max: 2000 }, listings: [{ id: 1, price: 750, mine: false }], history: [] };
  assert.equal(evaluateDemandSale({ track: t(1), value: 1000, wishes: 0, requests: 1 }, detail, NOW).price, 750);
});
