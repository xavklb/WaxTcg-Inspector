// Données de démonstration (titres et artistes inventés) au format de l'API WAX.
// Servent aux tests (test/runs.test.js) et à l'aperçu du panneau (dev/preview.html).
import { RARITIES, RARITY } from '../extension/lib/constants.js';
import { allowedRange } from '../extension/lib/analysis.js';

export const NOW = 1_795_171_000_000;
const H = 3_600_000;
const MIN = 60_000;

let seed = 20261120;
function rnd() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

const ARTISTS = ['Nova', 'Kalia', 'Le Collectif', 'Saphir', 'Mistral', 'Vega', 'Orion', 'Lune Rouge', 'Atlas', 'Kenza B'];
const WORDS = ['Néon', 'Asphalte', 'Minuit', 'Comète', 'Satellite', 'Vertige', 'Boulevard', 'Mirage', 'Orage', 'Lumière', 'Kilomètre', 'Rivage', 'Éclipse', 'Planète', 'Rêverie', 'Fréquence', 'Quartier', 'Horizon'];
const BASE_QUOTE = { demo: 30, single: 70, hit: 250, or: 900, platine: 2800, diamant: 11000, worldwide: 150000 };

const SPECS = new Map();
let listingId = 50_000;

const titleFor = (n) => `${WORDS[n % WORDS.length]}${n >= WORDS.length ? ` ${Math.floor(n / WORDS.length) + 1}` : ''}`;

const artistIdOf = (artist) => String(100 + Math.max(0, ARTISTS.indexOf(artist)));

function makeTrack(id, rarity, title, artist, extra = {}) {
  return {
    id: String(id), title, artist, artistId: artistIdOf(artist), albumId: '1', album: 'Album démo', cover: '',
    duration: 180, rank: 600000, rarity, region: 'fr', position: 1, albumSize: 12, year: 2025, style: 'rap',
    ...extra,
  };
}

function makeHistory(quote, recent, older) {
  const out = [];
  for (let i = 0; i < recent; i++) {
    out.push({ at: NOW - Math.round(((i + 1) * 144 * H) / (recent + 1)), price: Math.round(quote * (0.94 + 0.12 * rnd())) });
  }
  for (let i = 0; i < older; i++) {
    out.push({ at: NOW - (8 + 2 * i) * 24 * H, price: Math.round(quote * (0.9 + 0.2 * rnd())) });
  }
  return out.sort((a, b) => a.at - b.at);
}

function addSpec({ id, rarity, title, artist, quote, best, sellers = 3, recent = 5, older = 3, mine = [], history, extra }) {
  const listings = [];
  if (best != null) {
    for (let i = 0; i < sellers; i++) {
      listings.push({
        id: listingId++,
        price: i === 0 ? best : Math.round(best * (1.06 + 0.1 * i)),
        mine: false,
        expiresAt: NOW + (12 + 9 * i) * H,
        serial: 200 + Math.floor(rnd() * 3000),
        edition: false,
        packed: null,
      });
    }
  }
  for (const m of mine) listings.push({ id: m.id, price: m.price, mine: true, expiresAt: m.expiresAt, serial: m.serial ?? 999, edition: false, packed: null });
  const spec = {
    track: makeTrack(id, rarity, title ?? titleFor(id), artist ?? ARTISTS[id % ARTISTS.length], extra),
    quote,
    listings,
    history: (history ?? makeHistory(quote, recent, older)).sort((a, b) => a.at - b.at),
  };
  SPECS.set(String(id), spec);
  return spec;
}

// ---------------------------------------------------------------- Marché

// Chaque motif : prix le plus bas (× cote) et nombre de ventes sur 7 jours.
const PATTERNS = [
  { ratio: 0.76, recent: 9 }, // bonne affaire qui se revend
  { ratio: 0.8, recent: 1 }, // pas chère mais ne se vend pas
  { ratio: 0.85, recent: 14 },
  { ratio: 0.97, recent: 4 },
  { ratio: 1.05, recent: 6 },
  { ratio: 0.9, recent: 3 },
];

let nextId = 1000;
for (const rarity of RARITIES) {
  const n = rarity === 'worldwide' ? 3 : 12;
  for (let i = 0; i < n; i++) {
    const p = PATTERNS[i % PATTERNS.length];
    const quote = Math.round(BASE_QUOTE[rarity] * (0.6 + rnd()));
    const id = nextId++;
    addSpec({ id, rarity, quote, best: Math.max(RARITY[rarity].min, Math.round(quote * p.ratio)), sellers: 1 + (i % 4), recent: p.recent, older: 4 });
  }
}

// ---------------------------------------------------------------- Mes annonces

