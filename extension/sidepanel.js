import { WaxApi } from './lib/api.js';
import { runAuctions, runBuy, runDeck, runSell, runSnep } from './lib/runs.js';
import { strengths } from './lib/deck.js';
import {
  ANNOUNCE_PLACEHOLDERS,
  CHAT_MAX_LENGTH,
  DEFAULT_ANNOUNCE,
  MAX_ANNOUNCE_COUNT,
  formatAnnouncement,
  normalizeAnnounce,
} from './lib/announce.js';
import { DEFAULT_SETTINGS, FACEOFF, MIN_DELAY_MS, RARITY, normalizeSettings } from './lib/constants.js';
import { ago, compact, duration, fmt, mmss, pct } from './lib/format.js';

const DAY = 86_400_000;
const app = document.getElementById('app');
const api = new WaxApi();

const state = {
  tab: 'buy',
  settings: { ...DEFAULT_SETTINGS },
  announce: { ...DEFAULT_ANNOUNCE },
  results: {},
  running: null,
  progress: '',
  error: null,
  requests: 0,
};

// ------------------------------------------------------------------ stockage

const store = {
  async get(key) {
    try {
      return (await chrome.storage.local.get(key))[key];
    } catch {
      return undefined;
    }
  },
  async set(key, value) {
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch {
      // stockage indisponible : on garde l'état en mémoire
    }
  },
};

// ------------------------------------------------------------------ DOM

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const notes = (n) => `${fmt(n)} ♫`;

function row(k, ...v) {
  return h('div', { class: 'row' }, h('span', { class: 'k' }, k), h('span', { class: 'v num' }, v.filter(Boolean).join(' · ')));
}

function meta(items) {
  return h('div', { class: 'meta num' }, items.filter(Boolean).map((t) => h('span', null, t)));
}

function profitLine(profit, roi) {
  return h('div', { class: `profit num${profit < 0 ? ' neg' : ''}` }, `${profit >= 0 ? '+' : ''}${notes(profit)} net (${pct(roi)})`);
}

function salesMeta(stats) {
  const liq = stats.count7d ? `${stats.count7d} vente${stats.count7d > 1 ? 's' : ''} / 7 j` : 'aucune vente / 7 j';
  return [liq, stats.lastAt ? `dernière ${ago(stats.lastAt)}` : null];
}

async function openCard(id) {
  try {
    await api.openCard(id);
  } catch (e) {
    state.error = e?.message ?? String(e);
    render();
  }
}

function card(track, body, badges = []) {
  const rar = RARITY[track?.rarity] ?? { label: track?.rarity ?? '?', color: '#888' };
  return h(
    'article',
    { class: 'card', style: { '--rc': rar.color } },
    h(
      'header',
      { class: 'card-head' },
      h('span', { class: 'chip' }, rar.label),
      h('div', { class: 'titles' }, h('strong', { title: track?.title }, track?.title ?? '?'), h('span', { class: 'artist' }, track?.artist ?? '')),
      h('button', { class: 'btn small', title: 'Ouvrir la fiche de la carte sur WAX', onclick: () => openCard(track.id) }, 'Ouvrir'),
    ),
    badges.length ? h('div', { class: 'meta' }, badges) : null,
    body,
  );
}

const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);

// ------------------------------------------------------------------ vues

function flipCard(r) {
  return card(r.track, [
    row('Acheter', notes(r.buy.price), r.buy.serial ? `n°${r.buy.serial}` : null),
    row('Prix d’achat max', notes(r.maxBuy)),
    row('Revendre à', `~${notes(r.resale)}`, `tu touches ${notes(r.net)}`),
    profitLine(r.profit, r.roi),
    meta([
      ...salesMeta(r.stats),
      r.daysToSell != null ? `revente ~${duration(r.daysToSell * DAY)}` : 'revente incertaine',
      `cote ${fmt(r.quote)}`,
      `${r.competitors} en vente`,
    ]),
    r.reasons.length ? h('p', { class: 'reasons' }, r.reasons.join(' · ')) : null,
  ]);
}

function renderBuy(res) {
  const good = res.results.filter((r) => r.ok);
  const rest = res.results.filter((r) => !r.ok);
  return [
    h('p', { class: 'summary num' }, [
      `Budget ${notes(res.budget)}`,
      `${fmt(res.scanned)} titres lus`,
      `${fmt(res.screened)} pistes`,
      `${res.checked} vérifiées`,
    ].map((t) => h('span', null, t))),
    good.length ? good.map(flipCard) : h('p', { class: 'empty' }, 'Aucune bonne affaire avec tes réglages pour l’instant.'),
    rest.length ? h('details', { class: 'rejected' }, h('summary', null, `Écartées après vérification (${rest.length})`), rest.map(flipCard)) : null,
  ];
}

