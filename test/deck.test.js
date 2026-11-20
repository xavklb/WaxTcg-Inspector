import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCards,
  cheatSheet,
  deckPoints,
  deckStrength,
  findBestDeck,
  isValidDeck,
  percentiles,
  strengths,
  themesOf,
} from '../extension/lib/deck.js';
import { runDeck } from '../extension/lib/runs.js';
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
  const pick = (key) => sheet.find((s) => s.criterion === key).picks[0].id;
  assert.equal(pick('plays'), '1');
  assert.equal(pick('underground'), '2');
  assert.equal(pick('long'), '1');
  assert.equal(pick('short'), '2');
  assert.ok(sheet.every((s) => s.picks.length === 5));
});

test('runDeck : propose un deck valide, plus fort que le deck de démo', async () => {
  const calls = [];
  const api = { async get(path) { calls.push(path); return structuredClone(respond(path)); } };
  const res = await runDeck(api, DEFAULT_SETTINGS, { now: () => NOW });
  assert.deepEqual(calls, ['/api/game', '/api/stats', '/api/faceoff']);
  assert.equal(res.current.cards.length, 5);
  assert.equal(res.best.cards.length, 5);
  assert.ok(res.best.valid);
  assert.ok(res.best.points <= 20);
  assert.ok(res.best.strength > res.current.strength);
  assert.equal(res.best.sheet.length, 9);
  assert.equal(res.gemsMax, 360);
});
