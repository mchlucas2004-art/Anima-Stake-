# Scrap : collecteur et classeur d'assets Spine

Scrap ouvre un jeu dans votre Chrome (piloté par Playwright) et observe le réseau, comme l'onglet *Network* de DevTools mais automatisé. Il récupère les ressources Spine que le jeu charge (skeleton `.json`/`.skel`, `.atlas`, textures), les regroupe en **packages complets**, les classe et les indexe.

**Pipeline :** collecter → identifier → associer → télécharger → classer → indexer.

Scrap lit uniquement ce que le navigateur charge avec **votre** session. Il ne contourne aucune authentification, DRM, chiffrement ou contrôle d'accès, et n'utilise aucune technique anti-détection. Une URL qui répond 401/403 est journalisée et abandonnée. Respectez les conditions d'utilisation du site et les droits des éditeurs : la bibliothèque sert de référence technique locale.

## Installation

```bash
cd Scrap
npm install
```

### Navigateur : votre Chrome déjà ouvert (avec votre VPN)

Par défaut (`"browserMode": "attach"`), Scrap **se branche sur votre Chrome déjà ouvert**. Il garde donc le même profil, les mêmes extensions, le même VPN et la même session Stake. Il ouvre un onglet dans votre Chrome et n'en ferme jamais la fenêtre. Les re-téléchargements passent aussi par votre Chrome, donc par le VPN.

À faire une seule fois, dans votre Chrome :

1. Ouvrez `chrome://inspect/#remote-debugging`.
2. Cochez **« Allow remote debugging for this browser instance »**.
3. Au lancement de Scrap, si Chrome demande d'autoriser le débogage à distance, cliquez **Autoriser**.

Autres options :

- `"attach": { "cdpUrl": "http://127.0.0.1:9222" }` pour un Chrome lancé avec `--remote-debugging-port=9222` ;
- `"browserMode": "launch"` pour un Chromium séparé (sans votre VPN), avec `npm run login`.

## Utilisation

```bash
npm run scrape                                  # traite config/games.txt
npm run scrape -- --game "Le Bandit"            # une machine par son nom
npm run scrape -- --url "https://stake.com/casino/games/hacksaw-le-bandit"
npm run scrape -- --game "Le Bandit" --auto --duration 180   # sans interaction, arrêt auto
npm run resume                                  # reprend une session / une file interrompue
npm run rebuild                                 # régénère packages + index depuis raw/ (sans navigateur)
npm run search -- character idle                # recherche dans l'index
npm test                                        # test hors-ligne de bout en bout (faux jeu local)
```

### Mode interactif (par défaut)

1. Le collecteur démarre, puis ouvre la machine.
2. L'écoute réseau est active **avant** la navigation, donc rien n'est manqué.
3. Vous jouez : spins, bonus, Big Win, etc. Les nouvelles ressources sont traitées dès leur arrivée, même 10 minutes plus tard.
4. Appuyez sur **Entrée** dans le terminal pour arrêter. Ctrl+C ou fermer le navigateur fonctionnent aussi.
5. Scrap termine les téléchargements, puis assemble, classe et indexe.

```
━━━ CAPTURE ACTIVE ━━━  Le Bandit  [04:12]
Requests observed: 1842   Candidate assets: 86   Images: 60   JSON: 20
Atlases: 15   Spine packages: 14   New packages: 9   Errors: 0
```

Si la machine n'est pas trouvée automatiquement, ouvrez-la vous-même dans la fenêtre : la capture tourne déjà. L'URL trouvée est mémorisée pour les fois suivantes.

### Liste des machines

`config/games.txt` contient une machine par ligne : `Nom`, ou `Nom | URL | Provider`, ou simplement une URL. Vous pouvez aussi utiliser `config/games.json` (voir `games.example.json`). Quand une URL est fournie, elle est utilisée telle quelle.

### Réglages

Les réglages sont dans `config/settings.json` :

- `baseUrl` : URL du site.
- `headless` : lancer le navigateur sans fenêtre.
- `browserChannel` : mettre `"chrome"` pour utiliser votre Chrome installé.
- `captureSiteAssets` : collecter aussi les images du lobby (désactivé par défaut).
- `probeMissing` : voir « Passe de complétion » ci-dessous.
- `auto` : durées du mode `--auto`.

