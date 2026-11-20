import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  artistNames,
  decodeEntities,
  estimateUpgradedQuote,
  evaluateUpgrade,
  matchTrack,
  normalizeTitle,
  parseSnepHtml,
  searchQuery,
  snepSinglesUrl,
  targetRarity,
} from '../extension/lib/snep.js';
import { runSnep } from '../extension/lib/runs.js';
import { DEFAULT_SETTINGS } from '../extension/lib/constants.js';
import { NOW, SNEP_HTML, respond, snepRespond } from '../dev/fixtures.js';

test('lecture de la page des certifications du SNEP', () => {
  const certs = parseSnepHtml(SNEP_HTML);
  assert.equal(certs.length, 7);
  assert.deepEqual(certs[0], {
    category: 'Singles',
    title: 'DERNIER ÉTÉ',
    artist: 'SAPHIR',
    level: 'Or',
    released: '2025-01-01',
    certifiedOn: '2026-11-13',
  });
  assert.equal(certs[4].title, 'L’INCONNU'); // entité HTML décodée
  assert.equal(certs[5].category, 'Albums');
  assert.equal(certs[6].certifiedOn, '2026-11-06');
  assert.deepEqual(parseSnepHtml('<html>rien</html>'), []);
});

test('adresses des pages de singles', () => {
  assert.equal(snepSinglesUrl(1), 'https://snepmusique.com/les-certifications/?categorie=Singles');
  assert.equal(snepSinglesUrl(2), 'https://snepmusique.com/les-certifications/page/2?categorie=Singles');
});

test('niveau SNEP → rareté WAX', () => {
  assert.equal(targetRarity('Or'), 'or');
  assert.equal(targetRarity('Double Or'), 'or');
  assert.equal(targetRarity('Double Platine'), 'platine');
  assert.equal(targetRarity('Triple Diamant'), 'diamant');
  assert.equal(targetRarity(''), null);
  assert.equal(decodeEntities('J&rsquo;ai &amp; toi &#8211; x'), 'J’ai & toi – x');
});

test('noms : titres sans feat ni version, artistes multiples', () => {
  assert.equal(normalizeTitle('Mélo Décalé (feat. X)'), 'melo decale');
  assert.equal(normalizeTitle('Song - Remastered 2011'), 'song');
  assert.equal(normalizeTitle('L’amour'), 'lamour');
  assert.deepEqual(artistNames('TIAKOLA, SDM & LIIM’S'), ['tiakola', 'sdm', 'liims']);
  assert.deepEqual(artistNames('ORELSAN FEAT. GIMS'), ['orelsan', 'gims']);
  assert.equal(searchQuery({ title: 'SONG (REMIX)' }), 'SONG');
});

test('retrouver la bonne carte WAX', () => {
  const tracks = [
    { id: '1', title: 'No Life', artist: 'Ninho', rarity: 'diamant', rank: 900000 },
    { id: '2', title: 'No Life', artist: 'Orelsan', rarity: 'single', rank: 500000 },
    { id: '3', title: 'Plaisir nocif', artist: 'Tiakola', rarity: 'platine', rank: 880000 },
    { id: '4', title: 'Les mots bleus', artist: 'Christophe', rarity: 'or', rank: 600000 },
    { id: '5', title: 'Christophe', artist: 'Orelsan', rarity: 'platine', rank: 700000 },
  ];
  assert.equal(matchTrack({ title: 'NO LIFE', artist: 'NINHO' }, tracks).id, '1');
  assert.equal(matchTrack({ title: 'PLAISIR NOCIF', artist: 'TIAKOLA, SDM & LIIM’S' }, tracks).id, '3');
  assert.equal(matchTrack({ title: 'CHRISTOPHE', artist: 'ORELSAN FEAT. GIMS' }, tracks).id, '5');
  assert.equal(matchTrack({ title: 'INCONNU', artist: 'PERSONNE' }, tracks), null);
});

test('cote estimée après la montée (prudente)', () => {
  // Or : 700 × (0,7 + 0,6 × 0,85) × (0,75 + 0,5 × 0,986) ≈ 1 053
  assert.equal(estimateUpgradedQuote({ rank: 850_000 }, 'or', 9_048_978), 1053);
  assert.equal(estimateUpgradedQuote({ rank: 850_000 }, 'or'), 847); // sans fans connus
  assert.equal(estimateUpgradedQuote({ rank: 0 }, 'diamant', 100), Math.round(9000 * 0.7 * 0.75));
  assert.equal(estimateUpgradedQuote({ rank: 1 }, 'inconnue', 1), null);
});

