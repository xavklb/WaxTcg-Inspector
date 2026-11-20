// Annonce de mes ventes pour le chat du label.
// L'extension produit seulement le texte : c'est toi qui le colles et l'envoies dans le chat
// (les règles de WAX interdisent l'envoi automatique, et le chat est limité à 240 signes).
import { RARITY } from './constants.js';
import { fmt } from './format.js';

export const CHAT_MAX_LENGTH = 240;
export const MAX_PER_MESSAGE = 10;

export const DEFAULT_ANNOUNCE = Object.freeze({
  header: '🛒 En vente au Marché : {liste}',
  item: '{titre} – {artiste} ({rarete}) {prix} ♫',
  separator: ' | ',
  perMessage: 3, // nombre de titres par message
  uppercase: false,
});

export const ANNOUNCE_PLACEHOLDERS = {
  header: ['{liste}', '{nombre}', '{page}', '{pages}'],
  item: ['{titre}', '{artiste}', '{prix}', '{rarete}', '{numero}'],
};

const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Remplace les {champs} d'un modèle ; {rareté} et {rarete} sont équivalents. */
export function fillTemplate(template, vars) {
  return String(template ?? '')
    .replace(/\{([^{}]{1,20})\}/g, (match, key) => {
      const k = stripAccents(key.trim().toLowerCase());
      return Object.hasOwn(vars, k) ? String(vars[k] ?? '') : match;
    })
    .replace(/\(\s*\)/g, '') // parenthèses vidées par un champ absent
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function normalizeAnnounce(raw = {}) {
  const text = (v, d) => (typeof v === 'string' ? v.slice(0, CHAT_MAX_LENGTH) : d);
  // `count` : nom de ce réglage dans la version précédente.
  const per = Math.round(Number(raw?.perMessage ?? raw?.count));
  return {
    header: text(raw?.header, DEFAULT_ANNOUNCE.header) || DEFAULT_ANNOUNCE.header,
    item: text(raw?.item, DEFAULT_ANNOUNCE.item) || DEFAULT_ANNOUNCE.item,
    separator: text(raw?.separator, DEFAULT_ANNOUNCE.separator),
    perMessage: Number.isFinite(per) ? Math.min(MAX_PER_MESSAGE, Math.max(1, per)) : DEFAULT_ANNOUNCE.perMessage,
    uppercase: typeof raw?.uppercase === 'boolean' ? raw.uppercase : DEFAULT_ANNOUNCE.uppercase,
  };
}

/**
 * Répartit mes annonces ouvertes [{title, artist, price, rarity, serial}], les plus chères d'abord,
 * en messages d'au plus `perMessage` titres et 240 signes. Un titre qui ne tient plus
 * passe au message suivant : aucun n'est perdu.
 */
export function splitAnnouncements(listings, options) {
  const o = normalizeAnnounce(options);
  const up = (s) => (o.uppercase ? String(s ?? '').toLocaleUpperCase('fr-FR') : String(s ?? ''));
  const items = [...(listings ?? [])]
    .filter((l) => l && l.price > 0)
    .sort((a, b) => b.price - a.price)
    .map((l) =>
      fillTemplate(o.item, {
        titre: up(l.title),
        artiste: up(l.artist),
        prix: fmt(l.price),
        rarete: RARITY[l.rarity]?.label ?? '',
        numero: l.serial ? `n°${l.serial}` : '',
      }),
    );
  const render = (chunk, page, pages) => fillTemplate(o.header, { liste: chunk.join(o.separator), nombre: chunk.length, page, pages });

  // Découpage mesuré avec « 99/99 » à la place des numéros de page, qui ne sont connus qu'à la fin.
  const chunks = [];
  let current = [];
  for (const item of items) {
    const next = [...current, item];
    if (current.length && (next.length > o.perMessage || render(next, 99, 99).length > CHAT_MAX_LENGTH)) {
      chunks.push(current);
      current = [item];
    } else {
      current = next;
    }
  }
  if (current.length) chunks.push(current);

  const messages = chunks.map((chunk, i) => {
    const text = render(chunk, i + 1, chunks.length);
    return { text, length: text.length, titles: chunk.length, tooLong: text.length > CHAT_MAX_LENGTH };
  });
  return { messages, total: items.length };
}
