# CalpiCAD

## Description
CalpiCAD est une application web conçue pour optimiser le calpinage de pièces sur des plaques de matériaux. Elle aide les utilisateurs à minimiser les pertes de matière en calculant la disposition la plus efficace des pièces, en tenant compte de leurs dimensions et des contraintes de rotation.

## Fonctionnalités
- **Import de Fichiers Excel** : Chargez facilement vos listes de pièces à partir de fichiers Excel.
- **Optimisation Avancée** : Utilise un algorithme de calpinage basé sur l'arbre binaire avec Branch & Bound pour une efficacité maximale.
- **Calcul en Web Worker** : L'optimisation tourne dans un thread séparé — l'interface reste fluide pendant la minute de calcul, et le solveur ne perd plus de temps à rendre la main.
- **Visualisation 2D Interactive** : Affichez le résultat du calpinage en temps réel avec la possibilité de naviguer entre les différentes plaques.
- **Gestion du Sens du Fil** : Activez ou désactivez la rotation des pièces pour respecter le sens du fil du matériau.
- **Format de Panneau Configurable** : Choisissez le format de plaque parmi les formats courants ou saisissez des dimensions personnalisées. Le dernier format utilisé est mémorisé.
- **Trait de Scie (Kerf)** : La largeur de lame est prise en compte dans le calcul des coupes, pour que les pièces sortent aux bonnes cotes en atelier.
- **Alertes Explicites** : Les lignes de fichier illisibles, les quantités aberrantes et les pièces trop grandes pour le panneau sont signalées au lieu d'être ignorées silencieusement. L'import est plafonné à 5 000 pièces par ligne et 20 000 au total, pour qu'une quantité mal tapée ne fige pas l'onglet.
- **Statistiques Détaillées** : Obtenez des informations sur le taux d'utilisation du matériau et le nombre de panneaux nécessaires.
- **Messages de Chargement Amusants** : Des phrases aléatoires s'affichent pendant l'optimisation pour rendre l'attente plus agréable.
- **Export des Résultats** : Téléchargez les plans de coupe au format JSON, PDF ou **DXF (AutoCAD)**. Le PDF est **vectoriel** : net à n'importe quel zoom, texte sélectionnable, et quelques Ko au lieu de plusieurs Mo par page. Chaque page rappelle le format de plaque, le trait de scie et le bilan des coupes ; chaque pièce porte son nom et ses cotes de découpe, chutes et pertes comprises.
- **Interface Utilisateur Intuitive** : Une interface claire et réactive pour une expérience utilisateur optimale.

## Technologies Utilisées
- **Frontend** : HTML5, CSS3 (avec variables CSS), JavaScript ES6+
- **Librairies JavaScript** :
    - `XLSX.js` : Pour la lecture des fichiers Excel.
    - `jsPDF` : Pour la génération de rapports PDF.
- **Algorithme d'Optimisation** : Implémentation personnalisée en JavaScript.

## Installation et Utilisation

Pour lancer CalpiCAD localement, suivez ces étapes :

1.  **Cloner le dépôt** :
    ```bash
    git clone [URL_DU_DEPOT]
    cd CalpiCAD
    ```

2.  **Servir le dossier en HTTP** :
    CalpiCAD est une application web statique, mais elle a besoin d'un serveur local (Live Server pour VS Code, `python -m http.server`, n'importe quoi qui serve le dossier). Le calcul tourne dans un Web Worker, et un navigateur refuse de créer un Worker depuis une page ouverte en `file://`.

    Ouvrir `index.html` directement fonctionne quand même : l'application détecte le refus au chargement et se rabat sur le moteur exécuté dans la page. Le résultat est identique, simplement plus lent et avec une interface moins fluide pendant le calcul.

## Configuration

Le format du panneau et le trait de scie se règlent **directement dans l'interface**, section `02 // OPTIMISATION` : choisissez un format courant dans la liste déroulante, ou `Personnalisé…` pour saisir vos propres dimensions (1 à 20 000 mm). Les réglages sont mémorisés dans le navigateur (`localStorage`) et réappliqués à la visite suivante.