function auctionCard(r) {
  const a = r.auction;
  return card(
    r.track,
    [
      row('Enchère actuelle', notes(a.bid ?? a.start), `${a.bids ?? 0} mise${(a.bids ?? 0) > 1 ? 's' : ''}`),
      row('Prochaine mise', notes(r.price)),
      row('Mise max conseillée', notes(r.maxBid)),
      row('Revendre à', `~${notes(r.resale)}`, `tu touches ${notes(r.net)}`),
      profitLine(r.profit, r.roi),
      meta([...salesMeta(r.stats), `cote ${fmt(r.quote)}`, `achat immédiat ${fmt(a.max)}`]),
      r.reasons.length ? h('p', { class: 'reasons' }, r.reasons.join(' · ')) : null,
    ],
    [badge(`fin dans ${duration(r.endsInMs)}`, r.endsInMs < 15 * 60_000 ? 'warn' : ''), a.serial ? badge(`n°${a.serial}`) : null].filter(Boolean),
  );
}

function renderAuctions(res) {
  const good = res.results.filter((r) => r.ok);
  const rest = res.results.filter((r) => !r.ok);
  return [
    h('p', { class: 'summary num' }, [`Budget ${notes(res.budget)}`, `${res.open} enchères ouvertes`, `${res.screened} pistes`, `${res.checked} vérifiées`].map((t) => h('span', null, t))),
    good.length ? good.map(auctionCard) : h('p', { class: 'empty' }, 'Aucune enchère intéressante dans la fenêtre choisie.'),
    rest.length ? h('details', { class: 'rejected' }, h('summary', null, `Écartées après vérification (${rest.length})`), rest.map(auctionCard)) : null,
  ];
}

function listingCard(r) {
  const l = r.listing;
  let advice;
  if (r.status === 'undercut') {
    advice = r.cantBeat
      ? `Un autre vendeur est à ${notes(r.cheapestOther)}, déjà au prix plancher : impossible de passer devant. Attends ou garde-la.`
      : `Un autre vendeur est à ${notes(r.cheapestOther)}. Retire-la et remets-la à ${notes(r.suggested)} (tu toucheras ${notes(r.suggestedNet)}).`;
  } else if (r.status === 'low') {
    advice = `Les dernières ventes sont autour de ${notes(r.stats.recentMedian)}. Tu peux la remettre à ${notes(r.suggested)} (tu toucheras ${notes(r.suggestedNet)}).`;
  } else {
    advice = 'Bien placée : c’est la moins chère, au niveau des ventes récentes.';
  }
  const status = { undercut: badge('Dépassée', 'bad'), low: badge('Prix bas', 'warn'), ok: badge('OK', 'good') }[r.status];
  return card(
    r.track,
    [
      row('Mon prix', notes(l.price), `je touche ${notes(r.net)}`),
      meta([...salesMeta(r.stats), `cote ${fmt(r.quote)}`, `${r.competitors} autre${r.competitors > 1 ? 's' : ''} en vente`]),
      h('p', { class: 'advice' }, advice),
    ],
    [status, r.expiringSoon ? badge(`expire dans ${duration(r.hoursLeft * 3_600_000)}`, 'warn') : null].filter(Boolean),
  );
}

function saleCard(r) {
  const verdicts = {
    recycle: [badge('Recycler', 'warn'), `La vente rapporterait moins que le recyclage (${notes(r.recycle)}).`],
    illiquid: [badge('Peu demandée', 'warn'), 'Aucune vente sur 7 jours : mets-la au prix cote et sois patient.'],
    'sell-fast': [badge('Vendre vite', 'bad'), `Les prix baissent (${pct(r.stats.momentum)} sur les dernières ventes) : vends au prix rapide.`],
    sell: [badge('Vendre', 'good'), 'Prix rapide pour partir vite, prix cote pour gagner plus.'],
  };
  const [verdictBadge, advice] = verdicts[r.verdict];
  const otherFavorites = (r.favoriteSerials ?? []).filter((s) => s !== r.sellSerial);
  const badges = [
    verdictBadge,
    r.sellIsFavorite ? badge('❤ Coup de cœur', 'bad') : null,
    r.protectedArtist ? badge('🛡 Artiste protégé', 'bad') : null,
    r.duplicates > 0 ? badge(`doublon ×${r.duplicates}`) : badge(`hype ×${r.ratio.toFixed(1)}`),
    badge(`vends le n°${r.sellSerial}`),
    !r.sellIsFavorite && otherFavorites.length ? badge(`❤ n°${otherFavorites.join(', ')} en coup de cœur`) : null,
    r.upgradedFrom ? badge(`montée (tirée en ${RARITY[r.upgradedFrom]?.label ?? r.upgradedFrom})`, 'good') : null,
  ].filter(Boolean);
  return card(
    r.track,
    [
      row('Prix rapide', notes(r.fastPrice), `tu touches ${notes(r.fastNet)}`),
      row('Prix cote', notes(r.fairPrice), `tu touches ${notes(r.fairNet)}`),
      meta([
        ...salesMeta(r.stats),
        r.cheapestOther != null ? `moins cher en vente ${fmt(r.cheapestOther)}` : 'personne d’autre en vente',
        r.duplicates > 0 ? `recyclage ${fmt(r.recycle)}` : null,
      ]),
      h('p', { class: 'advice' }, advice),
      r.sellIsFavorite
        ? h('p', { class: 'reasons' }, `Le n°${r.sellSerial} est en coup de cœur : retire le cœur sur la carte avant de la mettre en vente.`)
        : null,
      r.protectedArtist ? h('p', { class: 'reasons' }, `Tu as protégé ${r.track.artist || 'cet artiste'} : vérifie que tu veux vraiment vendre.`) : null,
      r.lastCopy ? h('p', { class: 'reasons' }, `Dernier exemplaire : ta valeur de collection baissera d’environ ${notes(r.value)}.`) : null,
    ],
    badges,
  );
}

