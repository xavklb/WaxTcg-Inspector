import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCards,
  cheatSheet,
  deckPoints,
  deckStrength,
  factFor,
  findBestDeck,
  isValidDeck,
  percentiles,
  strengths,
  themesOf,
} from '../extension/lib/deck.js';
import { fetchArtistFans, runDeck } from '../extension/lib/runs.js';
import { DEFAULT_SETTINGS, FACEOFF } from '../extension/lib/constants.js';
import { NOW, respond } from '../dev/fixtures.js';

const T = (id, over = {}) => ({
  id: String(id),
  title: `Titre ${id}`,
  artist: `Artiste ${over.artistId ?? id}`,
  artistId: String(id),
  rarity: 'single',
  rank: 500000,
  year: 2015,
  duration: 200,
  region: 'us',
  style: 'pop',
  ...over,
});

test('thèmes d’une carte', () => {
  assert.deepEqual(themesOf(T(1, { year: 2021, region: 'fr', style: 'rap', title: 'Bandit (feat. Nova)' })), ['recent', 'fr', 'rap', 'feat']);
  assert.deepEqual(themesOf(T(2, { year: 1994, region: 'us', style: 'rock' })), ['vintage', 'abroad', 'rock']);
  assert.deepEqual(themesOf(T(3, { year: 2005, region: 'world', style: 'electro' })), ['y2000', 'abroad', 'electro']);
  assert.deepEqual(themesOf({ id: '4' }), []);
});

test('percentiles avec ex æquo et valeurs absentes', () => {
  assert.deepEqual(percentiles([10, 20, 20, 40]), [0, 50, 50, 100]);
  assert.deepEqual(percentiles([5, NaN, 1]), [100, 50, 0]);
  assert.deepEqual(percentiles([7]), [50]);
});

test('notes estimées : sens de chaque critère', () => {
  const cards = buildCards(
    [
      T(1, { rank: 900000, year: 1980, duration: 400, rarity: 'diamant' }),
      T(2, { rank: 100000, year: 2024, duration: 120, rarity: 'demo' }),
      T(3, { rank: 500000, year: 2005, duration: 200, rarity: 'or' }),
    ],
    { values: { 1: 9000, 2: 20, 3: 700 } },
  );
  const [hit, small, mid] = cards;
  assert.equal(hit.notes.plays, 100);
  assert.equal(small.notes.underground, 100);
  assert.equal(hit.notes.classic, 100);
  assert.equal(small.notes.fresh, 100);
  assert.equal(hit.notes.long, 100);
  assert.equal(small.notes.short, 100);
  assert.equal(hit.notes.rare, 100);
  assert.equal(hit.notes.quote, 100);
  assert.equal(mid.notes.plays, 50);
  assert.equal(hit.points, 8);
  assert.equal(small.points, 1);
  assert.deepEqual(strengths(small).map((s) => s.key), ['underground', 'fresh', 'short']);
});

test('les 9 questions du jeu sont toutes couvertes', () => {
  assert.equal(FACEOFF.criteria.length, 9);
  assert.ok(FACEOFF.criteria.every((c) => c.question && c.question.endsWith('gagne')));
  const [card] = buildCards([T(1)]);
  assert.deepEqual(Object.keys(card.notes), FACEOFF.criteria.map((c) => c.key));
});

test('« L’artiste le plus suivi » : vrais fans quand ils sont connus', () => {
  // L'artiste 1 a le son le plus populaire, mais l'artiste 2 a beaucoup plus de fans.
  const tracks = [T(1, { rank: 900000, artistId: 'a1' }), T(2, { rank: 100000, artistId: 'a2' }), T(3, { rank: 500000, artistId: 'a3' })];
  const approx = buildCards(tracks);
  assert.equal(approx[0].notes.fans, 100);
  assert.equal(approx[0].facts.fans, null);

  const real = buildCards(tracks, { fans: { a1: 5_000, a2: 9_000_000, a3: 300_000 } });
  assert.equal(real[1].notes.fans, 100);
  assert.equal(real[0].notes.fans, 0);
  assert.equal(real[1].facts.fans, 9_000_000);
  assert.deepEqual(factFor(real[1], 'fans'), { kind: 'fans', value: 9_000_000 });
  // Artiste absent de la liste : note neutre.
  const partial = buildCards(tracks, { fans: { a1: 5_000, a2: 9_000_000 } });
  assert.equal(partial[2].notes.fans, 50);
});