### Mode « je joue moi-même, Network ouvert » (fichier HAR)

Ce mode ne demande ni connexion à Chrome ni permission macOS. Vous jouez normalement, avec votre VPN.

1. Dans votre Chrome, ouvrez la machine.
2. Ouvrez **Inspecter → Network**, puis cochez **Preserve log** (« Conserver le journal »).
3. **Rechargez la page** (Cmd+R), pour que tout le chargement soit enregistré.
4. Jouez : spins, bonus, big win, etc.
5. Exportez le Network : bouton **⤓** (« Export HAR ») ou clic droit → *Save all as HAR*. Enregistrez le fichier dans `Scrap/import/`, **nommé comme la machine**, par exemple `Interrogator.har`.
6. Lancez :

```bash
npm run import                        # traite tous les .har de Scrap/import/
npm run import -- --game "Le Bandit" ~/Downloads/fichier.har
```

Scrap récupère tout ce que contient le HAR.

- **Fichiers absents ou vides dans le HAR :** Chrome en oublie parfois. Scrap les retélécharge depuis leur adresse d'origine, puis cherche les textures et atlas manquants.
- **Après traitement :** le HAR est déplacé dans `import/done/`. Il peut contenir des cookies : ne le partagez pas.
- **Plusieurs HAR pour la même machine** s'ajoutent les uns aux autres, sans doublons.

### Réparer une capture

```bash
npm run repair -- --game "Interrogator"
```

Cette commande :

1. retélécharge les fichiers enregistrés vides ou invalides ;
2. cherche les pages d'atlas manquantes ;
3. refait le rangement.

## Arborescence

```
Scrap/
├── config/            games.txt, games.json, settings.json
├── games/<machine>/
│   ├── raw/           ressources pertinentes, intactes (host/chemin CDN d'origine)
│   ├── spine/package_NNN_<nom>/   skeleton + atlas + textures + metadata.json
│   ├── images/        images qui ne sont pas des textures Spine
│   ├── other/         atlas_only/, spritesheets/, json/, bundles/, text/, binary/
│   ├── network/       network.jsonl (toutes les requêtes), resources.jsonl (ressources stockées)
│   └── manifest.json
├── index/             games.json, assets.json, spine_packages.json
├── logs/  temp/
```

- `raw/` est la source de vérité. Il n'est jamais modifié. `spine/`, `images/` et `other/` sont régénérés depuis `raw/` à chaque construction (`npm run rebuild`). Les numéros de packages restent stables d'une construction à l'autre.
- Les fichiers des packages sont des liens physiques vers `raw/`, donc ils n'occupent pas d'espace disque en plus.
- Dans un package, chaque texture porte le nom attendu par l'atlas (ex. `hero_2.png`). Le package se charge donc tel quel dans un runtime Spine.

## Comment les packages sont reconstruits

1. **Identification par le contenu**, pas par l'extension :
   - Un JSON Spine a un score suffisant sur `skeleton.spine`, `bones`, `slots`, `skins`, `animations`, `ik`, `transform`, `path`, `physics`.
   - Un atlas est reconnu par sa syntaxe, au format Spine 3.x ou 4.x.
   - Un `.skel` binaire est reconnu par son en-tête de version.
   - Une image est reconnue par sa signature binaire : PNG, WebP, JPEG, KTX2…
   - Les spritesheets TexturePacker, les DragonBones et les bundles JSON qui contiennent des skeletons, des atlas ou des images en data-URI sont reconnus à part. Le contenu des bundles est extrait.
2. **Skeleton → atlas :** le critère principal est la **couverture des régions**, c'est-à-dire les noms d'attachments du skeleton comparés aux régions de l'atlas, séquences comprises. S'y ajoutent le même nom de base (hash et `@2x` ignorés), le même dossier CDN et la proximité temporelle des chargements. Un skeleton peut utiliser plusieurs atlas, et un atlas peut être partagé (`shared_atlas_with`).
3. **Atlas → textures :**
   - D'abord l'URL relative exacte de chaque page.
   - Sinon, une variante dans le même dossier (`.webp` servi à la place de `.png`, nom hashé).
   - Sinon, le même nom de fichier ou de base ailleurs.
   - Les dimensions sont comparées à `size:` de l'atlas.
