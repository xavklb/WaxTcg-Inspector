import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAuctions, runBuy, runSell } from '../extension/lib/runs.js';
import { DEFAULT_SETTINGS } from '../extension/lib/constants.js';
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

test('runSell : contrôle mes annonces et propose doublons et cartes hype', async () => {
  const api = fakeApi();
  const res = await runSell(api, DEFAULT_SETTINGS, opts);
  assert.equal(res.openCount, res.listings.length);
  assert.ok(res.listings.some((l) => l.status === 'undercut'));
  assert.ok(res.sales.some((s) => s.duplicates > 0));
  assert.ok(res.sales.some((s) => s.reason === 'hype'));
  assert.ok(!res.sales.some((s) => s.track.id === '7001'), 'coup de cœur jamais proposé');
});
