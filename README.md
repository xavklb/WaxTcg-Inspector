# WAX Inspector

Extension Chrome d'**aide à la décision** pour le Marché de [WAX](https://waxtcg.com). Elle te dit quoi acheter, jusqu'à quel prix, et quoi vendre. **C'est toi qui achètes et vends sur le site** : l'extension est en lecture seule.

> ⚠ Les règles de WAX (Guide → 08 Règles) interdisent les scripts : *« Pas d'auto-clic ni de navigateur piloté : bannissement sur preuve technique. »* L'extension ne clique jamais et n'envoie aucune action de jeu. Elle lit cependant l'API avec ta session quand tu cliques sur « Analyser », ce qui reste techniquement un script. Garde un usage modéré (quelques analyses par heure), c'est toi qui assumes ce risque.

## Ce qu'elle fait

| Onglet | Ce que tu obtiens |
|---|---|
| **Acheter** | Les titres en vente sous leur prix de revente réaliste. Pour chacun : prix d'achat max, prix de revente, gain net après la taxe de 5 %, nombre de ventes sur 7 jours et délai de revente estimé. |
| **Enchères** | Les enchères (Or et plus) qui se terminent bientôt sous leur valeur de revente, avec la mise maximale à ne pas dépasser. |
| **Vendre** | D'abord **« À vendre en priorité »** : une seule liste, de la carte la plus intéressante à vendre à la moins intéressante. Elle réunit tes doublons, tes cartes « hype » et tes cartes demandées (parmi les plus souhaitées du Marché, ou cherchées sur WAX FM). Le classement multiplie ce que la vente rapporte (pour un doublon, ce qu'elle rapporte de plus que le recyclage) par les chances de vendre sous 3 jours (rythme des ventes sur 7 jours, annonces moins chères, demande). Un dernier exemplaire compte pour moitié, un coup de cœur ou un artiste protégé pour 70 %, et une carte dont le prix baisse passe un peu devant. Pour chacune, un prix conseillé : sans autre vendeur et demandée, une prime sur la cote (jusqu'à 2× si plus de 100 souhaits), sinon juste sous le moins cher. Le panneau rappelle aussi combien de places d'annonce il te reste. Les cartes qu'il vaut mieux recycler sont mises à part, et un numéro déjà en vente n'est jamais proposé une seconde fois. Tu choisis si l'extension te propose **tes coups de cœur ❤** et **tes artistes protégés 🛡** (cases en haut de l'onglet, ou Réglages). S'ils sont proposés, ils portent un badge et un avertissement. Ensuite, tes annonces dépassées par un autre vendeur ou trop basses, avec le prix conseillé. Enfin, une **annonce pour le chat du label** à copier. Tu choisis le nombre de titres par message, et toutes tes ventes sont réparties en plusieurs messages de 240 caractères au plus, chacun avec son bouton Copier. Le format est réglable (`{page}/{pages}` pour numéroter les messages) et les majuscules sont en option. L'extension n'envoie jamais rien elle-même. |
| **Deck** | Face to Face : le deck de 5 cartes de ta collection qui couvre le mieux les 9 critères (20 points au plus, 2 cartes par artiste), comparé à ton deck actuel. Plus une antisèche : la carte à poser pour chaque critère. Les notes sont **estimées** (le jeu ne les dévoile que pendant une partie). |
| **SNEP** | Les singles que le SNEP vient de certifier (Or, Platine, Diamant) dont la carte n'est **pas encore montée** dans WAX. Pour chacun : le prix d'achat actuel, la valeur estimée après la montée et le gain. Le SNEP publie le lundi après-midi, et WAX a appliqué les montées de 12 h à 3 jours plus tard. À lancer le lundi soir. |
| **⚙ Réglages** | Budget, gain et rendement minimum, ventes minimum, nombre de cartes vérifiées, pause entre deux requêtes, coups de cœur et artistes protégés proposés ou non à la vente… Et un bouton pour effacer toutes les données de l'extension. |

