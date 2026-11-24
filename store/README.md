# Publier WAX Inspector sur le Chrome Web Store

Tout ce qu'il faut pour remplir le [tableau de bord du Chrome Web Store](https://chrome.google.com/webstore/devconsole) : le paquet, les images et les textes à copier-coller.

## Avant de commencer

- **Compte développeur** : frais d'inscription unique de 5 $, validation en deux étapes du compte Google, et une adresse e-mail de contact vérifiée. Elle sera visible sur la fiche.
- **Politique de confidentialité** : [`PRIVACY.md`](../PRIVACY.md) doit être publiée à une adresse **publique**. Le dépôt GitHub étant privé, son lien ne marchera pas. Le plus simple : un Gist GitHub public (gist.github.com) avec le contenu du fichier, ou un document Google « Publié sur le Web ». Note l'adresse obtenue.
- **Deux risques à peser** :
  - Les règles de WAX interdisent les scripts. L'extension ne clique jamais, mais elle lit l'API avec la session du joueur. La publier la rend visible des créateurs du jeu, et ton propre compte est lié à la fiche.
  - Le nom « WAX » appartient au jeu. La fiche dit clairement que l'extension est **non officielle**, mais Google peut la refuser pour usage de marque. Une autorisation des créateurs de WAX supprimerait ce risque.

  La visibilité **Non répertoriée** (voir plus bas) limite les deux risques : seules les personnes qui ont le lien la trouvent.

## 1. Construire le paquet

```bash
npm test
```

```bash
npm run package
```

La seconde commande vérifie l'extension (manifest, icônes, fichiers cités, absence de code chargé à distance) puis crée `dist/wax-inspector-<version>.zip`. Le .zip contient le dossier `extension/`, avec `manifest.json` à la racine.

Dans le tableau de bord : **Nouvel élément**, puis importe ce .zip.

## 2. Fiche « Plate-forme de téléchargement » (Store listing)

| Champ | Valeur |
|---|---|
| Nom | `WAX Inspector` (lu dans le manifest) |
| Résumé | lu dans le manifest (125 caractères) |
| Catégorie | Jeux |
| Langue | Français |
| Icône du Store | [`extension/icons/icon-128.png`](../extension/icons/icon-128.png) |
| Captures d'écran (1280 × 800) | [`store/screenshots/`](screenshots/), dans l'ordre 1 à 5 |
| Petite vignette promotionnelle (440 × 280) | [`store/promo-440x280.png`](promo-440x280.png) |
| Site officiel, assistance | à laisser vide, ou l'adresse de ton choix |

