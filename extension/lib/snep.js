// Certifications SNEP → montées de rareté WAX.
//
// Une carte WAX monte (Hit → Or, Platine → Diamant…) quand son son est certifié par le SNEP,
// et la cote repart alors du niveau de la nouvelle rareté (observé : ×1,6 à ×6).
// Le SNEP publie ses certifications le lundi après-midi ; WAX les applique de 12 h à 3 jours après.
// Entre les deux, la carte se vend encore au prix de son ancienne rareté.
import { RARITIES, RARITY } from './constants.js';
import { netAfterTax } from './analysis.js';

const DAY = 86_400_000;

export const SNEP_LIST_URL = 'https://snepmusique.com/les-certifications/';
export const SNEP_API_LATEST = 'https://snepmusique.com/wp-json/wp/v2/certifications_du_sn?per_page=1&_fields=date_gmt';

/** Page n des singles certifiés, les plus récents d'abord (30 à 60 par page). */
export function snepSinglesUrl(page = 1) {
  return page <= 1 ? `${SNEP_LIST_URL}?categorie=Singles` : `${SNEP_LIST_URL}page/${page}?categorie=Singles`;
}

const ENTITIES = { amp: '&', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

const frDateToIso = (d) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(d ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/** Lit les certifications d'une page HTML de snepmusique.com. */
export function parseSnepHtml(html) {
  const blocks = String(html ?? '').split(/<div class="certification[\s"]/).slice(1);
  const field = (block, cls) => {
    const m = new RegExp(`<div class="${cls}[^"]*">([^<]*)<`).exec(block);
    return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
  };
  const date = (block, label) => frDateToIso((new RegExp(`${label}</span>\\s*([\\d/]+)`).exec(block) ?? [])[1]);
  return blocks
    .map((b) => ({
      category: field(b, 'categorie'),
      title: field(b, 'titre'),
      artist: field(b, 'artiste'),
      level: field(b, 'certif'),
      released: date(b, 'Date de sortie'),
      certifiedOn: date(b, 'Date de constat'),
    }))
    .filter((c) => c.title && c.level);
}

/** Rareté WAX correspondant à un niveau SNEP (« Double Platine » → platine). */
export function targetRarity(level) {
  const l = String(level ?? '').toLowerCase();
  if (l.includes('diamant')) return 'diamant';
  if (l.includes('platine')) return 'platine';
  if (/\bor\b/.test(l)) return 'or';
  return null;
}

export const rarityRank = (r) => RARITIES.indexOf(r);

/** Minuscules, sans accents ni ponctuation. */
export function normalizeName(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Titre sans « (feat. …) », « [Remix] » ni « - version ». */
export function normalizeTitle(s) {
  return normalizeName(
    String(s ?? '')
      .replace(/\s*[([].*?[)\]]/g, '')
      .replace(/\s+(feat|ft)\.?\s.*$/i, '')
      .replace(/\s+-\s+.*$/, ''),
  );
}

/** Noms d'artistes d'une certification : « TIAKOLA, SDM & LIIM’S » → [tiakola, sdm, liims]. */
export function artistNames(s) {
  return String(s ?? '')
    .split(/,|&|\s+(?:feat|ft)\.?\s+|\s+x\s+|\s+et\s+|\s+and\s+|\//i)
    .map(normalizeName)
    .filter(Boolean);
}

function artistMatches(cert, track) {
  const wax = normalizeName(track.artist);
  if (!wax) return false;
  const names = artistNames(cert.artist);
  const full = normalizeName(cert.artist);
  return names.some((n) => n === wax || n.includes(wax) || wax.includes(n)) || full.includes(wax);
}

/** La carte WAX qui correspond à une certification, parmi les résultats d'une recherche. */
export function matchTrack(cert, tracks) {
  const want = normalizeTitle(cert.title);
  const candidates = (tracks ?? []).filter((t) => t?.id && artistMatches(cert, t));
  const exact = candidates.filter((t) => normalizeTitle(t.title) === want);
  const loose = candidates.filter((t) => {
    const title = normalizeTitle(t.title);
    return title.startsWith(want) || want.startsWith(title);
  });
  const pool = exact.length ? exact : loose;
  return pool.sort((a, b) => (Number(b.rank) || 0) - (Number(a.rank) || 0))[0] ?? null;
}

/**
 * Cote de départ estimée après la montée (formule du jeu, prudente) :
 * base de la rareté × (0,7 + 0,6 × popularité) × facteur fans ; le multiplicateur ◉ (1 à 1,7) est pris à 1.
 */
export function estimateUpgradedQuote(track, rarity, fans) {
  const base = RARITY[rarity]?.base;
  if (!base) return null;
  const pop = 0.7 + 0.6 * Math.min(1, (Number(track?.rank) || 0) / 1e6);
  const f = Number(fans);
  const fanFactor = f > 0 ? 0.75 + 0.5 * Math.min(1, Math.max(0, (Math.log10(Math.max(1, f)) - 4) / 3)) : 1;
  return Math.round(base * pop * fanFactor);
}

/**
 * Opportunité d'achat avant la montée, à partir de la fiche WAX de la carte (/api/cards/{id}).
 * Valeur après la montée = la plus haute entre l'estimation prudente et la cote actuelle.
 */
export function evaluateUpgrade(cert, track, card, { budget = Infinity, now = Date.now() } = {}) {
  const t = card?.track ?? track;
  const to = targetRarity(cert.level);
  const market = card?.market ?? {};
  const quote = Number(market.quote) > 0 ? Number(market.quote) : null;
  const estimate = estimateUpgradedQuote(t, to, card?.artist?.fans);
  const expected = Math.max(estimate ?? 0, quote ?? 0) || null;
  const buy = Number(market.cheapest) > 0 ? Number(market.cheapest) : null;
  const net = expected ? netAfterTax(expected) : null;
  const profit = buy != null && net != null ? net - buy : null;
  return {
    cert,
    track: t,
    from: t.rarity,
    to,
    quote,
    estimate,
    expected,
    buy,
    listings: Number(market.listings) || 0,
    net,
    profit,
    multiple: buy && expected ? expected / buy : null,
    affordable: buy != null && buy <= budget,
    sales7d: (market.sales ?? []).filter((s) => s && now - s.at <= 7 * DAY).length,
  };
}

/** Date ISO (aaaa-mm-jj) moins n jours. */
export function isoMinusDays(iso, days) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t - days * DAY).toISOString().slice(0, 10) : '';
}

/** Seconde recherche quand le titre est trop courant : l'artiste principal (« ORELSAN FEAT. GIMS » → orelsan). */
export function artistQuery(cert) {
  return (artistNames(cert.artist)[0] ?? '').slice(0, 60);
}

/** Recherche WAX à lancer pour une certification : le titre seul, sans parenthèses. */
export function searchQuery(cert) {
  return String(cert.title ?? '')
    .replace(/\s*[([].*?[)\]]/g, '')
    .trim()
    .slice(0, 60);
}