test('donnée qui décide de chaque question', () => {
  const [c] = buildCards([T(1, { year: 1994, duration: 205, rarity: 'or' })], { values: { 1: 861 } });
  assert.deepEqual(factFor(c, 'classic'), { kind: 'year', value: 1994 });
  assert.deepEqual(factFor(c, 'short'), { kind: 'duration', value: 205 });
  assert.deepEqual(factFor(c, 'quote'), { kind: 'notes', value: 861 });
  assert.deepEqual(factFor(c, 'rare'), { kind: 'rarity', value: 'or' });
  assert.equal(factFor(c, 'plays'), null);
});

test('bonus de thème moyen ajouté à toutes les notes', () => {
  const [card] = buildCards([T(1, { year: 2021, region: 'fr', style: 'rap' })]);
  const expected = (FACEOFF.themeBonus * 3) / Object.keys(FACEOFF.themes).length;
  assert.equal(card.bonus, expected);
  assert.equal(card.adj[0], 50 + expected);
});

test('force : des spécialistes complémentaires battent des clones', () => {
  const crit = FACEOFF.criteria.length;
  const card = (id, best) => ({ id: String(id), points: 1, track: { artistId: String(id) }, notes: {}, adj: Array.from({ length: crit }, (_, j) => (j === best ? 100 : 0)) });
  const specialists = [0, 1, 2, 3, 4].map((j) => card(j, j));
  const clones = [0, 1, 2, 3, 4].map((k) => card(10 + k, 0));
  // 5 critères tirés parmi 9 : chaque spécialiste a 5/9 de chances que son critère tombe,
  // soit 5 × 5/9 manches gagnées à 100 sur 5 manches. Les clones ne peuvent couvrir qu'une manche.
  assert.ok(Math.abs(deckStrength(specialists) - 500 / 9) < 1e-9);
  assert.ok(Math.abs(deckStrength(clones) - 100 / 9) < 1e-9);
  assert.equal(deckStrength([]), 0);
});

test('règles du deck : 5 cartes, 20 points, 2 par artiste', () => {
  const cards = buildCards([
    T(1, { rarity: 'diamant' }),
    T(2, { rarity: 'diamant' }),
    T(3, { rarity: 'or' }),
    T(4, { rarity: 'demo', artistId: '9' }),
    T(5, { rarity: 'demo', artistId: '9' }),
    T(6, { rarity: 'demo', artistId: '9' }),
    T(7, { rarity: 'single' }),
  ]);
  const by = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.equal(isValidDeck([by[1], by[3], by[4], by[5], by[7]]), true); // 8+4+1+1+2 = 16
  assert.equal(isValidDeck([by[1], by[2], by[3], by[4], by[7]]), false); // 23 points
  assert.equal(isValidDeck([by[4], by[5], by[6], by[3], by[7]]), false); // 3 cartes du même artiste
  assert.equal(isValidDeck([by[1], by[1], by[3], by[4], by[7]]), false); // carte en double
  assert.equal(isValidDeck([by[1], by[3], by[4], by[7]]), false); // 4 cartes
});

test('meilleur deck : valide et au moins aussi fort que le deck actuel', () => {
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rarities = ['demo', 'single', 'hit', 'or', 'platine', 'diamant'];
  const tracks = Array.from({ length: 40 }, (_, i) =>
    T(i + 1, {
      artistId: String(i % 12),
      rarity: rarities[i % rarities.length],
      rank: Math.floor(rnd() * 1e6),
      year: 1970 + Math.floor(rnd() * 56),
      duration: 100 + Math.floor(rnd() * 300),
      region: i % 3 ? 'fr' : 'us',
      style: ['rap', 'pop', 'rock'][i % 3],
    }),
  );
  const values = Object.fromEntries(tracks.map((t, i) => [t.id, 10 + i * 37]));
  const cards = buildCards(tracks, { values });
  const current = cards.filter((c) => c.points <= 2).slice(0, 5);
  assert.ok(isValidDeck(current));

  const best = findBestDeck(cards, { current });
  assert.ok(best);
  assert.ok(isValidDeck(best.cards));
  assert.ok(best.points <= FACEOFF.maxPoints);
  assert.equal(best.points, deckPoints(best.cards));
  assert.ok(best.strength >= deckStrength(current) - 1e-9);
  assert.ok(Math.abs(best.strength - deckStrength(best.cards)) < 1e-9);
});

