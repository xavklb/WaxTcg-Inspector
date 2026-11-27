// Préremplissage de la vente groupée du site (« Vendre plusieurs à la fois » → « Fixer les prix »).
// Le panneau choisit les cartes et les prix ; prefill.js (script de contenu) les reporte dans la fenêtre du site.
// La mise en vente reste toujours faite par le joueur, avec le bouton « Tout mettre en vente » du site.
import { MARKET, RARITY } from './constants.js';
import { allowedRange, clamp, netAfterTax, otherListings } from './analysis.js';
import { fmt } from './format.js';

export const PREFILL_HOURS = 48;
// Fiches du Marché lues en plus de l'analyse quand il manque des ventes pour remplir les places libres.
export const PREFILL_EXTRA_DETAILS = 60;
// Juste avant de préremplir, chaque fiche est relue si elle date de plus de 30 secondes.
export const PREFILL_FRESH_MS = 30_000;

/**
 * Prix pour passer juste devant : 1 ♫ sous l'annonce la moins chère des autres joueurs,
 * dans la fourchette autorisée par le site. Mes propres annonces ne comptent pas.
 * Personne d'autre ne la vend : le prix conseillé par l'analyse.
 * `detail` : fiche fraîche du Marché (/api/market/{id}) ; sans elle, les données de l'analyse.
 * `front` est faux quand le moins cher est sous le prix minimum autorisé : impossible de passer devant.
 */
export function frontPrice(sale, detail = null) {
  const quote = detail?.quote ?? sale.quote ?? 0;
  const range = detail?.range ?? sale.range ?? allowedRange(quote, sale.track?.rarity);
  const cheapest = detail ? (otherListings(detail.listings)[0]?.price ?? null) : (sale.cheapestOther ?? null);
  const price = Math.round(clamp(cheapest == null ? sale.price : cheapest - 1, range.min, range.max));
  const net = netAfterTax(price);
  const recycle = RARITY[sale.track?.rarity]?.recycle ?? 0;
  return {
    price,
    cheapest,
    front: cheapest == null || price < cheapest,
    net,
    gain: sale.duplicates > 0 ? net - recycle : net,
  };
}

/**
 * Pourquoi une vente ne peut pas être préremplie (null si elle peut l'être).
 * La vente groupée du site ne choisit pas le numéro vendu : il prend ton exemplaire le plus ordinaire.
 * Un numéro en coup de cœur reste donc à vendre depuis la fiche de la carte.
 * Un dernier exemplaire peut être prérempli : le site demande alors de cocher « Je la vends quand même ».
 * Un doublon vendu juste devant le moins cher doit rapporter plus que son recyclage.
 */
export function prefillBlocker(r, fp = null) {
  if (!r || !r.track?.id || !(r.price > 0)) return 'pas de prix';
  if (r.sellIsFavorite) return 'numéro en coup de cœur : à vendre depuis sa fiche';
  if ((r.listedByMe ?? 0) > 0 && !(r.duplicates > 0)) return 'déjà en vente, plus de doublon';
  if (r.duplicates > 0 && (fp ?? frontPrice(r)).gain <= 0) return 'rapporterait moins que le recyclage';
  return null;
}

/**
 * Ordre de préremplissage : d'abord les titres que je n'ai pas en vente, dans l'ordre du classement,
 * puis un exemplaire de plus des titres déjà en vente.
 */
function candidates(toSell) {
  const ok = (toSell ?? []).filter((r) => !prefillBlocker(r));
  return [...ok.filter((r) => !((r.listedByMe ?? 0) > 0)), ...ok.filter((r) => (r.listedByMe ?? 0) > 0)];
}

const maxItems = (free) => Math.max(0, Math.min(free, MARKET.maxOpenListings));

function item(r, fp) {
  return {
    id: String(r.track.id),
    title: r.track.title ?? '',
    artist: r.track.artist ?? '',
    rarityLabel: RARITY[r.track.rarity]?.label ?? '',
    price: fp.price,
    last: !(r.duplicates > 0),
    note: prefillNote(r, fp),
  };
}

/** Aperçu, avec les données de l'analyse : les ventes à préremplir, jusqu'à remplir les places libres (20 au plus). */
export function prefillPlan(toSell, free) {
  return candidates(toSell)
    .slice(0, maxItems(free))
    .map((r) => item(r, frontPrice(r)));
}

/**
 * Ventes à envoyer au site : relit la fiche de chaque carte (si elle a plus de 30 s), fixe le prix juste devant
 * le moins cher, et écarte les doublons qui rapporteraient alors moins que le recyclage, jusqu'à remplir les places.
 * `api.get(path, { ttlMs })` : voir api.js.
 */
export async function buildPrefill(api, toSell, free, { progress = () => {} } = {}) {
  const want = maxItems(free);
  const list = candidates(toSell);
  const items = [];
  const skipped = [];
  for (const r of list) {
    if (items.length >= want) break;
    progress(`Prix du moment : ${r.track.title} (${items.length + 1}/${want})…`);
    const detail = await api.get(`/api/market/${r.track.id}`, { ttlMs: PREFILL_FRESH_MS });
    const fp = frontPrice(r, detail);
    if (prefillBlocker(r, fp)) skipped.push({ id: String(r.track.id), title: r.track.title, ...fp });
    else items.push(item(r, fp));
  }
  return { items, skipped };
}

/** Ligne affichée sous la carte dans la fenêtre « Fixer les prix » du site. */
export function prefillNote(r, fp) {
  const why =
    fp.cheapest == null
      ? r.premium
        ? `personne d’autre ne la vend, elle est demandée : cote ×${String(r.premium).replace('.', ',')}`
        : 'personne d’autre ne la vend : prix conseillé'
      : fp.front
        ? `1 ♫ sous le moins cher (${fmt(fp.cheapest)} ♫)`
        : `le moins cher (${fmt(fp.cheapest)} ♫) est sous le prix minimum autorisé : prix minimum`;
  const gain = r.duplicates > 0 ? ` (+${fmt(fp.gain)} vs recyclage)` : '';
  return `WAX Inspector · ${why} · net ${fmt(fp.net)} ♫${gain}`;
}
