# Analyse de WAX (waxtcg.com) — 20/11/2026

Analyse faite depuis le compte de l'utilisateur via l'extension Claude in Chrome : lecture de l'interface, du guide officiel, du code JavaScript du site et de l'API JSON (requêtes **GET uniquement**, aucune action de jeu effectuée).

---

## 0. À lire en premier : les règles interdisent les bots

Extrait du guide officiel, chapitre « 08 Règles » :

> **ZÉRO SCRIPT** — Pas d'auto-clic ni de navigateur piloté : bannissement sur preuve technique.

Autres règles : un seul compte par personne (doubles comptes bannis), pas de « boosting » entre comptes, aucun échange contre de l'argent réel.

Mécanismes anti-bot observés dans le code :

- **Vérification humaine Cloudflare Turnstile** (`/api/human`). Le serveur peut répondre `HUMAN_CHECK` à une action ; le site affiche alors « Es-tu humain ? ». Un bot autonome resterait bloqué là, et contourner ce captcha est exclu.
- Messages d'erreur `banned` (« Ce compte a été suspendu pour triche ») et `device_banned` (« Cet appareil a servi à un compte banni pour triche : il ne peut plus créer de compte »). Le bannissement vise donc aussi l'appareil.
- Limites de débit : `RATE_LIMITED`, `BUSY`, `BUSY_SERVER`.

**Conséquence :** un outil qui achète et vend tout seul enfreint explicitement les règles et risque de faire bannir le compte et l'appareil. Approche recommandée : un **outil d'aide à la décision** (il calcule quoi acheter, à quel prix, quoi vendre et quand), et c'est toi qui exécutes les transactions à la main. Même une collecte de données automatisée en lecture seule reste un « script » au sens strict. Le risque est plus faible, mais pas nul (voir §8).

---

## 1. Le jeu en bref