4. **Un package = un skeleton.** Deux skeletons différents ne sont jamais fusionnés, même avec des noms proches.
5. **Passe de complétion** (`probeMissing`) : à l'arrêt, Scrap demande avec votre session les pages d'atlas référencées mais jamais chargées, ainsi que l'atlas ou le skeleton voisin manquant. Ce sont des GET simples sur les URLs statiques voisines. Les 401/403 sont abandonnés.

Un package est marqué `complete: true` quand :

- l'atlas est trouvé ;
- toutes ses pages sont résolues ;
- au moins 95 % des régions sont couvertes.

Sinon, `warnings` explique ce qui manque. Rien n'est jamais supprimé : dans le doute, la catégorie est `unknown`.

## Doublons, conflits, robustesse

- **Doublons :** SHA-256 pour chaque ressource. Un contenu identique est stocké une seule fois, et toutes ses URLs et occurrences restent dans l'index.
- **Conflits de noms :** même nom avec un contenu différent → `nom__<sha8>.ext`. Rien n'est jamais écrasé.
- **Corps de réponse :** une réponse illisible, tronquée (comparée à `content-length`) ou en 206 est re-téléchargée, avec retries et backoff.
- **Écritures atomiques :** fichier `.part` puis renommage.
- **Reprise :** tout est journalisé dès l'arrivée. Après un crash ou un Ctrl+C, `npm run resume` construit ce qui a été capturé et poursuit la file.
- **Pas de secrets exportés :** les tokens, sessions et signatures sont retirés des URLs (`REDACTED`) dans tous les fichiers. Aucun cookie ni header d'authentification n'est enregistré.

## Galerie de test des animations

```bash
npm run viewer          # ouvre http://localhost:4321
```

La galerie liste toutes les animations Spine capturées, tous jeux confondus.

- **Filtres :** par jeu, par catégorie, et une recherche par nom ou par animation.
- **Lecteur :** un clic sur une animation l'affiche avec ses animations, ses skins, la boucle, et le choix fond noir ou fond blanc.
- **Version de Spine :** le lecteur officiel (3.8 à 4.3) est choisi automatiquement selon la version du skeleton.
- **Capture pas encore rangée :** si vous n'avez pas encore appuyé sur Entrée, la galerie lit directement `raw/`.
- **Page autonome pour un seul skeleton :** `node page-test-animation/make.js <dossier du package>`.

### Test V1 (scène complète)

`npm run viewer`, puis http://localhost:4321/v1/ (ou le bouton « Test V1 » de la galerie).

La page reconstitue **Sugar Rush 1000** avec ses animations capturées, rendues par le moteur Spine 3.7 officiel. La position, l'échelle et l'ordre des calques sont lus dans la scène du jeu (`page-test-animation/v1/build_scene.py`), et la fenêtre des rouleaux vient de ses `ClippingAnchors`.

On y voit :

- **le jeu de base** : spin, chute des symboles, grappes gagnantes (cadre + animation de gain), explosion, cascade ;
- **les multiplicateurs** : cases ×2 → ×1024 ;
- **les scatters et les free spins** : bannière, transition, décor free spins, fin de bonus ;
- **les 4 niveaux de Big Win** ;
- **l'achat de bonus** ;
- **les décors** : base, free spins, super free spins.

Les textes affichés (montants, nombre de free spins, ×N) sont dessinés par la page, comme le jeu le fait avec ses labels.

## Créations (animations originales)

Le dossier `creations/<nom>/` contient une création Spine originale, entièrement reproductible :

- `source/` : images générées (Nano Banana Pro via sjinn.ai) et `prompts.jsonl`, qui garde la trace de chaque prompt, tâche et URL.
- `cut.mjs` / `build.mjs` : V1 (pièces simples).
- `cut2.mjs` : V2, découpe « production ».
  - La citrouille est séparée en corps, tige, 4 éléments du visage, expressions et lumière de bougie, à partir de variantes éditées au pixel près.
  - La plaque est séparée en planche, slime, gouttes et 7 lettres.