Le fichier `algo.js` contient les autres configurations de l'algorithme :

-   `CONFIG.plaque.width`, `CONFIG.plaque.height` et `CONFIG.plaque.kerf` : Valeurs **par défaut**, utilisées tant que rien n'a été choisi dans l'interface.
-   `CONFIG.algo.maxTimeMs` : Durée maximale d'exécution de l'algorithme d'optimisation (actuellement 1 minute).
-   `CONFIG.algo.stabilityThresholdMs` : Temps après lequel l'algorithme s'arrête si aucune amélioration n'est trouvée (actuellement 30 secondes).
-   `CONFIG.algo.optimalGraceMs` : Temps d'optimisation des chutes accordé une fois le nombre minimal de panneaux atteint (actuellement 5 secondes).
-   `CONFIG.algo.yieldInterval` / `workerYieldInterval` : Fréquence à laquelle le solveur rend la main. 15 ms dans la page (pour que l'interface reste utilisable), 250 ms dans le worker (où il suffit de pouvoir lire un ordre d'arrêt).

Vous pouvez modifier ces valeurs directement dans `algo.js` pour ajuster le comportement de l'optimiseur.

## Organisation des fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page, chargement des dépendances |
| `style.css` | Thème, mise en page, responsive |
| `algo.js` | Moteur de calpinage. **Ne touche jamais au DOM** : il est chargé à la fois par la page et par le worker |
| `worker.js` | Enveloppe Web Worker autour de `algo.js` |
| `interface.js` | DOM, événements, rendu 2D, exports PDF/JSON |
| `dxf.js` | Export DXF R12, sans dépendance |

`algo.js` doit rester exempt de toute référence à `window` ou au DOM : il tourne aussi dans le worker, où ni l'un ni l'autre n'existe. Tout ce qui traverse `postMessage` doit être de la donnée simple — un getter de prototype (comme l'ancien `get area()`) serait perdu au clonage structuré.

## Export DXF (AutoCAD)

Le bouton `TÉLÉCHARGER DXF` produit un fichier **DXF R12 (AC1009)**, le dialecte le plus largement lu (AutoCAD, BricsCAD, LibreCAD, commandes numériques). Aucune dépendance externe n'est utilisée : le fichier est écrit directement par `dxf.js`.

**Disposition** : les panneaux ne sont pas superposés à la même origine. Ils sont répartis en grille approximativement carrée, avec un espacement de 20 % du format (560 mm horizontalement et 414 mm verticalement pour un 2800 × 2070), et un cartouche sur deux lignes au-dessus de chacun. Tous les textes — cartouches comme repères de pièces — sont calibrés pour tenir dans leur cadre, sans déborder sur le voisin.

**Calques** — chacun peut être gelé ou masqué indépendamment dans AutoCAD :

| Calque | Couleur | Contenu |
|---|---|---|
| `CALPICAD_PANNEAU` | blanc/noir | contour de la plaque |
| `CALPICAD_PIECES` | bleu | pièces à débiter |
| `CALPICAD_CHUTES` | vert | chutes réutilisables |
| `CALPICAD_PERTES` | rouge | pertes sous le seuil |
| `CALPICAD_TEXTE` | jaune | repères, cotes et cartouches |

**Unités** : millimètres (`$INSUNITS = 4`). Les pièces sont dessinées à leurs cotes réelles ; les intervalles entre elles correspondent au trait de scie.

**Accents** : les textes sont translittérés en ASCII (`Côté` devient `Cote`). Le DXF R12 n'a pas d'encodage unicode fiable, et les accents ressortiraient en caractères parasites selon la page de code du poste.

## Contribution
Les contributions sont les bienvenues ! Si vous souhaitez améliorer CalpiCAD, n'hésitez pas à soumettre des pull requests ou à ouvrir des issues sur le dépôt GitHub.

## Contact
Pour toute question ou suggestion, vous pouvez contacter l'auteur :
-   **GitHub** : [hugo-burnet](https://github.com/hugo-burnet)
-   **LinkedIn** : [Hugo Burnet](https://www.linkedin.com/in/hugo-burnet-a11323309/)