function demandCard(r) {
  const plural = (n, one, many) => (n > 1 ? many : one);
  const advice =
    r.verdict === 'no-seller'
      ? `Personne n’en vend : mets-la à ${notes(r.price)} (${r.premium === 2 ? 'le maximum autorisé, 2× la cote' : `${String(r.premium).replace('.', ',')}× la cote`}), tu toucheras ${notes(r.net)}.`
      : `${r.competitors} autre${plural(r.competitors, '', 's')} en vente dès ${notes(r.cheapestOther)} : passe juste devant à ${notes(r.price)} (tu toucheras ${notes(r.net)}).`;
  const badges = [
    r.verdict === 'no-seller' ? badge('Personne n’en vend', 'good') : badge('Demandée', 'good'),
    r.sellIsFavorite ? badge('❤ Coup de cœur', 'bad') : null,
    r.protectedArtist ? badge('🛡 Artiste protégé', 'bad') : null,
    badge(`vends le n°${r.sellSerial}`),
    r.owned > 1 ? badge(`${r.owned} exemplaires`) : null,
    !r.sellIsFavorite && r.favoriteSerials?.length ? badge(`❤ n°${r.favoriteSerials.join(', ')} en coup de cœur`) : null,
  ].filter(Boolean);
  return card(
    r.track,
    [
      row('Prix conseillé', notes(r.price), `tu touches ${notes(r.net)}`),
      row('Prix cote', notes(r.fairPrice), `tu touches ${notes(r.fairNet)}`),
      meta([
        r.wishes ? `${fmt(r.wishes)} joueur${plural(r.wishes, '', 's')} la souhaite${plural(r.wishes, '', 'nt')}` : null,
        r.requests ? `${r.requests} annonce${plural(r.requests, '', 's')} « Cherche »` : null,
        ...salesMeta(r.stats),
      ]),
      r.posts.slice(0, 3).map((p) =>
        h('p', { class: 'quote-post' }, h('b', null, p.who || 'Un joueur'), ' cherche cette carte', p.at ? ` (${ago(p.at)})` : '', p.note ? ` : « ${p.note} »` : ''),
      ),
      h('p', { class: 'advice' }, advice, r.requests ? ` Tu peux aussi ${r.requests > 1 ? 'leur' : 'lui'} proposer un échange depuis WAX FM.` : ''),
      r.sellIsFavorite ? h('p', { class: 'reasons' }, `Le n°${r.sellSerial} est en coup de cœur : retire le cœur avant de la vendre.`) : null,
      r.protectedArtist ? h('p', { class: 'reasons' }, `Tu as protégé ${r.track.artist || 'cet artiste'} : vérifie que tu veux vraiment vendre.`) : null,
      r.lastCopy ? h('p', { class: 'reasons' }, `Dernier exemplaire : ta valeur de collection baissera d’environ ${notes(r.value ?? r.quote)}.`) : null,
    ],
    badges,
  );
}

