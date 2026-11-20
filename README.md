# WAX Inspector

Extension Chrome d'**aide à la décision** pour le Marché de [WAX](https://waxtcg.com). Elle te dit quoi acheter, jusqu'à quel prix, et quoi vendre. **C'est toi qui achètes et vends sur le site** : l'extension est en lecture seule.

> ⚠ Les règles de WAX (Guide → 08 Règles) interdisent les scripts : *« Pas d'auto-clic ni de navigateur piloté : bannissement sur preuve technique. »* L'extension ne clique jamais et n'envoie aucune action de jeu. Elle lit cependant l'API avec ta session quand tu cliques sur « Analyser », ce qui reste techniquement un script. Garde un usage modéré (quelques analyses par heure), c'est toi qui assumes ce risque.

## Ce qu'elle fait

| Onglet | Ce que tu obtiens |
|---|---|
| **Acheter** | Les titres en vente sous leur prix de revente réaliste. Pour chacun : prix d'achat max, prix de revente, gain net après la taxe de 5 %, nombre de ventes sur 7 jours et délai de revente estimé. |
| **Enchères** | Les enchères (Or et plus) qui se terminent bientôt sous leur valeur de revente, avec la mise maximale à ne pas dépasser. |
| **Vendre** | Tes annonces dépassées par un autre vendeur ou trop basses, avec le prix conseillé. Puis tes doublons et tes cartes « hype » à vendre, avec un prix rapide et un prix cote. Une carte en **coup de cœur ❤** ou d'un **artiste protégé 🛡** est signalée par un badge et un avertissement. Enfin, une **annonce pour le chat du label** à copier : format réglable, nombre de titres, majuscules, 240 caractères au plus. L'extension ne l'envoie jamais elle-même. |
| **Deck** | Face to Face : le deck de 5 cartes de ta collection qui couvre le mieux les 9 critères (20 points au plus, 2 cartes par artiste), comparé à ton deck actuel. Plus une antisèche : la carte à poser pour chaque critère. Les notes sont **estimées** (le jeu ne les dévoile que pendant une partie). |
| **Réglages** | Budget, gain et rendement minimum, ventes minimum, nombre de cartes vérifiées, pause entre deux requêtes… |

Le prix de revente ne se fie pas à la cote seule. Il prend la médiane des 5 dernières ventes, se place juste sous le vendeur le moins cher et reste dans la fourchette autorisée (75–200 % de la cote).

### Garde-fous

- `content.js` n'accepte que des requêtes **GET** vers une liste fermée de routes de consultation (`/api/game`, `/api/stats`, `/api/auctions`, `/api/faceoff`, `/api/market…`, `/api/cards/{id}`). Acheter, vendre ou enchérir est impossible par construction.
- Une requête à la fois, avec au moins 400 ms entre deux (700 ms par défaut), et un cache de 2 à 5 minutes. Une analyse fait environ 5 à 45 requêtes.
- Rien ne tourne en arrière-plan : aucune requête sans clic sur « Analyser ».

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
  background.js      ouvre le panneau au clic sur l'icône
  content.js         pont lecture seule vers l'API (dans l'onglet waxtcg.com)
  sidepanel.*        interface
  lib/constants.js   constantes du jeu (taxe, fourchettes, raretés) et réglages
  lib/analysis.js    calculs purs : taxe, liquidité, prix de revente, verdicts
  lib/deck.js        Face to Face : notes estimées, force d'un deck, recherche du meilleur deck
  lib/runs.js        les analyses (lecture API → calculs)
  lib/api.js         file de requêtes, pause, cache
dev/                 aperçu hors Chrome + données de démonstration
test/                tests Node (node --test)
docs/                analyse du site (règles, API, constantes)
```

L'analyse complète du jeu (règles, routes de l'API, formules, stratégies) est dans [docs/analyse-waxtcg.md](docs/analyse-waxtcg.md).