Le prix de revente ne se fie pas à la cote seule. Il prend la médiane des 5 dernières ventes, se place juste sous le vendeur le moins cher et reste dans la fourchette autorisée (75–200 % de la cote).

### Garde-fous

- `content.js` n'accepte que des requêtes **GET** vers une liste fermée de routes de consultation (`/api/game`, `/api/stats`, `/api/auctions`, `/api/faceoff`, `/api/wall`, `/api/artists?…`, `/api/search?q=…`, `/api/market…`, `/api/cards/{id}`). L'onglet SNEP lit aussi le site public `snepmusique.com` (permission d'hôte dédiée, lecture seule).. Acheter, vendre ou enchérir est impossible par construction.
- Une requête à la fois, avec au moins 400 ms entre deux (700 ms par défaut), et un cache de 2 à 5 minutes. Une analyse fait environ 5 à 45 requêtes.
- Aucune requête sans clic sur « Analyser ». Seul le **solde affiché en haut du panneau** (Mélodies, gemmes) est suivi en continu, mais sans requête : `content.js` relit toutes les 1,5 s les chiffres déjà affichés par la page WAX, et prévient le panneau quand ils changent (point vert = en direct).

## Installation

1. Ouvre `chrome://extensions` et active le **Mode développeur** (en haut à droite).
2. Clique sur **Charger l'extension non empaquetée** et choisis le dossier `extension/` de ce dépôt.
3. Ouvre (ou recharge avec F5) un onglet **waxtcg.com** connecté à ton compte.
4. Clique sur l'icône de l'extension (menu puzzle 🧩, épingle-la au besoin) : le panneau latéral s'ouvre.
5. Choisis un onglet et clique sur **Analyser**. Le bouton **Ouvrir** d'une carte affiche sa fiche dans l'onglet WAX.

Après une mise à jour du code, clique sur ↻ sur la carte de l'extension dans `chrome://extensions`, puis recharge l'onglet WAX.

## Développement

Il faut Node 20 ou plus. Aucune dépendance à installer.

```bash
npm test
```

```bash
npm run preview
```

La seconde commande lance un aperçu du panneau sur http://127.0.0.1:5178, avec des données de démonstration (titres inventés, `dev/fixtures.js`).

```
extension/
  manifest.json      Manifest V3
  icons/             icônes 16, 32, 48 et 128 px (source : store/icon.svg)
  background.js      ouvre le panneau au clic sur l'icône
  content.js         pont lecture seule vers l'API (dans l'onglet waxtcg.com)
  sidepanel.*        interface
  lib/constants.js   constantes du jeu (taxe, fourchettes, raretés) et réglages
  lib/analysis.js    calculs purs : taxe, liquidité, prix de revente, verdicts
  lib/deck.js        Face to Face : notes estimées, force d'un deck, recherche du meilleur deck
  lib/snep.js        certifications SNEP : lecture du site, correspondance avec WAX, gain estimé
  lib/announce.js    annonce de mes ventes pour le chat du label
  lib/runs.js        les analyses (lecture API → calculs)
  lib/api.js         file de requêtes, pause, cache
dev/                 aperçu hors Chrome, données de démonstration, paquet et images du Store
store/               fiche Chrome Web Store : textes, captures, vignette, source de l'icône
test/                tests Node (node --test)
docs/                analyse du site (règles, API, constantes)
```

L'analyse complète du jeu (règles, routes de l'API, formules, stratégies) est dans [docs/analyse-waxtcg.md](docs/analyse-waxtcg.md).

## Publier sur le Chrome Web Store

```bash
npm run package
```

Cette commande vérifie l'extension (manifest, icônes, fichiers cités, pas de code chargé à distance, même version que `package.json`) et crée `dist/wax-inspector-<version>.zip`, le paquet à importer dans le tableau de bord du Store. Les textes de la fiche, les réponses de l'onglet « Pratiques de confidentialité » et les étapes de publication sont dans [store/README.md](store/README.md). La politique de confidentialité est dans [PRIVACY.md](PRIVACY.md).

Les icônes et les images de la fiche se régénèrent avec `npm run store-assets` (Playwright requis).