function demandSection(res) {
  if (!res.demand) return null; // analyse enregistrée avant l'ajout de cette section
  const others = res.demandOthers ?? [];
  return [
    h('h2', { class: 'section' }, `Cartes demandées que tu as (${res.demand.length}${res.demandCount > res.demand.length ? ` sur ${res.demandCount}` : ''})`),
    res.demand.length
      ? res.demand.map(demandCard)
      : h('p', { class: 'empty' }, `Aucune de tes cartes n’est parmi les plus souhaitées ni cherchée sur WAX FM en ce moment (${res.wantPosts ?? 0} annonces « Cherche » lues).`),
    others.length
      ? h(
          'details',
          { class: 'rejected' },
          h('summary', null, `Les plus souhaitées du Marché, que tu n’as pas (${others.length})`),
          h(
            'div',
            { class: 'sheet' },
            others.map((o) =>
              h(
                'div',
                { class: 'row' },
                h('span', { class: 'k' }, `${o.track.title} – ${o.track.artist}`),
                h('span', { class: 'v num' }, `${fmt(o.wishes)} souhaits · ${o.marketBest != null ? `dès ${notes(o.marketBest)}` : 'aucune en vente'}`),
              ),
            ),
          ),
        )
      : null,
  ];
}

async function copyText(text, textarea) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      textarea.select();
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

/** Annonce de mes ventes à copier dans le chat du label (jamais envoyée par l'extension). */
function announcePanel(res) {
  const listings = res.listings.map((r) => ({
    title: r.track?.title,
    artist: r.track?.artist,
    price: r.listing?.price,
    rarity: r.track?.rarity,
    serial: r.serial ?? null,
  }));
  if (!listings.length) return null;
  const max = Math.min(MAX_ANNOUNCE_COUNT, listings.length);
  const count = () => Math.min(state.announce.count, max);

  const output = h('textarea', { class: 'announce-text', readonly: true, rows: 4, 'aria-label': 'Annonce à copier' });
  const info = h('span', { class: 'progress num' });
  const copied = h('span', { class: 'progress' });
  const update = () => {
    const a = formatAnnouncement(listings, { ...state.announce, count: count() });
    output.value = a.text;
    const dropped = a.requested - a.included;
    info.textContent = `${a.length}/${CHAT_MAX_LENGTH} signes${dropped > 0 ? ` · ${dropped} titre${dropped > 1 ? 's' : ''} retiré${dropped > 1 ? 's' : ''} pour tenir` : ''}`;
    copied.textContent = '';
  };
  const save = () => {
    store.set('announce', state.announce);
    update();
  };

  const select = h(
    'select',
    {
      'aria-label': 'Nombre de titres dans l’annonce',
      onchange: (e) => {
        state.announce.count = Number(e.target.value);
        save();
      },
    },
    Array.from({ length: max }, (_, i) => i + 1).map((n) => h('option', { value: n, selected: n === count() }, `${n} titre${n > 1 ? 's' : ''}`)),
  );
  const upper = h('input', {
    type: 'checkbox',
    id: 'announce-upper',
    checked: state.announce.uppercase,
    onchange: (e) => {
      state.announce.uppercase = e.target.checked;
      save();
    },
  });
  const copyBtn = h(
    'button',
    {
      class: 'btn primary small',
      type: 'button',
      onclick: async () => {
        copied.textContent = (await copyText(output.value, output)) ? 'Copié !' : 'Copie impossible : sélectionne le texte.';
      },
    },
    'Copier',
  );
  update();

  return h(
    'section',
    { class: 'announce' },
    h('h2', { class: 'section' }, 'Annonce pour le chat du label'),
    h('div', { class: 'announce-controls' }, select, h('label', { class: 'check', for: 'announce-upper' }, upper, 'Titre et artiste en majuscules')),
    output,
    h('div', { class: 'actions' }, copyBtn, info, copied),
    h(
      'p',
      { class: 'note' },
      'L’extension n’envoie rien : colle l’annonce dans Social → Discussion du label et envoie-la toi-même. Le format se règle dans Réglages.',
    ),
  );
}

function renderSell(res) {
  return [
    h('p', { class: 'summary num' }, [
      `Annonces ${res.openCount}/${res.maxOpen}`,
      res.collectionValue != null ? `Collection ${fmt(res.collectionValue)}` : null,
      res.rank != null ? `Rang ${fmt(res.rank)} / ${fmt(res.players)}` : null,
    ].filter(Boolean).map((t) => h('span', null, t))),
    demandSection(res),
    h('h2', { class: 'section' }, `Mes annonces (${res.listings.length})`),
    res.listings.length ? res.listings.map(listingCard) : h('p', { class: 'empty' }, 'Aucune annonce en cours.'),
    announcePanel(res),
    h('h2', { class: 'section' }, `À mettre en vente (${res.sales.length}${res.candidates > res.checked ? ` sur ${res.candidates}` : ''})`),
    res.sales.length
      ? res.sales.map(saleCard)
      : h('p', { class: 'empty' }, 'Ni doublon, ni carte en pleine hype dans ta collection.'),
  ];
}

