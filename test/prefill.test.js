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

test('préremplissage : tout ce qui rapporte plus que le recyclage, sauf les numéros en coup de cœur', () => {
  assert.equal(prefillBlocker(sale(1)), null);
  assert.equal(prefillBlocker(sale(2, { duplicates: 0 })), null, 'dernier exemplaire : le site demande confirmation');
  assert.equal(prefillBlocker(sale(4, { listedByMe: 1 })), null, 'un exemplaire de plus d’un titre déjà en vente');
  assert.match(prefillBlocker(sale(3, { sellIsFavorite: true })), /coup de cœur/);
  assert.match(prefillBlocker(sale(4, { listedByMe: 1, duplicates: 0 })), /déjà en vente/);
  assert.match(prefillBlocker(sale(5, { verdict: 'recycle' })), /recycler/);
  assert.match(prefillBlocker(sale(6, { price: 0 })), /prix/);
});

test('préremplissage : remplit les places libres, titres déjà en vente en dernier', () => {
  const list = [sale(1), sale(2, { listedByMe: 1 }), sale(3, { duplicates: 0 }), sale(4, { sellIsFavorite: true }), sale(5)];
  assert.deepEqual(prefillPlan(list, 3).map((p) => p.id), ['1', '3', '5']);
  assert.deepEqual(prefillPlan(list, 20).map((p) => p.id), ['1', '3', '5', '2']);
  assert.deepEqual(prefillPlan(list, 20).map((p) => p.last), [false, true, false, false]);
  assert.deepEqual(Object.keys(prefillPlan(list, 1)[0]).sort(), ['artist', 'id', 'last', 'note', 'price', 'rarityLabel', 'title']);
  assert.equal(prefillPlan(list, 1)[0].rarityLabel, 'Hit');
  assert.deepEqual(prefillPlan(list, 0), []);
  const many = Array.from({ length: 30 }, (_, i) => sale(100 + i));
  assert.equal(prefillPlan(many, 25).length, 20, '20 annonces au plus');
});

test('préremplissage : la note explique le prix', () => {
  assert.match(prefillNote(sale(1)), /1 ♫ sous le moins cher \(501 ♫\)/);
  assert.match(prefillNote(sale(1, { cheapestOther: 700 })), /prix des dernières ventes/);
  assert.match(prefillNote(sale(1, { cheapestOther: null })), /personne d’autre ne la vend/);
  assert.match(prefillNote(sale(1, { cheapestOther: null, premium: 1.5 })), /cote ×1,5/);
  assert.match(prefillNote(sale(1)), /\+445 vs recyclage.*60 % de chances/);
});
