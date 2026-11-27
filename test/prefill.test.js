import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrefill, frontPrice, prefillBlocker, prefillNote, prefillPlan } from '../extension/lib/prefill.js';

const sale = (id, o = {}) => ({
  track: { id, title: `Titre ${id}`, artist: 'Artiste', rarity: 'hit' },
  quote: 500,
  range: { min: 375, max: 1000 },
  price: 480,
  duplicates: 1,
  verdict: 'sell',
  cheapestOther: 600,
  listedByMe: 0,
  ...o,
});
const detail = (listings, o = {}) => ({ quote: 500, range: { min: 375, max: 1000 }, listings, ...o });

test('prix : 1 ♫ sous l’annonce la moins chère, même au-dessus du prix conseillé', () => {
  const fp = frontPrice(sale(1));
  assert.equal(fp.price, 599);
  assert.equal(fp.front, true);
  assert.equal(fp.net, 599 - 30);
  assert.equal(fp.gain, 569 - 30, 'gain par rapport au recyclage d’un Hit (30 ♫)');
});

test('prix : relu sur la fiche fraîche, sans compter mes annonces', () => {
  const fp = frontPrice(sale(1), detail([{ price: 450, mine: true }, { price: 700 }, { price: 520 }]));
  assert.equal(fp.cheapest, 520);
  assert.equal(fp.price, 519);
});

test('prix : jamais sous le minimum autorisé, et signalé', () => {
  const fp = frontPrice(sale(1), detail([{ price: 300 }]));
  assert.equal(fp.price, 375);
  assert.equal(fp.front, false);
  assert.match(prefillNote(sale(1), fp), /prix minimum/);
});

test('prix : personne d’autre ne la vend → prix conseillé', () => {
  const fp = frontPrice(sale(1, { price: 650 }), detail([{ price: 400, mine: true }]));
  assert.equal(fp.cheapest, null);
  assert.equal(fp.price, 650);
  assert.match(prefillNote(sale(1), fp), /personne d’autre ne la vend/);
});

test('préremplissage : tout ce qui rapporte plus que le recyclage, sauf les numéros en coup de cœur', () => {
  assert.equal(prefillBlocker(sale(1)), null);
  assert.equal(prefillBlocker(sale(2, { duplicates: 0 })), null, 'dernier exemplaire : le site demande confirmation');
  assert.equal(prefillBlocker(sale(3, { listedByMe: 1 })), null, 'un exemplaire de plus d’un titre déjà en vente');
  assert.equal(prefillBlocker(sale(4, { verdict: 'recycle' })), null, 'rentable une fois au prix du moins cher − 1');
  assert.match(prefillBlocker(sale(5, { sellIsFavorite: true })), /coup de cœur/);
  assert.match(prefillBlocker(sale(6, { listedByMe: 1, duplicates: 0 })), /déjà en vente/);
  const cheap = sale(7, { track: { id: 7, rarity: 'demo' }, range: { min: 1, max: 60 }, cheapestOther: 6 });
  assert.match(prefillBlocker(cheap), /recyclage/);
  assert.match(prefillBlocker(sale(8, { price: 0 })), /prix/);
});

test('préremplissage : remplit les places libres, titres déjà en vente en dernier', () => {
  const list = [sale(1), sale(2, { listedByMe: 1 }), sale(3, { duplicates: 0 }), sale(4, { sellIsFavorite: true }), sale(5)];
  assert.deepEqual(prefillPlan(list, 3).map((p) => p.id), ['1', '3', '5']);
  assert.deepEqual(prefillPlan(list, 20).map((p) => p.id), ['1', '3', '5', '2']);
  assert.deepEqual(prefillPlan(list, 20).map((p) => p.last), [false, true, false, false]);
  assert.deepEqual(prefillPlan(list, 1)[0].price, 599);
  assert.deepEqual(Object.keys(prefillPlan(list, 1)[0]).sort(), ['artist', 'id', 'last', 'note', 'price', 'rarityLabel', 'title']);
  assert.deepEqual(prefillPlan(list, 0), []);
  const many = Array.from({ length: 30 }, (_, i) => sale(100 + i));
  assert.equal(prefillPlan(many, 25).length, 20, '20 annonces au plus');
});

test('préremplissage : prix du moment, cartes devenues non rentables remplacées', async () => {
  const fresh = {
    1: detail([{ price: 560 }]), // un vendeur moins cher est arrivé depuis l'analyse
    2: detail([{ price: 20 }], { range: { min: 10, max: 1000 } }), // bradée : moins que le recyclage
    3: detail([]),
    4: detail([{ price: 900 }]),
  };
  const calls = [];
  const api = {
    async get(path, opts) {
      calls.push([path, opts.ttlMs]);
      return fresh[path.split('/').pop()];
    },
  };
  const list = [sale(1), sale(2, { track: { id: 2, title: 'Titre 2', rarity: 'or' } }), sale(3, { price: 640 }), sale(4)];
  const { items, skipped } = await buildPrefill(api, list, 3);
  assert.deepEqual(items.map((i) => [i.id, i.price]), [['1', 559], ['3', 640], ['4', 899]]);
  assert.deepEqual(skipped.map((s) => s.id), ['2']);
  assert.ok(calls.every(([, ttl]) => ttl === 30_000), 'fiches de moins de 30 s');
});