/** Donnée qui décide d'une question : « 8,2 M fans », « 1994 », « 3:25 », « 861 ♫ », « Diamant ». */
function factText(fact) {
  if (!fact) return null;
  switch (fact.kind) {
    case 'fans':
      return `${compact(fact.value)} fans`;
    case 'notes':
      return notes(fact.value);
    case 'year':
      return String(fact.value);
    case 'duration':
      return mmss(fact.value);
    case 'rarity':
      return RARITY[fact.value]?.label ?? fact.value;
    default:
      return null;
  }
}

function deckCard(c) {
  const f = c.facts ?? {};
  return card(
    c.track,
    [
      meta(strengths(c).map((s) => `${s.label} ${s.note}`)),
      meta([
        Number.isFinite(f.fans) ? `${compact(f.fans)} fans` : null,
        Number.isFinite(f.year) && f.year > 0 ? String(f.year) : null,
        Number.isFinite(f.duration) ? mmss(f.duration) : null,
        Number.isFinite(f.quote) ? notes(f.quote) : null,
      ]),
      c.themes.length ? meta([`Thèmes : ${c.themes.map((t) => FACEOFF.themes[t] ?? t).join(', ')}`]) : null,
    ],
    [badge(`${c.points} pt${c.points > 1 ? 's' : ''}`)],
  );
}

function sheetView(sheet) {
  return h(
    'div',
    { class: 'sheet' },
    sheet.map((s) => {
      const [first, second] = s.picks;
      const fact = factText(first.fact);
      return h(
        'div',
        { class: 'sheet-item' },
        h('div', { class: 'sheet-q' }, h('b', null, s.label), s.question ? h('span', { class: 'muted' }, ` · ${s.question}`) : null),
        h(
          'div',
          { class: 'sheet-a' },
          '▸ ',
          h('strong', null, first.title),
          h('span', { class: 'num' }, ` ${first.note}`),
          fact ? h('span', { class: 'muted num' }, ` · ${fact}`) : null,
          second ? h('span', { class: 'muted' }, ` · puis ${second.title}`) : null,
        ),
      );
    }),
  );
}

const sameDeck = (a, b) => a.map((c) => c.id).sort().join() === b.map((c) => c.id).sort().join();

function renderDeck(res) {
  const max = FACEOFF.maxPoints;
  if (!res.best) {
    return h('p', { class: 'empty' }, 'Impossible de composer un deck valide avec ta collection (5 cartes, 20 points, 2 par artiste).');
  }
  const cur = res.current;
  const same = cur && sameDeck(cur.cards, res.best.cards);
  const diff = cur ? res.best.strength - cur.strength : null;
  return [
    h('p', { class: 'summary num' }, [
      res.gemsToday != null ? `Gemmes du jour ${fmt(res.gemsToday)}/${fmt(res.gemsMax)}` : null,
      `${fmt(res.collection)} cartes évaluées`,
    ].filter(Boolean).map((t) => h('span', null, t))),
    h('h2', { class: 'section' }, `Deck conseillé · ${res.best.points}/${max} pts`),
    h(
      'div',
      { class: 'profit num' },
      `Force estimée ${fmt(res.best.strength)}`,
      cur && !same ? h('span', { class: 'muted' }, ` · ton deck ${fmt(cur.strength)} (${diff >= 0 ? '+' : ''}${fmt(diff)})`) : null,
    ),
    h(
      'p',
      { class: 'advice' },
      same ? 'C’est déjà ton deck actuel : rien à changer.' : 'Pour l’appliquer : Face to Face → Modifier le deck, puis Valider le deck.',
    ),
    res.best.cards.map(deckCard),
    h('h2', { class: 'section' }, 'Quelle carte poser selon le critère'),
    sheetView(res.best.sheet),
    h('p', { class: 'note' }, 'En partie, une carte du thème tiré prend +15 : à note proche, pose plutôt celle-là.'),
    cur && !same
      ? h(
          'details',
          { class: 'rejected' },
          h('summary', null, `Ton deck actuel · ${cur.points}/${max} pts · antisèche`),
          sheetView(cur.sheet),
          cur.cards.map(deckCard),
        )
      : null,
    res.missingFromDeck > 0
      ? h('p', { class: 'reasons' }, `${res.missingFromDeck} carte${res.missingFromDeck > 1 ? 's' : ''} de ton deck actuel ne ${res.missingFromDeck > 1 ? 'sont' : 'est'} plus dans ta collection.`)
      : null,
    h(
      'p',
      { class: 'note' },
      'Force = note moyenne attendue par manche, bonus de thème moyen compris. Chaque note (0 à 100) compare tes cartes entre elles sur la donnée de la question : ' +
        'popularité Deezer du son, fans de l’artiste, cote, année, durée, rareté. ',
      res.fansSource === 'approx'
        ? 'Fans approchés par le titre le plus populaire de l’artiste (les vrais chiffres n’ont pas pu être lus). '
        : `Fans réels des artistes, lus ${ago(res.fansAt)} (relus une fois par jour). `,
      'Le jeu calcule les vraies notes de son côté : sers-t’en comme d’un guide.',
    ),
  ];
}

