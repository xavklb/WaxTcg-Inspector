// Face to Face : estimation des notes de chaque carte et recherche du meilleur deck.
//
// Le serveur ne donne les vraies notes que pendant une partie. On les estime ici à partir
// des données des cartes, en percentile (0–100) dans ta collection :
//   Écoutes = popularité Deezer (rank)          Underground = l'inverse
//   Fans    = titre le plus populaire de l'artiste dans ta collection (approximation)
//   Cote    = valeur de la carte (/api/stats)    La plus rare = rareté, puis valeur
//   Classique / Fraîcheur = année (ancienne / récente)
//   Le plus long / Le plus court = durée
// Chaque partie tire un thème parmi 11 : une carte du thème prend +15. On ajoute donc
// à toutes ses notes le bonus moyen attendu : 15 × (nombre de thèmes de la carte) / 11.
import { FACEOFF, RARITIES } from './constants.js';

const CRITERIA = FACEOFF.criteria.map((c) => c.key);
const N_THEMES = Object.keys(FACEOFF.themes).length;

function combinations(items, k) {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  return [...combinations(rest, k - 1).map((c) => [first, ...c]), ...combinations(rest, k)];
}

function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
}

// Les 126 tirages possibles de 5 critères parmi 9, et les 120 façons d'y affecter 5 cartes.
const SUBSETS = combinations([...CRITERIA.keys()], FACEOFF.rounds);
const PERMS = permutations([...Array(FACEOFF.rounds).keys()]);

/** Thèmes de partie auxquels une carte appartient. */
export function themesOf(track) {
  const out = [];
  const year = Number(track?.year);
  if (year > 0) out.push(year < 2000 ? 'vintage' : year < 2010 ? 'y2000' : year < 2020 ? 'y2010' : 'recent');
  if (track?.region === 'fr') out.push('fr');
  else if (track?.region) out.push('abroad');
  const style = String(track?.style ?? '').toLowerCase();
  if (style.includes('rap')) out.push('rap');
  if (style.includes('pop')) out.push('pop');
  if (style.includes('rock') || style.includes('alt')) out.push('rock');
  if (style.includes('electro') || style.includes('dance') || style.includes('house')) out.push('electro');
  if (/\b(feat\.?|ft\.|featuring)\s/i.test(track?.title ?? '')) out.push('feat');
  return out;
}

/** Percentile (0–100) de chaque valeur ; les ex æquo partagent le même rang, une valeur absente vaut 50. */
export function percentiles(values) {
  const out = new Array(values.length).fill(50);
  const known = values.map((v, i) => [v, i]).filter(([v]) => Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
  const n = known.length;
  if (n <= 1) return out;
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && known[j + 1][0] === known[i][0]) j += 1;
    const p = ((i + j) / 2 / (n - 1)) * 100;
    for (let k = i; k <= j; k += 1) out[known[k][1]] = p;
    i = j + 1;
  }
  return out;
}

/**
 * Cartes jouables avec leurs notes estimées.
 * `values` : valeur de chaque carte (stats.values de /api/stats).
 */
export function buildCards(tracks, { values = {} } = {}) {
  const list = (tracks ?? []).filter((t) => t?.id && FACEOFF.points[t.rarity] != null);
  const artistPower = new Map();
  for (const t of list) artistPower.set(t.artistId, Math.max(artistPower.get(t.artistId) ?? 0, Number(t.rank) || 0));
  const num = (x) => (x == null || x === '' ? NaN : Number(x));
  const value = (t) => num(values[t.id]);
  const raw = {
    plays: list.map((t) => num(t.rank)),
    underground: list.map((t) => -num(t.rank)),
    fans: list.map((t) => artistPower.get(t.artistId)),
    quote: list.map(value),
    classic: list.map((t) => -num(t.year)),
    fresh: list.map((t) => num(t.year)),
    long: list.map((t) => num(t.duration)),
    short: list.map((t) => -num(t.duration)),
    rare: list.map((t) => RARITIES.indexOf(t.rarity) + Math.min(0.99, (value(t) || 0) / 1e7)),
  };
  const pct = Object.fromEntries(CRITERIA.map((c) => [c, percentiles(raw[c])]));
  return list.map((track, i) => {
    const themes = themesOf(track);
    const bonus = (FACEOFF.themeBonus * themes.length) / N_THEMES;
    const notes = Object.fromEntries(CRITERIA.map((c) => [c, Math.round(pct[c][i])]));
    return {
      id: String(track.id),
      track,
      points: FACEOFF.points[track.rarity],
      themes,
      bonus,
      notes,
      adj: CRITERIA.map((c) => pct[c][i] + bonus),
    };
  });
}

function bestMatchPartial(rows, crit) {
  let best = 0;
  const used = new Array(crit.length).fill(false);
  const dfs = (r, sum) => {
    if (r === rows.length) {
      if (sum > best) best = sum;
      return;
    }
    for (let j = 0; j < crit.length; j += 1) {
      if (used[j]) continue;
      used[j] = true;
      dfs(r + 1, sum + rows[r][crit[j]]);
      used[j] = false;
    }
  };
  dfs(0, 0);
  return best;
}

/**
 * Force d'un deck : note moyenne par manche, en moyenne sur tous les tirages de 5 critères,
 * chaque carte n'étant jouée qu'une fois (meilleure affectation des cartes aux critères).
 */
