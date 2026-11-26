import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAuctions, runBuy, runSell } from '../extension/lib/runs.js';
import { DEFAULT_SETTINGS } from '../extension/lib/constants.js';
import { prefillPlan } from '../extension/lib/prefill.js';
import { respond, NOW } from '../dev/fixtures.js';

// Fausse API : sert les données de démonstration et note chaque requête.
function fakeApi() {
  const calls = [];
  return {
    calls,
    async get(path) {
      calls.push(path);
      const data = respond(path);
      if (data == null) throw new Error(`route inattendue : ${path}`);
      return structuredClone(data);
    },
  };
}

const opts = { now: () => NOW };

test('runBuy : lit seulement les raretés abordables puis vérifie les meilleures pistes', async () => {
  const api = fakeApi();
  const res = await runBuy(api, { ...DEFAULT_SETTINGS, maxDetails: 5 }, opts);
  assert.equal(res.budget, 430);
  const lists = api.calls.filter((p) => p.startsWith('/api/market?'));
  assert.ok(lists.every((p) => /max=430/.test(p)));
  assert.ok(!lists.some((p) => /rarity=(platine|diamant|worldwide)/.test(p)), 'Platine et plus coûtent plus que le budget');
  assert.ok(res.checked <= 5);
  assert.ok(res.results.length > 0);
  const firstBad = res.results.findIndex((r) => !r.ok);
  assert.ok(firstBad === -1 || res.results.slice(firstBad).every((r) => !r.ok), 'les bonnes affaires d’abord');
});

test('runBuy : le budget des réglages remplace le solde', async () => {
  const api = fakeApi();
  const res = await runBuy(api, { ...DEFAULT_SETTINGS, budget: 50000, maxDetails: 3 }, opts);
  assert.equal(res.budget, 50000);
  assert.ok(api.calls.some((p) => /rarity=diamant/.test(p)));
});

test('runAuctions : écarte les enchères hors fenêtre et propose une mise max', async () => {
  const api = fakeApi();
  const res = await runAuctions(api, { ...DEFAULT_SETTINGS, budget: 10000 }, opts);
  assert.ok(res.open >= res.screened);
  for (const r of res.results) {
    assert.ok(r.endsInMs > 0 && r.endsInMs <= 120 * 60_000);
    assert.ok(Number.isFinite(r.maxBid));
  }
});

test('runSell : contrôle mes annonces et propose doublons, cartes hype et cartes demandées', async () => {
  const api = fakeApi();
  const res = await runSell(api, DEFAULT_SETTINGS, opts);
  assert.equal(res.openCount, res.listings.length);
  assert.ok(res.listings.some((l) => l.status === 'undercut'));
  assert.ok(res.toSell.some((s) => s.duplicates > 0));
  assert.ok(res.toSell.some((s) => s.reason === 'hype'));
  assert.ok(res.toSell.some((s) => s.reason === 'demand'));
  assert.ok(res.checked <= DEFAULT_SETTINGS.maxDetails);
});