/** Lecture du site public du SNEP (permission d'hôte snepmusique.com, lecture seule). */
async function fetchSnepText(url) {
  if (!String(url).startsWith('https://snepmusique.com/')) throw new Error(`Adresse non autorisée : ${url}`);
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Site du SNEP : erreur ${res.status}`);
  return res.text();
}

const frDay = (iso) => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '');
const frDateTime = (ts) =>
  new Date(ts).toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function upgradeCard(r) {
  const label = (k) => RARITY[k]?.label ?? k;
  return card(
    r.track,
    [
      row('Acheter', r.buy != null ? `dès ${notes(r.buy)}` : 'aucune en vente', r.listings ? `${r.listings} en vente` : null),
      row('Après la montée', r.expected != null ? `≥ ~${notes(r.expected)}` : '—', r.net != null ? `tu touches ${notes(r.net)}` : null),
      r.profit != null ? profitLine(r.profit, r.buy ? r.profit / r.buy : 0) : null,
      meta([
        `certifié ${r.cert.level} (constat du ${frDay(r.cert.certifiedOn)})`,
        r.quote != null ? `cote actuelle ${fmt(r.quote)}` : null,
        `${r.sales7d} vente${r.sales7d > 1 ? 's' : ''} / 7 j`,
      ]),
      r.buy == null ? h('p', { class: 'reasons' }, 'Personne n’en vend pour l’instant : surveille le Marché, ou garde-la si tu l’as déjà.') : null,
      r.buy != null && !r.affordable ? h('p', { class: 'reasons' }, `Au-dessus de ton budget (${notes(r.buy)}).`) : null,
    ],
    [badge(`${label(r.from)} → ${label(r.to)}`, 'good'), r.multiple ? badge(`×${r.multiple.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`) : null].filter(Boolean),
  );
}

function compactList(items) {
  return h(
    'div',
    { class: 'sheet' },
    items.map(([k, v]) => h('div', { class: 'row' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v))),
  );
}

function renderSnep(res) {
  return [
    h('p', { class: 'summary num' }, [
      res.publishedAt ? `SNEP publié ${frDateTime(res.publishedAt)}` : null,
      res.latestCertifiedOn ? `lot du ${frDay(res.latestCertifiedOn)}` : null,
      `${res.batchSize} singles certifiés`,
      `${res.already.length} déjà monté${res.already.length > 1 ? 's' : ''}`,
    ].filter(Boolean).map((t) => h('span', null, t))),
    h('h2', { class: 'section' }, `Pas encore montées dans WAX (${res.pending.length})`),
    res.pending.length
      ? res.pending.map(upgradeCard)
      : h(
          'p',
          { class: 'empty' },
          'Toutes les cartes du dernier lot SNEP sont déjà montées dans WAX. Le prochain lot sort en général le lundi après-midi : relance l’analyse à ce moment-là.',
        ),
    res.already.length
      ? h(
          'details',
          { class: 'rejected' },
          h('summary', null, `Déjà montées dans WAX (${res.already.length})`),
          compactList(res.already.map((a) => [`${a.track.title} – ${a.track.artist}`, RARITY[a.track.rarity]?.label ?? a.track.rarity])),
        )
      : null,
    res.unmatched.length
      ? h(
          'details',
          { class: 'rejected' },
          h('summary', null, `Introuvables dans WAX (${res.unmatched.length})`),
          compactList(res.unmatched.map((c) => [`${c.title} – ${c.artist}`, c.level])),
        )
      : null,
    h(
      'p',
      { class: 'note' },
      'Le SNEP publie ses certifications le lundi après-midi ; WAX les a appliquées de 12 h à 3 jours après (novembre 2026). ' +
        'À la montée, la cote repart du niveau de la nouvelle rareté (×1,6 à ×6 sur les exemples observés). ' +
        '« Après la montée » est une estimation prudente, d’après la formule de cote de départ du jeu.',
    ),
  ];
}

const VIEWS = {
  buy: {
    label: 'Acheter',
    intro: 'Titres en vente sous leur prix de revente réaliste, vérifiés sur les ventes récentes. Tu achètes toi-même sur le site.',
    run: runBuy,
    render: renderBuy,
  },
  auctions: {
    label: 'Enchères',
    intro: 'Enchères (Or et plus) qui se terminent bientôt sous leur valeur de revente, avec ta mise maximale.',
    run: runAuctions,
    render: renderAuctions,
  },
  sell: {
    label: 'Vendre',
    intro: 'Tes cartes que d’autres joueurs cherchent, tes annonces dépassées ou trop basses, puis tes doublons et tes cartes en pleine hype à vendre.',
    run: runSell,
    render: renderSell,
  },
  deck: {
    label: 'Deck',
    intro: 'Face to Face : le deck de 5 cartes qui couvre le mieux les 9 critères (20 points au plus, 2 cartes par artiste), et la carte à poser pour chaque critère.',
    run: runDeck,
    render: renderDeck,
  },
  snep: {
    label: 'SNEP',
    intro: 'Cartes certifiées par le SNEP mais pas encore montées dans WAX. Achète-les avant la montée : leur cote repart alors du niveau de la nouvelle rareté.',
    run: runSnep,
    render: renderSnep,
  },
};

const FIELDS = [
  { key: 'budget', label: 'Budget max (♫)', hint: '0 = toutes tes Mélodies', step: 10 },
  { key: 'minProfit', label: 'Gain net minimum (♫)', step: 5 },
  { key: 'minRoi', label: 'Rendement minimum (%)', step: 1, percent: true },
  { key: 'minSales7d', label: 'Ventes minimum du titre sur 7 jours', hint: 'Évite les cartes qu’on n’arrive pas à revendre', step: 1 },
  { key: 'maxDetails', label: 'Cartes vérifiées par analyse', hint: '1 requête par carte, 50 au plus', step: 1 },
  { key: 'delayMs', label: 'Pause entre deux requêtes (ms)', hint: `${MIN_DELAY_MS} ms au moins`, step: 100 },
  { key: 'hypeRatio', label: 'Seuil « hype » (× cote de base de la rareté)', step: 0.5 },
  { key: 'auctionHorizonMin', label: 'Enchères qui finissent dans (minutes)', step: 5 },
];

function settingsView() {
  const inputs = {};
  const form = h(
    'form',
    {
      class: 'settings',
      onsubmit: async (e) => {
        e.preventDefault();
        const raw = {};
        for (const f of FIELDS) {
          const v = inputs[f.key].value;
          raw[f.key] = f.percent && v !== '' ? Number(v) / 100 : v;
        }
        state.settings = normalizeSettings(raw);
        await store.set('settings', state.settings);
        state.saved = true;
        render();
      },
    },
    FIELDS.map((f) => {
      const value = f.percent ? Math.round(state.settings[f.key] * 100) : state.settings[f.key];
      inputs[f.key] = h('input', { id: `f-${f.key}`, type: 'number', step: f.step, min: 0, value });
      return h('div', { class: 'field' }, h('label', { for: `f-${f.key}` }, f.label), f.hint ? h('span', { class: 'hint' }, f.hint) : null, inputs[f.key]);
    }),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Enregistrer'),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            state.settings = { ...DEFAULT_SETTINGS };
            await store.set('settings', state.settings);
            render();
          },
        },
        'Valeurs par défaut',
      ),
      state.saved ? h('span', { class: 'progress' }, 'Enregistré.') : null,
    ),
  );
  state.saved = false;
  return [form, announceSettingsView()];
}

const ANNOUNCE_FIELDS = [
  { key: 'header', label: 'Format du message', hint: `Champs : ${ANNOUNCE_PLACEHOLDERS.header.join(' ')}` },
  { key: 'item', label: 'Format d’un titre', hint: `Champs : ${ANNOUNCE_PLACEHOLDERS.item.join(' ')}` },
  { key: 'separator', label: 'Séparateur entre les titres' },
];

const ANNOUNCE_SAMPLE = [
  { title: 'Dernier métro', artist: 'Kalia', price: 980, rarity: 'or', serial: 412 },
  { title: 'Sans filtre', artist: 'Vega', price: 305, rarity: 'hit', serial: 1288 },
];

function announceSettingsView() {
  const inputs = {};
  const preview = h('p', { class: 'note' });
  const draft = () => normalizeAnnounce({ ...state.announce, ...Object.fromEntries(ANNOUNCE_FIELDS.map((f) => [f.key, inputs[f.key].value])) });
  const refresh = () => {
    const a = formatAnnouncement(ANNOUNCE_SAMPLE, { ...draft(), count: 2 });
    preview.textContent = `Exemple (${a.length}/${CHAT_MAX_LENGTH}) : ${a.text}`;
  };
  const form = h(
    'form',
    {
      class: 'settings',
      onsubmit: async (e) => {
        e.preventDefault();
        state.announce = draft();
        await store.set('announce', state.announce);
        state.announceSaved = true;
        render();
      },
    },
    h('h2', { class: 'section' }, 'Annonce pour le chat du label'),
    ANNOUNCE_FIELDS.map((f) => {
      inputs[f.key] = h('input', { id: `a-${f.key}`, type: 'text', maxlength: CHAT_MAX_LENGTH, value: state.announce[f.key], oninput: refresh });
      return h('div', { class: 'field' }, h('label', { for: `a-${f.key}` }, f.label), f.hint ? h('span', { class: 'hint' }, f.hint) : null, inputs[f.key]);
    }),
    preview,
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Enregistrer'),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            state.announce = { ...DEFAULT_ANNOUNCE, count: state.announce.count, uppercase: state.announce.uppercase };
            await store.set('announce', state.announce);
            render();
          },
        },
        'Format par défaut',
      ),
      state.announceSaved ? h('span', { class: 'progress' }, 'Enregistré.') : null,
    ),
  );
  state.announceSaved = false;
  refresh();
  return form;
}

function runView(tab) {
  const view = VIEWS[tab];
  const res = state.results[tab];
  const running = state.running === tab;
  return [
    h('p', { class: 'intro' }, view.intro),
    h(
      'div',
      { class: 'actions' },
      running
        ? h('button', { class: 'btn', onclick: () => api.abort() }, 'Arrêter')
        : h('button', { class: 'btn primary', disabled: Boolean(state.running), onclick: () => start(tab) }, 'Analyser'),
      h('span', { class: 'progress', id: 'progress' }, running ? state.progress : res ? `Analyse ${ago(res.at)}` : ''),
    ),
    state.error && state.errorTab === tab ? h('div', { class: 'error', role: 'alert' }, state.error) : null,
    res ? view.render(res) : h('p', { class: 'empty' }, 'Lance une analyse. Garde un onglet waxtcg.com ouvert et connecté.'),
  ];
}

function header() {
  const w = Object.values(state.results).filter(Boolean).sort((a, b) => b.at - a.at)[0]?.wallet;
  return h(
    'div',
    { class: 'top' },
    h(
      'div',
      { class: 'brand' },
      h('h1', null, h('span', null, 'WAX'), ' Inspector'),
      h(
        'div',
        { class: 'wallet num' },
        w ? h('span', { class: 'pill', title: 'Mélodies' }, notes(w.notes)) : null,
        w ? h('span', { class: 'pill', title: 'Gemmes' }, `${fmt(w.gems)} 💎`) : null,
      ),
    ),
    h(
      'nav',
      { class: 'tabs', role: 'tablist' },
      [...Object.entries(VIEWS).map(([id, v]) => [id, v.label]), ['settings', '⚙']].map(([id, label]) =>
        h(
          'button',
          {
            class: id === 'settings' ? 'tab tab-icon' : 'tab',
            role: 'tab',
            title: id === 'settings' ? 'Réglages' : null,
            'aria-label': id === 'settings' ? 'Réglages' : null,
            'aria-selected': String(state.tab === id),
            onclick: () => {
              state.tab = id;
              render();
            },
          },
          label,
        ),
      ),
    ),
  );
}

function footer() {
  return h(
    'footer',
    { class: 'foot' },
    `Lecture seule : l’extension ne peut ni acheter ni vendre. ${state.requests} requête${state.requests > 1 ? 's' : ''} depuis l’ouverture du panneau. `,
    'Les règles de WAX interdisent les scripts : analyse avec modération.',
  );
}

function render() {
  app.replaceChildren(header(), h('main', { class: 'panel' }, state.tab === 'settings' ? settingsView() : runView(state.tab)), footer());
}

// ------------------------------------------------------------------ actions

async function start(tab) {
  state.running = tab;
  state.error = null;
  state.progress = 'Démarrage…';
  api.reset();
  api.delayMs = state.settings.delayMs;
  render();
  try {
    const res = await VIEWS[tab].run(api, state.settings, {
      fansCache: { get: () => store.get('artistFans'), set: (entry) => store.set('artistFans', entry) },
      fetchText: fetchSnepText,
      progress: (msg) => {
        state.progress = msg;
        const el = document.getElementById('progress');
        if (el) el.textContent = msg;
      },
    });
    state.results[tab] = res;
    await store.set('results', state.results);
  } catch (e) {
    state.error = e?.message ?? String(e);
    state.errorTab = tab;
  } finally {
    state.running = null;
    render();
  }
}

api.onRequest = (n) => {
  state.requests = n;
  const foot = app.querySelector('.foot');
  if (foot) foot.replaceWith(footer());
};

async function init() {
  state.settings = normalizeSettings(await store.get('settings'));
  state.announce = normalizeAnnounce(await store.get('announce'));
  state.results = (await store.get('results')) ?? {};
  render();
}

init();
