// Annonce de mes ventes pour le chat du label.
// L'extension produit seulement le texte : c'est toi qui le colles et l'envoies dans le chat
// (les règles de WAX interdisent l'envoi automatique, et le chat est limité à 240 signes).
import { RARITY } from './constants.js';
import { fmt } from './format.js';

export const CHAT_MAX_LENGTH = 240;
export const MAX_ANNOUNCE_COUNT = 10;

export const DEFAULT_ANNOUNCE = Object.freeze({
  header: '🛒 En vente au Marché : {liste}',
  item: '{titre} – {artiste} ({rarete}) {prix} ♫',
  separator: ' | ',
  count: 3,
  uppercase: false,
});

export const ANNOUNCE_PLACEHOLDERS = {
  header: ['{liste}', '{nombre}'],
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
  const count = Math.round(Number(raw?.count));
  return {
    header: text(raw?.header, DEFAULT_ANNOUNCE.header) || DEFAULT_ANNOUNCE.header,
    item: text(raw?.item, DEFAULT_ANNOUNCE.item) || DEFAULT_ANNOUNCE.item,
    separator: text(raw?.separator, DEFAULT_ANNOUNCE.separator),
    count: Number.isFinite(count) ? Math.min(MAX_ANNOUNCE_COUNT, Math.max(1, count)) : DEFAULT_ANNOUNCE.count,
    uppercase: typeof raw?.uppercase === 'boolean' ? raw.uppercase : DEFAULT_ANNOUNCE.uppercase,
  };
}

/**
 * Compose l'annonce à partir de mes annonces ouvertes [{title, artist, price, rarity, serial}],
 * les plus chères d'abord. Si le texte dépasse 240 signes, on retire des titres en partant de la fin.
 */
export function formatAnnouncement(listings, options) {
  const o = normalizeAnnounce(options);
  const up = (s) => (o.uppercase ? String(s ?? '').toLocaleUpperCase('fr-FR') : String(s ?? ''));
  const chosen = [...(listings ?? [])].filter((l) => l && l.price > 0).sort((a, b) => b.price - a.price).slice(0, o.count);
  const items = chosen.map((l) =>
    fillTemplate(o.item, {
      titre: up(l.title),
      artiste: up(l.artist),
      prix: fmt(l.price),
      rarete: RARITY[l.rarity]?.label ?? '',
      numero: l.serial ? `n°${l.serial}` : '',
    }),
  );

  let included = items.length;
  let text = '';
  while (included >= 0) {
    text = fillTemplate(o.header, { liste: items.slice(0, included).join(o.separator), nombre: included });
    if (text.length <= CHAT_MAX_LENGTH || included === 0) break;
    included -= 1;
  }
  return {
    text,
    length: text.length,
    included,
    requested: chosen.length,
    available: (listings ?? []).length,
    tooLong: text.length > CHAT_MAX_LENGTH,
  };
}
