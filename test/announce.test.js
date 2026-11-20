import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_MAX_LENGTH,
  DEFAULT_ANNOUNCE,
  fillTemplate,
  normalizeAnnounce,
  splitAnnouncements,
} from '../extension/lib/announce.js';
import { reviewListing } from '../extension/lib/analysis.js';
import { fmt } from '../extension/lib/format.js';

const LISTINGS = [
  { title: 'Sans filtre', artist: 'Vega', price: 230, rarity: 'hit', serial: 999 },
  { title: 'Téléphone rouge', artist: 'Mistral', price: 3400, rarity: 'platine', serial: null },
  { title: 'Dernier métro', artist: 'Kalia', price: 980, rarity: 'or', serial: 412 },
];

test('titres par message : toutes les ventes, les plus chères d’abord', () => {
  const { messages, total } = splitAnnouncements(LISTINGS, { perMessage: 2 });
  assert.equal(total, 3);
  assert.deepEqual(
    messages.map((m) => m.text),
    [
      `🛒 En vente au Marché : Téléphone rouge – Mistral (Platine) ${fmt(3400)} ♫ | Dernier métro – Kalia (Or) 980 ♫`,
      '🛒 En vente au Marché : Sans filtre – Vega (Hit) 230 ♫',
    ],
  );
  assert.deepEqual(messages.map((m) => m.titles), [2, 1]);
  assert.ok(messages.every((m) => m.length === m.text.length && !m.tooLong));
});

test('un titre par message, ou tout dans un seul', () => {
  assert.equal(splitAnnouncements(LISTINGS, { perMessage: 1 }).messages.length, 3);
  const one = splitAnnouncements(LISTINGS, { perMessage: 10 }).messages;
  assert.equal(one.length, 1);
  assert.equal(one[0].titles, 3);
});

test('majuscules sur le titre et l’artiste seulement', () => {
  const [m] = splitAnnouncements(LISTINGS, { perMessage: 1, uppercase: true }).messages;
  assert.equal(m.text, `🛒 En vente au Marché : TÉLÉPHONE ROUGE – MISTRAL (Platine) ${fmt(3400)} ♫`);
});

test('format personnalisé : champs, numéro, nombre, page, séparateur', () => {
  const { messages } = splitAnnouncements(LISTINGS, {
    header: '[{page}/{pages}] {nombre} cartes dispo → {liste}',
    item: '{titre} {numero} à {prix}',
    separator: ' / ',
    perMessage: 2,
  });
  assert.deepEqual(
    messages.map((m) => m.text),
    [`[1/2] 2 cartes dispo → Téléphone rouge à ${fmt(3400)} / Dernier métro n°412 à 980`, '[2/2] 1 cartes dispo → Sans filtre n°999 à 230'],
  );
});

test('champs : {rareté} accepté, champ inconnu laissé tel quel, parenthèses vides retirées', () => {
  assert.equal(fillTemplate('{titre} ({rareté})', { titre: 'A', rarete: 'Or' }), 'A (Or)');
  assert.equal(fillTemplate('{titre} ({rarete}) {foo}', { titre: 'A', rarete: '' }), 'A {foo}');
});

test('trop long pour 240 signes : le titre passe au message suivant, aucun n’est perdu', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    title: `Un titre vraiment très long pour remplir le chat ${i}`,
    artist: 'Artiste au nom interminable',
    price: 1000 - i,
    rarity: 'or',
  }));
  const { messages, total } = splitAnnouncements(many, { perMessage: 10, header: '({page}/{pages}) {liste}' });
  assert.equal(total, 10);
  assert.ok(messages.length > 1);
  assert.equal(messages.reduce((sum, m) => sum + m.titles, 0), 10);
  assert.ok(messages.every((m) => m.length <= CHAT_MAX_LENGTH && !m.tooLong));
  assert.ok(messages.at(-1).text.startsWith(`(${messages.length}/${messages.length})`));
});

test('un seul titre plus long que 240 signes est signalé', () => {
  const [m] = splitAnnouncements([{ title: 'x'.repeat(300), artist: 'A', price: 10, rarity: 'demo' }], {}).messages;
  assert.equal(m.titles, 1);
  assert.equal(m.tooLong, true);
});

test('rien à annoncer', () => {
  assert.deepEqual(splitAnnouncements([], {}), { messages: [], total: 0 });
});

test('réglages de l’annonce : bornes, valeurs par défaut, ancien réglage repris', () => {
  assert.deepEqual(normalizeAnnounce(undefined), { ...DEFAULT_ANNOUNCE });
  assert.equal(normalizeAnnounce({ perMessage: 0 }).perMessage, 1);
  assert.equal(normalizeAnnounce({ perMessage: 99 }).perMessage, 10);
  assert.equal(normalizeAnnounce({ perMessage: 'abc' }).perMessage, DEFAULT_ANNOUNCE.perMessage);
  assert.equal(normalizeAnnounce({ count: 5 }).perMessage, 5); // réglage de la version précédente
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
