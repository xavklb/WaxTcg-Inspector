// Préremplissage de la vente groupée du site (« Vendre plusieurs à la fois » → « Fixer les prix »).
// Le panneau choisit les cartes et les prix ; prefill.js (script de contenu) les reporte dans la fenêtre du site.
// La mise en vente reste toujours faite par le joueur, avec le bouton « Tout mettre en vente » du site.
import { RARITY } from './constants.js';
import { fmt } from './format.js';

export const PREFILL_HOURS = 48;

/**
 * Pourquoi une vente conseillée ne peut pas être préremplie (null si elle peut l'être).
 * La vente groupée du site ne choisit pas le numéro vendu : il prend ton exemplaire le plus ordinaire.
 * Seuls les doublons dont le numéro à vendre n'est pas en coup de cœur sont donc préremplis.
 */
export function prefillBlocker(r) {
  if (!r || !r.track?.id || !(r.price > 0)) return 'pas de prix';
  if (r.verdict === 'recycle') return 'mieux vaut la recycler';
  if (!(r.duplicates > 0)) return 'dernier exemplaire : à vendre depuis sa fiche';
  if (r.sellIsFavorite) return 'numéro en coup de cœur : à vendre depuis sa fiche';
  if ((r.listedByMe ?? 0) > 0) return 'déjà en vente';
  return null;
}

/** Les meilleures ventes à préremplir, dans l'ordre du classement, sans dépasser les places libres. */
export function prefillPlan(toSell, free) {
  const items = [];
  for (const r of toSell ?? []) {
    if (items.length >= Math.max(0, free)) break;
    if (prefillBlocker(r)) continue;
    items.push({
      id: String(r.track.id),
      title: r.track.title ?? '',
      artist: r.track.artist ?? '',
      rarityLabel: RARITY[r.track.rarity]?.label ?? '',
      price: r.price,
      note: prefillNote(r),
    });
  }
  return items;
}

/** Ligne affichée sous la carte dans la fenêtre « Fixer les prix » du site. */
export function prefillNote(r) {
  const why =
    r.cheapestOther == null
      ? r.premium
        ? `personne d’autre ne la vend, elle est demandée : cote ×${String(r.premium).replace('.', ',')}`
        : 'personne d’autre ne la vend : prix des dernières ventes'
      : r.cantBeat
        ? `le moins cher est à ${fmt(r.cheapestOther)} ♫, sous la fourchette`
        : r.price === r.cheapestOther - 1
          ? `1 ♫ sous le moins cher (${fmt(r.cheapestOther)} ♫)`
          : `prix des dernières ventes, moins cher que les autres vendeurs (dès ${fmt(r.cheapestOther)} ♫)`;
  const gain = r.duplicates > 0 ? ` (+${fmt(r.gain)} vs recyclage)` : '';
  return `WAX Inspector · ${why} · net ${fmt(r.net)} ♫${gain} · ${Math.round((r.chance ?? 0) * 100)} % de chances de vendre sous 3 j`;
}