export function deckStrength(cards) {
  if (!cards?.length) return 0;
  const rows = cards.map((c) => c.adj);
  let total = 0;
  if (rows.length === FACEOFF.rounds) {
    const [r0, r1, r2, r3, r4] = rows;
    for (const s of SUBSETS) {
      let best = 0;
      for (const p of PERMS) {
        const v = r0[s[p[0]]] + r1[s[p[1]]] + r2[s[p[2]]] + r3[s[p[3]]] + r4[s[p[4]]];
        if (v > best) best = v;
      }
      total += best;
    }
  } else {
    for (const s of SUBSETS) total += bestMatchPartial(rows, s);
  }
  return total / SUBSETS.length / FACEOFF.rounds;
}

export const deckPoints = (cards) => cards.reduce((sum, c) => sum + c.points, 0);

/** Respecte les règles : 5 cartes différentes, 20 points au plus, 2 cartes par artiste au plus. */
export function isValidDeck(cards) {
  if (cards.length !== FACEOFF.deckSize) return false;
  if (new Set(cards.map((c) => c.id)).size !== cards.length) return false;
  if (deckPoints(cards) > FACEOFF.maxPoints) return false;
  const perArtist = new Map();
  for (const c of cards) {
    const n = (perArtist.get(c.track.artistId) ?? 0) + 1;
    if (n > FACEOFF.maxPerArtist) return false;
    perArtist.set(c.track.artistId, n);
  }
  return true;
}

function canAdd(partial, card, minCost) {
  if (partial.some((c) => c.id === card.id)) return false;
  if (partial.filter((c) => c.track.artistId === card.track.artistId).length >= FACEOFF.maxPerArtist) return false;
  const slotsLeft = FACEOFF.deckSize - partial.length - 1;
  return deckPoints(partial) + card.points + slotsLeft * minCost <= FACEOFF.maxPoints;
}

function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Cartes à considérer : les meilleures sur chaque critère, en tenant compte du coût en points. */
function candidatePool(cards, current, perCriterion) {
  const pool = new Map(current.map((c) => [c.id, c]));
  CRITERIA.forEach((_, j) => {
    // Deux classements par critère : la note brute, et la note par point de deck.
    const byNote = [...cards].sort((a, b) => b.adj[j] - a.adj[j]);
    const byValue = [...cards].sort((a, b) => b.adj[j] / b.points - a.adj[j] / a.points);
    for (const c of [...byNote.slice(0, perCriterion), ...byValue.slice(0, perCriterion)]) pool.set(c.id, c);
  });
  return [...pool.values()];
}

/**
 * Cherche le deck le plus fort : départ glouton, deck actuel et départs aléatoires,
 * puis échanges carte par carte tant que la force augmente.
 */
export function findBestDeck(cards, { current = [], restarts = 4, perCriterion = 4, seed = 7 } = {}) {
  if (cards.length < FACEOFF.deckSize) return null;
  const pool = candidatePool(cards, current, perCriterion);
  const minCost = Math.min(...pool.map((c) => c.points));
  const cache = new Map();
  const strength = (deck) => {
    const key = deck.map((c) => c.id).sort().join(',');
    if (!cache.has(key)) cache.set(key, deckStrength(deck));
    return cache.get(key);
  };

  const starts = [];
  const greedy = [];
  while (greedy.length < FACEOFF.deckSize) {
    let pick = null;
    let pickScore = -1;
    for (const c of pool) {
      if (!canAdd(greedy, c, minCost)) continue;
      const s = deckStrength([...greedy, c]);
      if (s > pickScore) {
        pick = c;
        pickScore = s;
      }
    }
    if (!pick) break;
    greedy.push(pick);
  }
  if (isValidDeck(greedy)) starts.push(greedy);
  if (isValidDeck(current)) starts.push([...current]);
  const rand = rng(seed);
  for (let r = 0; r < restarts; r += 1) {
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const deck = [];
    for (const c of shuffled) if (deck.length < FACEOFF.deckSize && canAdd(deck, c, minCost)) deck.push(c);
    if (isValidDeck(deck)) starts.push(deck);
  }
  if (!starts.length) return null;

  let best = null;
  let bestScore = -1;
  for (const start of starts) {
    let deck = start;
    let score = strength(deck);
    for (let iter = 0; iter < 25; iter += 1) {
      let move = null;
      let moveScore = score;
      for (let i = 0; i < deck.length; i += 1) {
        for (const c of pool) {
          if (deck.some((d) => d.id === c.id)) continue;
          const next = deck.map((d, k) => (k === i ? c : d));
          if (!isValidDeck(next)) continue;
          const s = strength(next);
          if (s > moveScore + 1e-9) {
            move = next;
            moveScore = s;
          }
        }
      }
      if (!move) break;
      deck = move;
      score = moveScore;
    }
    if (score > bestScore) {
      best = deck;
      bestScore = score;
    }
  }
  return { cards: best, strength: bestScore, points: deckPoints(best) };
}

/**
 * Antisèche : pour chaque critère, les cartes du deck de la meilleure à la moins bonne,
 * sur la note brute (en partie, le thème est connu : la carte concernée prend +15).
 */
export function cheatSheet(deck) {
  return FACEOFF.criteria.map((crit) => ({
    criterion: crit.key,
    label: crit.label,
    picks: deck
      .map((card) => ({ id: card.id, title: card.track.title, note: card.notes[crit.key], themes: card.themes }))
      .sort((a, b) => b.note - a.note),
  }));
}

/** Les critères où une carte est la plus forte. */
export function strengths(card, n = 3) {
  return FACEOFF.criteria
    .map((crit) => ({ key: crit.key, label: crit.label, note: card.notes[crit.key] }))
    .sort((a, b) => b.note - a.note)
    .slice(0, n);
}
