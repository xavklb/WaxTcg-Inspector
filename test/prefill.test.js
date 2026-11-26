import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefillBlocker, prefillNote, prefillPlan } from '../extension/lib/prefill.js';

const sale = (id, o = {}) => ({
  track: { id, title: `Titre ${id}`, artist: 'Artiste', rarity: 'hit' },
  price: 500,
  net: 475,
  gain: 445,
  chance: 0.6,
  duplicates: 1,
  verdict: 'sell',
  cheapestOther: 501,
  listedByMe: 0,
  ...o,
});

test('préremplissage : seuls les doublons vendables sans coup de cœur', () => {
  assert.equal(prefillBlocker(sale(1)), null);
  assert.match(prefillBlocker(sale(2, { duplicates: 0 })), /dernier exemplaire/);
  assert.match(prefillBlocker(sale(3, { sellIsFavorite: true })), /coup de cœur/);
  assert.match(prefillBlocker(sale(4, { listedByMe: 1 })), /déjà en vente/);
  assert.match(prefillBlocker(sale(5, { verdict: 'recycle' })), /recycler/);
  assert.match(prefillBlocker(sale(6, { price: 0 })), /prix/);
});

test('préremplissage : garde l’ordre du classement et les places libres', () => {
  const list = [sale(1), sale(2, { duplicates: 0 }), sale(3), sale(4), sale(5)];
  const plan = prefillPlan(list, 3);
  assert.deepEqual(plan.map((p) => p.id), ['1', '3', '4']);
  assert.deepEqual(Object.keys(plan[0]).sort(), ['artist', 'id', 'note', 'price', 'rarityLabel', 'title']);
  assert.equal(plan[0].rarityLabel, 'Hit');
  assert.deepEqual(prefillPlan(list, 0), []);
});

test('préremplissage : la note explique le prix', () => {
  assert.match(prefillNote(sale(1)), /1 ♫ sous le moins cher \(501 ♫\)/);
  assert.match(prefillNote(sale(1, { cheapestOther: 700 })), /prix des dernières ventes/);
  assert.match(prefillNote(sale(1, { cheapestOther: null })), /personne d’autre ne la vend/);
  assert.match(prefillNote(sale(1, { cheapestOther: null, premium: 1.5 })), /cote ×1,5/);
  assert.match(prefillNote(sale(1)), /\+445 vs recyclage.*60 % de chances/);
});