test('opportunité : prix d’achat, valeur après la montée, budget', () => {
  const cert = { title: 'DERNIER ÉTÉ', artist: 'SAPHIR', level: 'Or', certifiedOn: '2026-11-13' };
  const track = { id: '1', title: 'Dernier été', artist: 'Saphir', rarity: 'hit', rank: 850_000 };
  const card = {
    track,
    artist: { fans: 9_048_978 },
    market: { quote: 260, cheapest: 240, listings: 2, sales: [{ at: NOW - 3_600_000, price: 255 }, { at: NOW - 10 * 86_400_000, price: 250 }] },
  };
  const r = evaluateUpgrade(cert, track, card, { budget: 430, now: NOW });
  assert.equal(r.from, 'hit');
  assert.equal(r.to, 'or');
  assert.equal(r.expected, 1053);
  assert.equal(r.net, 1000);
  assert.equal(r.profit, 760);
  assert.ok(Math.abs(r.multiple - 1053 / 240) < 1e-9);
  assert.equal(r.affordable, true);
  assert.equal(r.sales7d, 1);
  assert.equal(evaluateUpgrade(cert, track, card, { budget: 100, now: NOW }).affordable, false);
  const none = evaluateUpgrade(cert, track, { ...card, market: { quote: 260, cheapest: null } }, { now: NOW });
  assert.equal(none.buy, null);
  assert.equal(none.profit, null);
});

test('runSnep : dernier lot, cartes pas encore montées d’abord', async () => {
  const calls = [];
  const fetched = [];
  const api = { async get(path) { calls.push(path); return structuredClone(respond(path)); } };
  const fetchText = async (url) => { fetched.push(url); return snepRespond(url); };
  const res = await runSnep(api, DEFAULT_SETTINGS, { now: () => NOW, fetchText });

  assert.equal(res.latestCertifiedOn, '2026-11-13');
  assert.equal(res.publishedAt, Date.parse('2026-11-16T13:45:54Z'));
  assert.equal(res.batchSize, 5); // ni l'album, ni le lot du 06/11
  // 5 titres du dernier lot (ni l'album, ni le lot du 06/11), + 1 recherche par artiste pour l'introuvable.
  assert.equal(calls.filter((p) => p.startsWith('/api/search')).length, 6);
  assert.deepEqual(res.pending.map((p) => p.track.id), ['7200', '7002', '7201']);
  assert.equal(res.pending[0].profit, 760);
  assert.equal(res.pending[2].affordable, false);
  assert.deepEqual(res.already.map((a) => a.track.id), ['7003']);
  assert.deepEqual(res.unmatched.map((c) => c.title), ['L’INCONNU']);
  assert.ok(fetched.every((u) => u.startsWith('https://snepmusique.com/')));
});

test('runSnep : seconde recherche par l’artiste quand le titre est trop courant', async () => {
  const html = `<div class="certification"><div class="categorie">Singles</div><div class="titre">CHRISTOPHE</div><div class="artiste">ORELSAN FEAT. GIMS</div><div class="certif icon-diamant">Diamant</div><div class="date"><span>Date de constat</span>13/11/2026</div></div>`;
  const tracks = {
    CHRISTOPHE: [{ id: '10', title: 'Les mots bleus', artist: 'Christophe', rarity: 'or', rank: 600000 }],
    orelsan: [{ id: '11', title: 'Christophe (feat. GIMS)', artist: 'Orelsan', rarity: 'platine', rank: 900000 }],
  };
  const calls = [];
  const api = {
    async get(path) {
      calls.push(path);
      if (path === '/api/game') return { state: { notes: 5000 }, serverNow: NOW };
      if (path.startsWith('/api/search?q=')) return { tracks: tracks[decodeURIComponent(path.split('=')[1])] ?? [] };
      if (path === '/api/cards/11') return { track: tracks.orelsan[0], artist: { fans: 5_000_000 }, market: { quote: 4000, cheapest: 3800, listings: 4, sales: [] } };
      throw new Error(path);
    },
  };
  const fetchText = async (url) => (url.includes('wp-json') ? '[]' : url.endsWith('?categorie=Singles') ? html : '');
  const res = await runSnep(api, DEFAULT_SETTINGS, { now: () => NOW, fetchText });
  assert.deepEqual(calls.filter((p) => p.startsWith('/api/search')), ['/api/search?q=CHRISTOPHE', '/api/search?q=orelsan']);
  assert.deepEqual(res.pending.map((p) => p.track.id), ['11']);
  assert.equal(res.pending[0].to, 'diamant');
  assert.equal(res.unmatched.length, 0);
});

test('runSnep : refuse de tourner sans lecteur du site du SNEP', async () => {
  await assert.rejects(() => runSnep({ get: async () => ({}) }, DEFAULT_SETTINGS, {}), /SNEP/);
});