const MY_LISTINGS = [
  { id: 90001, trackId: '7100', price: 3400, status: 'open', expiresAt: NOW + 30 * H, closedAt: null },
  { id: 90002, trackId: '7101', price: 980, status: 'open', expiresAt: NOW + 4 * H, closedAt: null },
  { id: 90003, trackId: '7102', price: 230, status: 'open', expiresAt: NOW + 40 * H, closedAt: null },
  { id: 89990, trackId: '1004', price: 120, status: 'sold', expiresAt: NOW - 10 * H, closedAt: NOW - 20 * H },
  { id: 89980, trackId: '1005', price: 90, status: 'cancelled', expiresAt: NOW - 30 * H, closedAt: NOW - 40 * H },
];
const mineOf = (trackId) => MY_LISTINGS.filter((l) => l.trackId === trackId && l.status === 'open');

addSpec({ id: 7100, rarity: 'platine', title: 'Téléphone rouge', artist: 'Mistral', quote: 3200, best: 3000, sellers: 2, recent: 5, mine: mineOf('7100') });
addSpec({ id: 7101, rarity: 'or', title: 'Dernier métro', artist: 'Kalia', quote: 1000, best: 1100, sellers: 2, recent: 6, mine: mineOf('7101') });
addSpec({ id: 7102, rarity: 'hit', title: 'Sans filtre', artist: 'Vega', quote: 300, best: 340, sellers: 1, recent: 7, mine: mineOf('7102') });

// ---------------------------------------------------------------- Ma collection

const fallingHistory = [300, 310, 320, 330, 345, 480, 520, 540, 560, 600].map((price, i) => ({ at: NOW - (i + 1) * 2 * H, price }));

const COLLECTION = [
  { spec: { id: 7000, rarity: 'hit', title: 'Gravité', artist: 'Orion', quote: 240, best: 230, sellers: 2, recent: 6 }, copies: [[45, null], [812, null], [1530, null]], value: 240 },
  { spec: { id: 7001, rarity: 'single', title: 'Coup de cœur', artist: 'Saphir', quote: 600, best: 580, recent: 8 }, copies: [[3, null]], value: 600, locked: [3] },
  { spec: { id: 7002, rarity: 'single', title: 'Sortie de nuit', artist: 'Nova', quote: 441, best: 350, sellers: 4, history: fallingHistory }, copies: [[987, null]], value: 441 },
  { spec: { id: 7003, rarity: 'or', title: 'Carrousel', artist: 'Atlas', quote: 950, best: 900, sellers: 3, recent: 5 }, copies: [[120, null], [900, null], [2210, null]], value: 950, locked: [900] },
  { spec: { id: 7004, rarity: 'demo', title: 'Face B', artist: 'Kenza B', quote: 25, best: 20, sellers: 2, recent: 0, older: 2 }, copies: [[5000, null], [6100, null]], value: 25 },
  { spec: { id: 7005, rarity: 'or', title: 'Disque d’or', artist: 'Le Collectif', quote: 2400, best: 2300, sellers: 2, recent: 4 }, copies: [[33, 'hit']], value: 2400 },
];
for (let i = 0; i < 10; i++) {
  COLLECTION.push({ spec: { id: 7010 + i, rarity: 'single', quote: 60, best: 58, recent: 2 }, copies: [[1000 + i * 37, null]], value: 60 });
}
// Cartes variées sans annonce, pour le Face to Face.
const DECK_RARITIES = ['demo', 'single', 'hit', 'demo', 'or', 'single', 'demo', 'platine', 'hit', 'demo', 'diamant', 'single'];
for (let i = 0; i < 24; i++) {
  const rarity = DECK_RARITIES[i % DECK_RARITIES.length];
  const value = Math.round(RARITY[rarity].base * (0.8 + 0.7 * rnd()));
  COLLECTION.push({ spec: { id: 7020 + i, rarity, quote: value, best: null }, copies: [[3000 + i * 11, null]], value });
}

// Données utiles au Face to Face : popularité, année, durée, pays, style, featuring.
const STYLES = ['rap', 'rap', 'pop', 'rock', 'electro'];
const REGIONS = ['fr', 'fr', 'us', 'world'];
for (const [i, c] of COLLECTION.entries()) {
  const feat = i % 7 === 3 ? ` (feat. ${ARTISTS[(i + 3) % ARTISTS.length]})` : '';
  c.spec.title = `${c.spec.title ?? titleFor(c.spec.id)}${feat}`;
  c.spec.extra = {
    rank: 40_000 + Math.floor(rnd() * 960_000),
    year: 1972 + Math.floor(rnd() * 54),
    duration: 105 + Math.floor(rnd() * 270),
    region: REGIONS[i % REGIONS.length],
    style: STYLES[i % STYLES.length],
  };
  addSpec(c.spec);
}

const collectionTracks = COLLECTION.map((c) => SPECS.get(String(c.spec.id)).track);