- `build2.mjs` : V2, rig façon croc d'Interrogator.
  - Meshes pondérés (corps, chapeau, tige, ailes, slime, fantôme).
  - Chaînes d'os, contraintes `physics` Spine 4.2 (chapeau, tige, gouttes, traîne du fantôme), échange d'expressions, évènements.
- `package/` : le résultat (`.json`, `.atlas`, `.png`, `metadata.json`), utilisable tel quel dans un runtime Spine 4.2.

Vue test : `npm run viewer`, puis la galerie (rubrique « Créations ») ou http://localhost:4321/showcase.html. On y trouve les séquences comme en jeu, chaque animation, les deux pistes, les évènements, la vitesse et l'affichage des os.

La clé sjinn.ai est dans `config/secrets.json`, un fichier local exclu du partage.

### Jeu Halloween

Le jeu de symboles Halloween se trouve dans `creations/halloween/` :

- `scatter/` : le scatter (citrouille), rig complet ;
- `symbols/` : images sources et générateur `build_symbols.mjs`, qui produit `candycorn`, `wrapped`, `apple` (simples) et `cat`, `skull`, `cauldron`, `owl` (forts).

Animations : `idle`, `land`, `win` et `exit` pour tous les symboles, plus `anticipation` pour les symboles forts.

Page d'ensemble : http://localhost:4321/halloween.html (bouton « 🎃 Jeu Halloween » de la galerie).

## Index : utilisation par un agent (Claude Code)

`index/spine_packages.json` contient une entrée par package :

- `path` : dossier du package ;
- `metadata` : son `metadata.json` ;
- `category` et `subtypes`, par exemple `symbol` / `symbol_win`, `background_loop`, `big_win` ;
- `tags` ;
- `animations[]`, avec nom et durée ;
- `skins`, `bones_count`, `slots_count` ;
- `textures` ;
- `complete` ;
- `search_text`, qui concatène tous les mots-clés.

Exemples :

```bash
npm run search -- fire effect
npm run search -- symbol explosion --complete
npm run search -- background --category background --json
jq '.packages[] | select(.category=="character") | select(any(.animations[]; .name|test("idle"))) | .path' index/spine_packages.json
```

Le `metadata.json` d'un package contient en plus :

- les URLs d'origine (assainies) ;
- les SHA-256 ;
- la preuve d'association (couverture, dossier, nom) ;
- les régions manquantes ;
- les dimensions et le PMA des textures ;
- les contraintes (ik, transform, path, physics).

`index/assets.json` liste toutes les ressources, avec leur type, leur fichier `raw` et leurs sorties. `index/games.json` résume chaque machine.

Catégories : `character`, `symbol`, `effect`, `background`, `transition`, `ui`, `unknown`. La classification est **indicative** : elle repose sur le nom, le chemin CDN, les animations, les skins et les os. La confiance (`high`/`medium`/`low`) et les indices utilisés sont dans `classification`.

## Moteurs spéciaux

**Pragmatic Play (moteur « UHT »).** Ces jeux ne chargent pas de fichiers Spine classiques. Les skeletons sont encodés dans des packs JSON découpés en morceaux (`main_resources000.json`, `001`…). Les atlas sont au format NGUI (`UIAtlas`), et les textures sont en KTX2/Basis.

Scrap recolle automatiquement les morceaux, puis :

- décode les skeletons ;
- regénère un `.atlas` Spine standard, en gérant les images tournées et les marges de rognage ;
- convertit les textures en PNG avec le décodeur Basis officiel (`vendor/basis/`).

Les packs d'origine restent dans `other/vendor_packs/`.

## Limites connues

- **`.skel` binaire :** la version, la taille et l'association à l'atlas sont extraites, mais pas encore la liste des animations.
- **Textures GPU compressées** (KTX2/Basis) : collectées et associées, mais non décodées.
- **Assets chiffrés ou empaquetés dans un format propriétaire :** non traités (pas de contournement). Ils restent visibles dans `network/network.jsonl` et `other/binary/` pour diagnostic.
- **Recherche automatique du jeu sur le site :** dépend de son interface. En cas d'échec, ouvrez le jeu à la main ou donnez son URL.
