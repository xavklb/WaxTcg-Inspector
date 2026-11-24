# WAX Inspector

Extension Chrome **non officielle** d'aide à la décision pour le jeu de cartes [WAX](https://waxtcg.com) : quoi acheter, quoi vendre, à quel prix.

**Lecture seule** : elle n'achète, ne vend et ne clique jamais à ta place.

![Aperçu](store/screenshots/1-vendre.png)

## Fonctions

- **Acheter** : titres en vente sous leur prix de revente réaliste, avec gain net après taxe.
- **Enchères** : enchères Or et plus qui finissent bientôt sous leur valeur, avec mise max.
- **Vendre** : tes cartes classées de la plus intéressante à vendre à la moins intéressante, contrôle de tes annonces, message pour le chat du label.
- **Deck** : meilleur deck Face to Face de ta collection.
- **SNEP** : singles certifiés dont la carte n'a pas encore monté.

## Installation

1. `chrome://extensions` → active le **Mode développeur**.
2. **Charger l'extension non empaquetée** → dossier `extension/`.
3. Ouvre waxtcg.com connecté, clique sur l'icône, puis **Analyser**.

## Développement

Node 20+, aucune dépendance.

```bash
npm test             # tests
npm run preview      # aperçu sur http://127.0.0.1:5178
npm run package      # paquet Chrome Web Store dans dist/
```

## ⚠ Avertissement

Les règles de WAX interdisent les scripts. L'extension ne clique jamais mais lit l'API avec ta session : possibilité de bannissement !!!.

Confidentialité : [PRIVACY.md](PRIVACY.md) · Publication : [store/README.md](store/README.md)