- Chaque carte = un vrai titre musical (données Deezer : `rank`, fans de l'artiste). Environ 796 000 cartes.
- **Mélodies (♫)** = monnaie du marché (champ API `notes`). Elles s'obtiennent par les ventes, le recyclage, les missions et les défis.
- **Gemmes** (champ `gems`) = monnaie des boosters payants (120 gemmes le booster) ; elles s'obtiennent par les missions, les défis et le parrainage.
- Le jeu est gratuit. Mélodies, gemmes et cartes n'ont aucune valeur en argent (FAQ).

### Raretés

| Interne | Affiché | Nb cartes | Critère réel | Recyclage ♫ | Fabrication ♫ | Prix min–max autorisé ♫ | Cote de départ (base) |
|---|---|---|---|---|---|---|---|
| `demo` | Découverte | 352 504 | sons les moins connus | 5 | 40 | 10 – 400 | 30 |
| `single` | Populaire | 316 744 | sons connus du public | 10 | 80 | 20 – 800 | 60 |
| `hit` | Hit | 86 067 | gros sons de l'artiste | 30 | 240 | 60 – 2 500 | 200 |
| `or` | Or | 33 395 | certifié Or ou très écouté | 100 | non fabricable | 200 – 8 000 | 700 |
| `platine` | Platine | 5 604 | certifié Platine | 150 | non fabricable | 600 – 30 000 | 2 500 |
| `diamant` | Diamant | 1 566 | certifié Diamant (SNEP) ou 7,5 M ventes | 400 | non fabricable | 2 000 – 100 000 | 9 000 |
| `worldwide` | Worldwide | 290 | > ~1,9 Md d'écoutes, liste manuelle | 2 000 | non fabricable | 100 000 – 1 000 000 | 120 000 |

### Les cartes montent de rareté (levier de spéculation majeur)

- Les certifications SNEP sont intégrées **chaque semaine**. Un son qui devient Or, Platine ou Diamant **monte de rareté, même déjà dans une collection**. Une carte ne descend jamais.
- Un exemplaire tiré avant la montée garde un contour de sa rareté d'origine (« carte montée ») et vaut plus.
- Défi lié : « Avoir 5 cartes qui ont évolué » (80 gemmes + 200 ♫).

### Numéros et éditions limitées

- Chaque exemplaire est numéroté dans l'ordre des tirages ; un petit numéro vaut plus (classement et prix).
- Nouveau son d'un artiste à plus de 1,5 M fans : les 100 premiers numéros forment une **édition limitée** (1 000 pour une très grosse sortie). Ils se trouvent dans les boosters « Sortie » et de style, surtout les premiers jours.

---

## 2. Boosters

- 5 cartes. Booster gratuit : 1 charge toutes les **10 min**, **10 en réserve** au maximum (une autre config existe à 7 min / 15 charges, probablement premium).
- Booster en gemmes : **120 gemmes**, carte 4 au minimum Hit, Platine garantie plus tôt.
- Taux de base par emplacement (booster gratuit) :
  - Cartes 1–3 : Découverte 80 %, Populaire 20 %
  - Carte 4 : Populaire 77 %, Hit 18,5 %, Or 4,2 %, Platine 0,295 %, Diamant 0,005 %
  - Carte 5 : Populaire 46,9 %, Hit 40 %, Or 11,4 %, Platine 1,54 %, Diamant 0,12 %, Worldwide 0,002 %
- Observé sur les 40 000 derniers boosters : 7 411 Or, 1 475 Platine, 156 Diamant, 0 Worldwide. Soit environ 1 Or tous les 6 boosters, 1 Platine tous les 28, 1 Diamant tous les 223.
- Pitié (« pity ») : Platine garantie au plus tard au N-ième booster (compteur par booster, champ `state.pity`) ; premier Diamant garanti dans une fourchette de boosters.
- Les boosters de style (Rap, Pop, K-pop…) ont les mêmes taux ; seul le choix de titres change.

## 3. Fabriquer, recycler, fusionner

- **Fabriquer** : jusqu'à Hit seulement. Coût = `max(coût de la rareté, 2,5 × cote arrondie à 10)`.
- **Recycler** un doublon rapporte les valeurs du tableau. Au-delà de **1 000 ♫ recyclés dans la journée**, le recyclage paie moitié prix. Annulation possible pendant 5 min.
- **Fusion** : 5 doublons donnent 1 nouvelle carte de même rareté, avec **15 %** de chances de monter d'une rareté.
- Recycler rapporte toujours beaucoup moins que vendre : une Or se recycle 100 ♫ mais ne peut pas être vendue sous 200 ♫. Il faut **vendre plutôt que recycler** dès qu'il y a un acheteur.

## 4. Marché

### Règles (constantes du code et du guide)

| Règle | Valeur |
|---|---|
| Prix de vente autorisé | **75 % à 200 % de la cote**, borné par le min/max de la rareté |
| Taxe sur une vente | **5 %** (3 % entre membres d'un même label pour les échanges) : tu touches `prix − ceil(prix × 0,05)` |
| Durée d'une annonce | 6, 24, 48 ou 72 h |
| Annonces ouvertes simultanées | 20 au plus |
| Condition pour vendre ou échanger | avoir ouvert 10 boosters |
| Dons vers un ami | 6 000 ♫ sur 48 h au plus |
| Échanges | 10 par jour au plus avec le même joueur |

### La cote

- « La cote suit les ventes entre joueurs. » Elle bouge à chaque vente (moyenne lissée des dernières ventes).
- Une carte jamais vendue a une **cote de départ** (formule extraite du code) :

  ```
  cote = round( base[rareté]
              × (0,7 + 0,6 × min(1, rank_deezer / 1 000 000))
              × mult[niveau ◉]                       // {1: 1, 2: 1.3, 3: 1.7}
              × (0,75 + 0,5 × clamp((log10(fans) − 4) / 3, 0, 1)) )
  ```

- La valeur de collection (classement) compte chaque son **une seule fois**, à ton meilleur exemplaire. Les doublons n'ajoutent rien au classement mais gardent leur prix au Marché.

### Enchères

- Réservées aux cartes **Or et plus**. Durée 1 h, 6 h ou 24 h. 3 enchères en cours au plus par vendeur.
- Une enchère dans les dernières minutes ajoute 2 minutes (anti-snipe).
- Achat immédiat au **double de la cote** : la carte part d'office.
- 200 enchères ouvertes au moment de l'analyse (107 Platine, 66 Or, 26 Diamant).

### Face to Face (relevé le 20/11/2026)

- Duel en 5 manches. Chaque joueur a un **deck de 5 cartes** de sa collection : 20 points au plus (Découverte 1, Populaire 2, Hit 3, Or 4, Platine 6, Diamant 8, Worldwide 10), 5 cartes différentes, 2 cartes d'un même artiste au plus.
- À chaque manche, un **critère** est tiré : écoutes (`plays`), underground, fans, cote (`quote`), classique (`classic`), fraîcheur (`fresh`), le plus long, le plus court, la plus rare. On a 15 s pour poser une carte en secret ; la meilleure note gagne. Chaque carte ne sert qu'une fois.
- Les 9 questions, telles qu'écrites dans le code du jeu, et la donnée utilisée par l'extension pour les estimer :

  | Clé | Question | Donnée utilisée |
  |---|---|---|
  | `plays` | Le son le plus écouté gagne | popularité Deezer du son (`rank`) |
  | `underground` | Le son le moins écouté gagne | idem, inversé |
  | `fans` | L'artiste le plus suivi gagne | `artist.fans` via `GET /api/artists?started=1&offset=…&limit=60` (840 artistes = 14 pages) |
  | `quote` | La carte qui vaut le plus au Marché gagne | `stats.values` (= cote du Marché, un peu plus pour un petit numéro) |
  | `classic` | Le son le plus ancien gagne | `year` |
  | `fresh` | Le son le plus récent gagne | `year` |
  | `long` | Le son le plus long gagne | `duration` |
  | `short` | Le son le plus court gagne | `duration` |
  | `rare` | La carte la plus rare gagne | rareté, puis valeur |

- Chaque partie tire aussi un **thème** parmi 11 (avant 2000, années 2000, années 2010, depuis 2020, Made in France, International, Rap, Pop, Rock, Électro, Featurings) : ses cartes prennent **+15 sur toutes leurs notes**.
- Gagner avec une carte moins rare que celle de l'adversaire rapporte 2 points.
- Gains : 10 gemmes par victoire contre WAX, 20 contre un joueur, +10 en série de 5 victoires, 360 gemmes par jour au plus.
- `GET /api/faceoff` : `deck` (5 ids), `gemsToday`, `gemsMax`, `board`, `game` (partie en cours : `mine[]` avec les `marks` par critère, `rounds`, `theme`, `criterion`, `score`). Les notes (`marks`) sont calculées par le serveur et ne sont visibles que pendant une partie.

---

## 5. API (pour l'outil)

Toutes les routes passent par `https://waxtcg.com/api/...` avec le cookie de session.

### Lecture (GET)

| Route | Contenu utile |
|---|---|
| `/api/game` | état du joueur : `gems`, `notes` (♫), `pity`, `freePacks`, `daily.counters`, `collection` (id → nb d'exemplaires) |
| `/api/market?sort=…&count=…` | annonces groupées par titre : `track`, `best` (prix plancher), `listings`, `quote` (cote), `trend` ; plus `mine` (mes annonces), `bought`, `sales` (20 dernières ventes du site), `bigSales`, `wanted`, `total` |
| ↳ paramètres | `sort` ∈ {`trend`, `price`, `rarity`, `recent`}, `count` ≤ 3000, `q`, `rarity`, `style`, `missing=1`, `wished=1`, `min`, `max`, `n` (n° de série, ex. `1-10`) |
| `/api/market/{trackId}` | `quote`, `trend`, `range{min,max}` (prix autorisé), `listings[]` (id, prix, serial, expiresAt), `history[]` (ventes datées), `auctions[]` |
| `/api/cards/{trackId}` | fiche complète : `popularity` (rank, songNote, artistNote, **artistCeiling**), `market` (quote, trend, trend7, cheapest, sales, chart), `circulation` (owners, copies, editionLeft), `artist.fans`, `history.ups` (montées de rareté) |
| `/api/auctions` | enchères ouvertes : start, bid, next, max (achat immédiat), endsAt, quote, leader |
| `/api/stats` | valeur de ma collection, rang, nb de joueurs (≈ 59 100) |
| `/api/ranking` | classement mondial et de la semaine (prix 5/3/2) |
| `/api/base/guide` | stats par rareté, dernières montées (`up`), taux observés |
| `/api/sets`, `/api/sets/{id}` | boosters disponibles et contenu |
| `/api/challenges` | défis de collection (récompenses en gemmes et ♫) |
| `/api/human` | `{due: bool}` : vérification humaine en attente |
| `/api/wall` | mur WAX FM : 150 dernières annonces `{kind: 'want' (cherche) \| 'give' (propose), track, note, who, at, mine, have (mes exemplaires), forMe}` |
| `/api/market` → `wanted` | les 6 cartes les plus souhaitées : `{track, wishes, best}` (`best: null` = personne n'en vend) |
| `/api/artists?started=1&offset=…&limit=60` | mes artistes avec `artist.fans` (60 par page) |

### Actions (POST `/api/market`), documentées pour référence

- `{action: "list", trackId, price, hours, serial?}` : mettre en vente
- `{action: "buy", listingId}` : acheter
- `{action: "cancel", listingId}` : retirer une annonce

Ne pas les appeler depuis un script : c'est exactement ce que la règle « ZÉRO SCRIPT » sanctionne (voir §0).

---

## 6. Photo du marché (20/11/2026)

- **25 532 annonces**, environ **15 900 titres distincts** en vente.
- Ratio *prix plancher / cote* médian : Découverte 1,00 · Populaire 1,00 · Hit 1,00 · **Or 0,91 · Platine 0,94** · Diamant 1,00 · Worldwide 1,06.
- Le 10e centile est à **0,75** (le plancher autorisé) pour Hit, Or, Platine et Diamant : beaucoup de vendeurs bradent au minimum.
- Environ 1 600 titres Or et 1 570 titres Platine sont affichés sous 0,95 × cote. Sur le papier, les acheter puis les revendre à la cote rapporterait environ 20 % après taxe.
  ⚠ C'est surtout le signe d'une **offre excédentaire** : le vrai prix de revente est plus proche des ventes réelles que de la cote. Il faut mesurer la **vitesse de vente** (historique `history` / `chart`) avant d'y croire.
- Effet « sortie » : PADAWAN (Ninho, M.I.L.S 4, sorti le 19/11) est en Populaire, avec une cote de base d'environ 60. Il se vend à **440 ♫** 11 h après sa sortie (+548 %) : 7 045 exemplaires, 5 699 propriétaires, 79 ventes en 11 h. Les sorties créent des pics de demande très courts.

## 7. Ton compte (au moment de l'analyse)

- 430 ♫, 178 gemmes, 487 boosters ouverts, valeur de collection ≈ 188 000, rang ≈ 19 965 / 59 105.
- Marché : 10 annonces ouvertes, 9 ventes (8 405 ♫), 26 retirées, 10 expirées ; 27 achats (9 546 ♫).
- Exemple de sous-évaluation : « Dernière » (Bigflo & Oli, Platine) est en vente à 1 665 ♫ alors que la cote est à 2 220 ♫, donc au plancher de 75 %.

---

## 8. Sources de profit identifiées

1. **Vendre au lieu de recycler.** Les doublons valent 2 à 10 fois plus au Marché qu'au recyclage. C'est le gain le plus simple et sans risque.
2. **Spéculer sur les montées de rareté.** Il s'agit d'acheter des Hit ou Or dont le son approche d'une certification SNEP (Or, Platine, Diamant) avant la mise à jour hebdomadaire. La carte monte, sa cote de départ est multipliée (base 200 → 700 → 2 500 → 9 000) et elle garde le contour « montée ». Indices disponibles dans l'API : `popularity.artistCeiling`, `rank`, `fans`. Les certifications SNEP sont publiques.
3. **Hype des sorties.** Les éditions limitées et les titres d'une grosse sortie s'envolent les premières heures. Il vaut mieux vendre tôt les exemplaires tirés que garder.
4. **Achat sous la cote, revente à la cote** (Or et Platine surtout). Ce n'est rentable que si le titre se vend souvent ; il faut filtrer sur le nombre de ventes récentes.
5. **Enchères Or+.** On peut acheter quand l'enchère en cours est loin sous la cote près de la fin (attention à l'anti-snipe de +2 min).
6. **Petits numéros** (N°001, éditions ≤ 100) : prime à la revente.
7. **Missions et défis** : gemmes et ♫ gratuits (ex. « Vendre 10 cartes au Marché » rapporte 60 gemmes + 200 ♫).

## 9. Architecture conseillée pour l'outil

- **Mode recommandé : aide à la décision, exécution manuelle.** L'outil calcule un tableau d'opportunités (titre, prix d'achat max, prix de revente visé, gain net après 5 %, vitesse de vente, score de risque) et une liste « à vendre » pour tes doublons. Tu cliques toi-même sur le site.
- **Collecte des données** : chaque option a un risque différent.
  - Saisie ou export manuel : aucun risque, mais fastidieux.
  - Lecture API à faible fréquence avec ta session : pratique, mais techniquement un script, donc risque de ban faible mais réel. À décider en connaissance de cause.
  - Données externes (certifications SNEP, classements Deezer) : aucun risque côté WAX, utiles pour la spéculation sur les montées.
- **À exclure** : achat ou vente automatiques, contournement de la vérification humaine, multi-comptes.
