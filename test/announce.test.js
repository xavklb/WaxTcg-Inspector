import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_MAX_LENGTH,
  DEFAULT_ANNOUNCE,
  fillTemplate,
  formatAnnouncement,
  normalizeAnnounce,
} from '../extension/lib/announce.js';
import { reviewListing } from '../extension/lib/analysis.js';
import { fmt } from '../extension/lib/format.js';

const LISTINGS = [
  { title: 'Sans filtre', artist: 'Vega', price: 230, rarity: 'hit', serial: 999 },
  { title: 'Téléphone rouge', artist: 'Mistral', price: 3400, rarity: 'platine', serial: null },
  { title: 'Dernier métro', artist: 'Kalia', price: 980, rarity: 'or', serial: 412 },
];

test('format par défaut : les plus chères d’abord, nombre de titres choisi', () => {
  const a = formatAnnouncement(LISTINGS, { count: 2 });
  assert.equal(
    a.text,
    `🛒 En vente au Marché : Téléphone rouge – Mistral (Platine) ${fmt(3400)} ♫ | Dernier métro – Kalia (Or) 980 ♫`,
  );
  assert.equal(a.included, 2);
  assert.equal(a.requested, 2);
  assert.equal(a.available, 3);
  assert.equal(a.length, a.text.length);
  assert.equal(a.tooLong, false);
});

test('majuscules sur le titre et l’artiste seulement', () => {
  const a = formatAnnouncement(LISTINGS, { count: 1, uppercase: true });
  assert.equal(a.text, `🛒 En vente au Marché : TÉLÉPHONE ROUGE – MISTRAL (Platine) ${fmt(3400)} ♫`);
});

test('format personnalisé : champs, numéro, nombre, séparateur', () => {
  const a = formatAnnouncement(LISTINGS, {
    header: '{nombre} cartes dispo → {liste}',
    item: '{titre} {numero} à {prix}',
    separator: ' / ',
    count: 3,
  });
  assert.equal(a.text, `3 cartes dispo → Téléphone rouge à ${fmt(3400)} / Dernier métro n°412 à 980 / Sans filtre n°999 à 230`);
});

test('champs : {rareté} accepté, champ inconnu laissé tel quel, parenthèses vides retirées', () => {
  assert.equal(fillTemplate('{titre} ({rareté})', { titre: 'A', rarete: 'Or' }), 'A (Or)');
  assert.equal(fillTemplate('{titre} ({rarete}) {foo}', { titre: 'A', rarete: '' }), 'A {foo}');
});

test('annonce trop longue : on retire des titres pour tenir dans 240 signes', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    title: `Un titre vraiment très long pour remplir le chat ${i}`,
    artist: 'Artiste au nom interminable',
    price: 1000 - i,
    rarity: 'or',
  }));
  const a = formatAnnouncement(many, { count: 10 });
  assert.equal(a.requested, 10);
  assert.ok(a.included < 10 && a.included > 0);
  assert.ok(a.length <= CHAT_MAX_LENGTH);
  assert.equal(a.tooLong, false);
});

test('rien à annoncer', () => {
  const a = formatAnnouncement([], {});
  assert.equal(a.included, 0);
  assert.equal(a.text, '🛒 En vente au Marché :');
});

test('réglages de l’annonce : bornes et valeurs par défaut', () => {
  assert.deepEqual(normalizeAnnounce(undefined), { ...DEFAULT_ANNOUNCE });
  assert.equal(normalizeAnnounce({ count: 0 }).count, 1);
  assert.equal(normalizeAnnounce({ count: 99 }).count, 10);
  assert.equal(normalizeAnnounce({ count: 'abc' }).count, DEFAULT_ANNOUNCE.count);
  assert.equal(normalizeAnnounce({ uppercase: 'oui' }).uppercase, false);
  assert.equal(normalizeAnnounce({ header: '' }).header, DEFAULT_ANNOUNCE.header);
  assert.equal(normalizeAnnounce({ separator: '' }).separator, '');
  assert.equal(normalizeAnnounce({ item: 'x'.repeat(500) }).item.length, CHAT_MAX_LENGTH);
});

test('mes annonces : le numéro de la carte en vente est repris', () => {
  const listing = { id: 5, trackId: '1', price: 900, expiresAt: Date.now() + 3_600_000 };
  const detail = { quote: 1000, listings: [{ id: 5, price: 900, mine: true, serial: 987 }], history: [] };
  assert.equal(reviewListing(listing, detail, { id: '1', rarity: 'or' }, Date.now()).serial, 987);
});