test('runSell : les ventes les plus intéressantes d’abord', async () => {
  const res = await runSell(fakeApi(), DEFAULT_SETTINGS, opts);
  const scores = res.toSell.filter((s) => s.verdict !== 'recycle').map((s) => s.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  const [top] = res.toSell;
  assert.equal(top.track.id, '7030'); // 537 souhaits, personne n'en vend
  assert.equal(top.verdict, 'no-seller');
  assert.equal(top.price, top.range.max);
  assert.equal(res.toSell.at(-1).track.id, '7004', 'Découverte qui ne se vend pas : en dernier');
});

test('runSell : cartes demandées que je possède', async () => {
  const api = fakeApi();
  const res = await runSell(api, DEFAULT_SETTINGS, opts);
  assert.ok(api.calls.includes('/api/wall'));
  const byId = Object.fromEntries(res.toSell.map((s) => [s.track.id, s]));
  assert.equal(byId['7030'].wishes, 537);
  const wanted = byId['7003'];
  assert.equal(wanted.wanted, true);
  assert.equal(wanted.requests, 2);
  assert.equal(wanted.duplicates, 2);
  assert.equal(wanted.sellSerial, 2210); // le n°900 est en coup de cœur
  assert.equal(wanted.price, wanted.cheapestOther - 1);
  assert.equal(byId['7012'].reason, 'demand');
  assert.deepEqual(res.demandOthers.map((o) => o.track.id), ['1060', '1061']);
  assert.equal(res.wantPosts, 4);
});

test('runSell : un numéro déjà en vente n’est pas proposé une seconde fois', async () => {
  const res = await runSell(fakeApi(), DEFAULT_SETTINGS, opts);
  const gravite = res.toSell.find((s) => s.track.id === '7000');
  assert.equal(gravite.duplicates, 1); // 3 exemplaires, dont le n°1530 déjà en vente
  assert.equal(gravite.sellSerial, 812);
  assert.equal(gravite.listedByMe, 1);
});

test('runSell : signale coups de cœur et artistes protégés', async () => {
  const res = await runSell(fakeApi(), DEFAULT_SETTINGS, opts);
  const byId = Object.fromEntries(res.toSell.map((s) => [s.track.id, s]));
  assert.equal(byId['7001']?.sellIsFavorite, true, 'coup de cœur proposé mais signalé');
  assert.equal(byId['7003']?.sellIsFavorite, false, 'doublon : on vend un numéro libre');
  assert.deepEqual(byId['7003']?.favoriteSerials, [900]);
  assert.equal(byId['7000']?.protectedArtist, true, 'artiste protégé signalé');
  assert.equal(byId['7002']?.protectedArtist, false);
  assert.deepEqual(res.liked, { favorites: 1, protectedArtists: 1 });
  assert.deepEqual(res.options, { sellFavorites: true, sellProtectedArtists: true });
});

test('runSell : coups de cœur et artistes protégés écartés si je le choisis', async () => {
  const api = fakeApi();
  const res = await runSell(api, { ...DEFAULT_SETTINGS, sellFavorites: false, sellProtectedArtists: false }, opts);
  const ids = res.toSell.map((s) => s.track.id);
  assert.ok(!ids.includes('7001'), 'coup de cœur écarté');
  assert.ok(!ids.includes('7000'), 'artiste protégé écarté');
  assert.ok(ids.includes('7003'), 'un doublon sans cœur du même titre reste proposé');
  assert.ok(!api.calls.includes('/api/market/7001'), 'aucune requête pour une carte écartée');
  assert.deepEqual(res.liked, { favorites: 1, protectedArtists: 1 });
  assert.deepEqual(res.options, { sellFavorites: false, sellProtectedArtists: false });
});

test('runSell : lit d’autres fiches pour remplir les places d’annonce libres', async () => {
  const full = await runSell(fakeApi(), DEFAULT_SETTINGS, opts);
  const api = fakeApi();
  const res = await runSell(api, { ...DEFAULT_SETTINGS, maxDetails: 2 }, opts);
  const free = res.maxOpen - res.openCount;
  const plan = (r) => prefillPlan(r.toSell, free).map((p) => p.id).sort();
  assert.ok(res.checked > 2, 'plus de fiches que maxDetails');
  assert.deepEqual(plan(res), plan(full), 'autant de ventes à préremplir qu’avec toutes les fiches');
});

test('runSell : s’arrête de lire des fiches quand les places libres sont remplies', async () => {
  // 18 annonces ouvertes sur 20 : il ne reste que 2 places.
  const base = fakeApi();
  const api = {
    calls: base.calls,
    async get(path) {
      const data = await base.get(path);
      if (path.startsWith('/api/market?')) {
        const open = data.mine.listings.filter((l) => l.status === 'open');
        for (let i = 0; open.length + i < 18; i += 1) data.mine.listings.push({ ...open[0], id: `pad-${i}` });
      }
      return data;
    },
  };
  const full = await runSell(fakeApi(), DEFAULT_SETTINGS, opts);
  const res = await runSell(api, { ...DEFAULT_SETTINGS, maxDetails: 1 }, opts);
  assert.equal(res.openCount, 18);
  assert.equal(prefillPlan(res.toSell, 2).length, 2);
  assert.ok(res.checked < full.checked, 'pas de fiche lue en trop');
});