const GAME = {
  state: {
    gems: 178,
    notes: 430,
    collection: Object.fromEntries(collectionTracks.map((t) => [t.id, 1])),
    packsOpened: 487,
    protectArtists: [artistIdOf('Orion')],
  },
  tracks: collectionTracks,
  serverNow: NOW,
};

const STATS = {
  value: COLLECTION.reduce((sum, c) => sum + c.value, 0),
  bonus: 0,
  rank: 19965,
  players: 59105,
  copies: Object.fromEntries(COLLECTION.map((c) => [String(c.spec.id), c.copies])),
  values: Object.fromEntries(COLLECTION.map((c) => [String(c.spec.id), c.value])),
  locks: Object.fromEntries(COLLECTION.filter((c) => c.locked).map((c) => [String(c.spec.id), c.locked.length])),
  lockedSerials: Object.fromEntries(COLLECTION.filter((c) => c.locked).map((c) => [String(c.spec.id), c.locked])),
};

// ---------------------------------------------------------------- Face to Face

const FACEOFF_DECK = ['7010', '7011', '7012', '7013', '7014']; // 5 Populaires : deck moyen, 10 points
const FACEOFF = {
  deck: FACEOFF_DECK,
  waitingSince: null,
  game: null,
  gemsToday: 10,
  gemsMax: 360,
  serverNow: NOW,
  board: { top: [], me: null, streak: 0 },
  tracks: FACEOFF_DECK.map((id) => SPECS.get(id).track),
};

// ---------------------------------------------------------------- Enchères

const auctionable = [...SPECS.values()].filter((s) => ['or', 'platine', 'diamant'].includes(s.track.rarity) && Number(s.track.id) < 7000);
const AUCTION_PLAN = [
  [6, 0.42], [18, 0.4], [35, 0.62], [50, 0.9], [75, 0.5], [110, 0.8], [200, 0.4], [400, 0.45], [25, 0.55], [90, 0.6],
];
const AUCTIONS = {
  open: AUCTION_PLAN.map(([mins, ratio], i) => {
    const s = auctionable[(i * 3) % auctionable.length];
    const bid = Math.round(s.quote * ratio);
    return {
      id: 35000 + i,
      track: s.track,
      serial: 100 + i * 57,
      seller: `Joueur${i + 1}`,
      start: Math.round(s.quote * 0.35),
      max: s.quote * 2,
      bid,
      next: bid + Math.max(10, Math.round(s.quote * 0.04)),
      leader: `Rival${i + 1}`,
      bids: 1 + (i % 5),
      endsAt: NOW + mins * MIN,
      quote: s.quote,
      mine: false,
      leading: false,
      passed: false,
    };
  }),
  mine: [],
  locked: 0,
  serverNow: NOW,
};

// ---------------------------------------------------------------- Routes

function marketItem(spec) {
  const best = Math.min(...spec.listings.map((l) => l.price));
  return { track: spec.track, best, listings: spec.listings.length, quote: spec.quote, trend: 0 };
}

function marketList(params) {
  const rarity = params.get('rarity');
  const max = Number(params.get('max')) || Infinity;
  const count = Number(params.get('count')) || 90;
  let items = [...SPECS.values()]
    .filter((s) => s.listings.length && (!rarity || s.track.rarity === rarity))
    .map(marketItem)
    .filter((it) => it.best <= max);
  items.sort(params.get('sort') === 'price' ? (a, b) => a.best - b.best : (a, b) => Number(b.track.id) - Number(a.track.id));
  const mineTrackIds = new Set(MY_LISTINGS.map((l) => l.trackId));
  return {
    items: items.slice(0, count),
    total: items.length,
    mine: { listings: MY_LISTINGS, tracks: [...SPECS.values()].filter((s) => mineTrackIds.has(s.track.id)).map((s) => s.track) },
    bought: { purchases: [], tracks: [] },
    sales: [],
    bigSales: [],
    wanted: [],
  };
}

function detail(id) {
  const s = SPECS.get(id);
  if (!s) return null;
  return {
    track: s.track,
    quote: s.quote,
    trend: 0,
    range: allowedRange(s.quote, s.track.rarity),
    listings: [...s.listings].sort((a, b) => a.price - b.price),
    history: s.history,
    myOpen: MY_LISTINGS.filter((l) => l.status === 'open').length,
    auctions: [],
  };
}

/** Réponse de démonstration pour un chemin d'API, ou null si la route est inconnue. */
export function respond(path) {
  const url = new URL(path, 'https://waxtcg.com');
  const p = url.pathname;
  if (p === '/api/game') return GAME;
  if (p === '/api/stats') return STATS;
  if (p === '/api/auctions') return AUCTIONS;
  if (p === '/api/faceoff') return FACEOFF;
  if (p === '/api/market') return marketList(url.searchParams);
  const m = p.match(/^\/api\/market\/(\d+)$/);
  if (m) return detail(m[1]);
  return null;
}