test('meilleur deck : impossible sans assez de cartes', () => {
  assert.equal(findBestDeck(buildCards([T(1), T(2), T(3)])), null);
});

test('antisèche : la meilleure carte du deck pour chaque critère', () => {
  const cards = buildCards([
    T(1, { rank: 900000, duration: 400 }),
    T(2, { rank: 100000, duration: 120 }),
    T(3, { rank: 500000, duration: 250 }),
    T(4, { rank: 300000, duration: 300 }),
    T(5, { rank: 700000, duration: 180 }),
  ]);
  const sheet = cheatSheet(cards);
  assert.equal(sheet.length, FACEOFF.criteria.length);
  assert.equal(sheet.find((s) => s.criterion === 'long').question, 'Le son le plus long gagne');
  assert.deepEqual(sheet.find((s) => s.criterion === 'long').picks[0].fact, { kind: 'duration', value: 400 });
  const pick = (key) => sheet.find((s) => s.criterion === key).picks[0].id;
  assert.equal(pick('plays'), '1');
  assert.equal(pick('underground'), '2');
  assert.equal(pick('long'), '1');
  assert.equal(pick('short'), '2');
  assert.ok(sheet.every((s) => s.picks.length === 5));
});

function demoApi({ failArtists = false } = {}) {
  const calls = [];
  return {
    calls,
    async get(path) {
      calls.push(path);
      if (failArtists && path.startsWith('/api/artists')) throw new Error('HTTP 500');
      return structuredClone(respond(path));
    },
  };
}

test('fans des artistes : pages de 60, comme le site', async () => {
  const pages = [
    { items: Array.from({ length: 60 }, (_, i) => ({ artist: { id: `a${i}`, fans: i * 10 } })), total: 75 },
    { items: Array.from({ length: 15 }, (_, i) => ({ artist: { id: `b${i}`, fans: 7 } })), total: 75 },
  ];
  const calls = [];
  const api = { async get(path) { calls.push(path); return pages[calls.length - 1]; } };
  const fans = await fetchArtistFans(api);
  assert.deepEqual(calls, ['/api/artists?started=1&offset=0&limit=60', '/api/artists?started=1&offset=60&limit=60']);
  assert.equal(Object.keys(fans).length, 75);
  assert.equal(fans.a3, 30);
});

test('runDeck : propose un deck valide, plus fort que le deck de démo', async () => {
  const api = demoApi();
  const saved = [];
  const res = await runDeck(api, DEFAULT_SETTINGS, { now: () => NOW, fansCache: { get: async () => null, set: async (e) => saved.push(e) } });
  assert.deepEqual(api.calls, ['/api/game', '/api/stats', '/api/faceoff', '/api/artists?started=1&offset=0&limit=60']);
  assert.equal(res.fansSource, 'api');
  assert.equal(saved.length, 1);
  assert.ok(Object.keys(saved[0].fans).length > 0);
  assert.equal(res.current.cards.length, 5);
  assert.equal(res.best.cards.length, 5);
  assert.ok(res.best.valid);
  assert.ok(res.best.points <= 20);
  assert.ok(res.best.strength > res.current.strength);
  assert.equal(res.best.sheet.length, 9);
  assert.ok(res.best.cards.every((c) => Number.isFinite(c.facts.fans)));
  assert.equal(res.gemsMax, 360);
});

test('runDeck : réutilise les fans gardés moins de 24 h', async () => {
  const api = demoApi();
  const cache = { at: NOW - 3_600_000, fans: { 101: 2_400_000 } };
  const res = await runDeck(api, DEFAULT_SETTINGS, { now: () => NOW, fansCache: { get: async () => cache, set: async () => {} } });
  assert.ok(!api.calls.some((p) => p.startsWith('/api/artists')));
  assert.equal(res.fansSource, 'cache');
});

test('runDeck : sans liste d’artistes, retombe sur l’approximation', async () => {
  const res = await runDeck(demoApi({ failArtists: true }), DEFAULT_SETTINGS, { now: () => NOW });
  assert.equal(res.fansSource, 'approx');
  assert.ok(res.best.valid);
});
