# WAX Inspector

Extension Chrome **non officielle** d'aide à la décision pour le jeu de cartes [WAX](https://waxtcg.com) : quoi acheter, quoi vendre, à quel prix.

Elle n'achète et ne vend jamais à ta place. Seule exception, à ta demande : elle prépare la vente groupée du site, et c'est toi qui confirmes.

![Aperçu](store/screenshots/1-vendre.png)

## Fonctions

- **Acheter** : titres en vente sous leur prix de revente réaliste, avec gain net après taxe.
- **Enchères** : enchères Or et plus qui finissent bientôt sous leur valeur, avec mise max.
- **Vendre** : tes cartes classées de la plus intéressante à vendre à la moins intéressante, contrôle de tes annonces, message pour le chat du label.
  Le bouton **Préremplir sur WAX** ouvre « Vendre / Enchères », coche les meilleurs doublons (dans tes places libres) et remplit leurs prix conseillés. Tu vérifies, puis tu cliques toi-même sur « Tout mettre en vente ».
- **Deck** : meilleur deck Face to Face de ta collection.
- **SNEP** : singles certifiés dont la carte n'a pas encore monté.

## Disponibilité

L'extension sera bientôt publiée sur le **Chrome Web Store**. Ce dépôt reste public et à jour : tu peux toujours l'installer depuis les sources.

## Installation

1. `chrome://extensions` → active le **Mode développeur**.
2. **Charger l'extension non empaquetée** → dossier `extension/`.
3. Ouvre waxtcg.com connecté, clique sur l'icône, puis **Analyser**.

## Développement

Node 20+, aucune dépendance.

```bash
npm test
npm run preview      # aperçu sur http://127.0.0.1:5178
npm run package
```

## ⚠ Avertissement

Les règles de WAX interdisent les scripts (« pas d'auto-clic ni de navigateur piloté »). L'extension lit l'API avec ta session, et le bouton **Préremplir sur WAX** clique dans la fenêtre de vente du site à ta place (sans jamais la valider) : possibilité de bannissement !!!

Confidentialité : [PRIVACY.md](PRIVACY.md) · Publication : [store/README.md](store/README.md)
