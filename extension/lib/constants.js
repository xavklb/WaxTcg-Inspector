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

// Face to Face (guide « 06 Face to Face » et code du site, relevés le 20/11/2026).
export const FACEOFF = {
  deckSize: 5,
  rounds: 5,
  maxPoints: 20,
  maxPerArtist: 2,
  themeBonus: 15, // les cartes du thème de la partie prennent +15 sur toutes leurs notes
  points: { demo: 1, single: 2, hit: 3, or: 4, platine: 6, diamant: 8, worldwide: 10 },
  // Les 9 questions, telles que le jeu les pose.
  criteria: [
    { key: 'plays', label: 'Écoutes', question: 'Le son le plus écouté gagne' },
    { key: 'underground', label: 'Underground', question: 'Le son le moins écouté gagne' },
    { key: 'fans', label: 'Fans', question: 'L’artiste le plus suivi gagne' },
    { key: 'quote', label: 'Cote', question: 'La carte qui vaut le plus au Marché gagne' },
    { key: 'classic', label: 'Classique', question: 'Le son le plus ancien gagne' },
    { key: 'fresh', label: 'Fraîcheur', question: 'Le son le plus récent gagne' },
    { key: 'long', label: 'Le plus long', question: 'Le son le plus long gagne' },
    { key: 'short', label: 'Le plus court', question: 'Le son le plus court gagne' },
    { key: 'rare', label: 'La plus rare', question: 'La carte la plus rare gagne' },
  ],
  artistsPageSize: 60, // pagination de /api/artists, comme le site
  fansCacheMs: 24 * 3_600_000, // le nombre de fans bouge peu : relu une fois par jour
  themes: {
    vintage: 'Avant 2000',
    y2000: 'Années 2000',
    y2010: 'Années 2010',
    recent: 'Depuis 2020',
    fr: 'Made in France',
    abroad: 'International',
    rap: 'Rap',
    pop: 'Pop',
    rock: 'Rock',
    electro: 'Électro',
    feat: 'Featurings',
  },
};

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
  sellFavorites: true, // proposer à la vente mes cartes en coup de cœur ❤
  sellProtectedArtists: true, // proposer à la vente les titres de mes artistes protégés 🛡
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

const FLAGS = ['sellFavorites', 'sellProtectedArtists'];

/** Fusionne des réglages saisis avec les valeurs par défaut, en bornant chaque valeur. */
export function normalizeSettings(raw = {}) {
  const out = { ...DEFAULT_SETTINGS };
  for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(raw?.[key]);
    if (raw?.[key] !== undefined && raw?.[key] !== '' && Number.isFinite(v)) {
      out[key] = Math.min(hi, Math.max(lo, v));
    }
  }
  for (const key of FLAGS) if (typeof raw?.[key] === 'boolean') out[key] = raw[key];
  return out;
}
