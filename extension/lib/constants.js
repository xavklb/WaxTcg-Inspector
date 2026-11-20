// Constantes du jeu, relevées dans le code de waxtcg.com le 20/11/2026.
// Voir docs/analyse-waxtcg.md.

export const RARITIES = ['demo', 'single', 'hit', 'or', 'platine', 'diamant', 'worldwide'];

// recycle : Mélodies rendues par le recyclage d'un doublon
// base    : base de la cote de départ (avant facteurs popularité/fans)
// min/max : prix de vente autorisés quelle que soit la cote
export const RARITY = {
  demo: { label: 'Découverte', color: '#9aa3b5', recycle: 5, base: 30, min: 10, max: 400 },
  single: { label: 'Populaire', color: '#5fd4a8', recycle: 10, base: 60, min: 20, max: 800 },
  hit: { label: 'Hit', color: '#5aa9ff', recycle: 30, base: 200, min: 60, max: 2500 },
  or: { label: 'Or', color: '#ffc94d', recycle: 100, base: 700, min: 200, max: 8000 },
  platine: { label: 'Platine', color: '#d9e4ff', recycle: 150, base: 2500, min: 600, max: 30000 },
  diamant: { label: 'Diamant', color: '#ff6bd6', recycle: 400, base: 9000, min: 2000, max: 100000 },
  worldwide: { label: 'Worldwide', color: '#a46bff', recycle: 2000, base: 120000, min: 100000, max: 1000000 },
};

export const MARKET = {
  taxRate: 0.05, // taxe prélevée sur le prix de vente
  below: 0.75, // prix minimum = 75 % de la cote
  above: 2, // prix maximum = 200 % de la cote
  maxOpenListings: 20,
};

export const MIN_DELAY_MS = 400;

export const DEFAULT_SETTINGS = Object.freeze({
  budget: 0, // 0 = toutes mes Mélodies
  minProfit: 20, // gain net minimum, en Mélodies
  minRoi: 0.1, // rendement minimum (0,1 = 10 %)
  minSales7d: 3, // ventes minimum du titre sur 7 jours
  maxDetails: 20, // fiches détaillées lues par analyse (1 requête chacune)
  delayMs: 700, // pause entre deux requêtes
  scanCount: 3000, // titres lus par rareté dans la liste du Marché
  screenRatio: 0.88, // premier tri : prix <= 88 % de la cote
  hypeRatio: 3, // « hype » : valeur >= 3 × la cote de base de la rareté
  minHypeValue: 100, // valeur minimum pour proposer de vendre une carte unique
  auctionHorizonMin: 120, // enchères qui se terminent dans ce délai
});

const LIMITS = {
  budget: [0, 10_000_000],
  minProfit: [0, 1_000_000],
  minRoi: [0, 10],
  minSales7d: [0, 1000],
  maxDetails: [1, 50],
  delayMs: [MIN_DELAY_MS, 10_000],
  scanCount: [90, 3000],
  screenRatio: [0.5, 1],
  hypeRatio: [1, 100],
  minHypeValue: [0, 1_000_000],
  auctionHorizonMin: [5, 24 * 60],
};

/** Fusionne des réglages saisis avec les valeurs par défaut, en bornant chaque valeur. */
export function normalizeSettings(raw = {}) {
  const out = { ...DEFAULT_SETTINGS };
  for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(raw?.[key]);
    if (raw?.[key] !== undefined && raw?.[key] !== '' && Number.isFinite(v)) {
      out[key] = Math.min(hi, Math.max(lo, v));
    }
  }
  return out;
}