Les captures sont faites sur l'aperçu du panneau, avec des titres et des artistes inventés. Pour les refaire après un changement d'interface : `npm run store-assets` (Playwright requis, voir l'en-tête de `dev/store-assets.mjs`).

**Description détaillée** (à coller telle quelle) :

```text
WAX Inspector t'aide à prendre de meilleures décisions au Marché du jeu de cartes musicales WAX (waxtcg.com) : quoi acheter, quoi vendre, et à quel prix.

Extension non officielle, sans lien avec les créateurs de WAX.

C'EST TOI QUI JOUES
L'extension est en lecture seule : elle n'achète pas, ne vend pas, n'enchérit pas et ne clique jamais à ta place. Quand tu cliques sur « Analyser », elle lit les données du jeu et affiche ses conseils dans un panneau latéral, à côté du site. Tu passes tes ordres toi-même.

CE QU'ELLE FAIT
• Acheter : les titres en vente sous leur prix de revente réaliste, vérifiés sur les ventes récentes, avec le prix d'achat maximum et le gain net après la taxe de 5 %.
• Enchères : les enchères Or et plus qui se terminent bientôt sous leur valeur, avec la mise à ne pas dépasser.
• Vendre : tes doublons, tes cartes en pleine hype et les cartes que d'autres joueurs cherchent, classés de la plus intéressante à la moins intéressante (gain, chances de vendre sous 3 jours, demande). Tu choisis si tes coups de cœur et tes artistes protégés sont proposés. En plus : le contrôle de tes annonces et un message prêt à copier pour le chat de ton label.
• Deck : le meilleur deck Face to Face de ta collection, et la carte à poser pour chacune des 9 questions.
• SNEP : les singles certifiés Or, Platine ou Diamant dont la carte n'est pas encore montée dans WAX.

COMMENT L'UTILISER
1. Ouvre waxtcg.com et connecte-toi.
2. Clique sur l'icône de l'extension : le panneau s'ouvre à côté du site.
3. Choisis un onglet et clique sur « Analyser ».

TES DONNÉES
Tout reste dans ton navigateur : tes réglages et tes dernières analyses. Pas de compte, pas de serveur, pas de publicité, pas de statistiques d'usage. L'extension ne contacte que waxtcg.com (avec ta session, comme le site lui-même) et le site public du SNEP. Tu peux tout effacer depuis les Réglages.

À SAVOIR
Les règles de WAX interdisent les scripts (« pas d'auto-clic ni de navigateur piloté »). L'extension ne clique jamais, mais elle lit le site avec ta session quand tu lances une analyse : garde un usage modéré. Les requêtes partent une par une, espacées (0,7 seconde par défaut), et sont mises en cache. Tu restes responsable de l'utilisation de ton compte.
```

## 3. Onglet « Pratiques de confidentialité »

**Objectif unique** :

```text
Aider le joueur à décider quoi acheter, vendre ou jouer dans le jeu de cartes WAX (waxtcg.com) : l'extension lit les données du jeu en lecture seule, à la demande du joueur, et affiche des conseils dans un panneau latéral. Elle n'effectue jamais d'action de jeu.
```

**Justification des autorisations** :

| Autorisation | Justification à coller |
|---|---|
| `sidePanel` | `L'interface de l'extension est un panneau latéral qui s'ouvre à côté de waxtcg.com quand le joueur clique sur l'icône.` |
| `storage` | `Enregistre sur l'appareil les réglages du joueur, ses dernières analyses et un cache du nombre de fans des artistes (relu une fois par jour). Rien n'est envoyé ailleurs.` |
| Autorisations d'hôte | `waxtcg.com : à la demande du joueur, le script de contenu lit les données du jeu (collection, Marché, enchères, deck) par des requêtes GET limitées à une liste fermée de routes de consultation, et lit le solde affiché sur la page. Il ne peut ni acheter, ni vendre, ni enchérir. snepmusique.com : l'onglet SNEP lit la liste publique des certifications de singles, sans cookies, pour repérer les cartes qui vont monter de rareté.` |
| Code à distance | Choisis **Non, je n'utilise pas de code à distance**. Tout le code est dans le paquet. |

**Utilisation des données** : coche **Contenu de site Web**. L'extension lit les données du jeu et les annonces publiques de WAX FM (pseudonymes compris), et n'en garde que dans le stockage local du navigateur. Ne coche aucune autre catégorie : elle ne lit ni identifiants, ni historique, ni données de paiement.

Coche ensuite les trois attestations : pas de vente à des tiers, pas d'utilisation sans rapport avec l'objectif unique, pas d'utilisation pour évaluer une solvabilité.

**URL de la politique de confidentialité** : l'adresse publique de `PRIVACY.md` (voir « Avant de commencer »).

## 4. Instructions de test (pour les examinateurs)

À coller dans la section « Instructions de test » du tableau de bord :

```text
L'extension fonctionne sur le jeu gratuit WAX (https://waxtcg.com). Elle n'a pas de compte propre.
1. Créez un compte gratuit sur waxtcg.com (ou connectez-vous) et ouvrez quelques boosters gratuits pour avoir des cartes.
2. Rechargez l'onglet waxtcg.com, puis cliquez sur l'icône de l'extension : le panneau latéral s'ouvre.
3. Choisissez un onglet (Acheter, Enchères, Vendre, Deck, SNEP) et cliquez sur « Analyser ».
Sans onglet waxtcg.com ouvert et connecté, le panneau affiche un message qui demande de l'ouvrir. L'extension est en lecture seule : elle n'effectue aucune action de jeu.
```

## 5. Distribution

- **Visibilité** :
  - *Public* : tout le monde la trouve dans le Store.
  - *Non répertoriée* : seules les personnes qui ont le lien peuvent l'installer, par exemple les membres de ton label.
- **Régions** : toutes, ou seulement les pays francophones (l'interface est en français).

Puis **Envoyer pour examen**. L'examen prend en général quelques jours ; les autorisations d'hôte peuvent l'allonger.

## Mises à jour

1. Augmente la version dans `extension/manifest.json` **et** `package.json` (par exemple 1.0.1). `npm test` échoue si elles diffèrent.
2. Lance `npm run package`.
3. Dans le tableau de bord : **Paquet**, puis **Importer un nouveau paquet**, puis **Envoyer pour examen**.
