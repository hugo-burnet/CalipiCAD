# CalpiCAD

## Description
CalpiCAD est une application web conçue pour optimiser le calpinage de pièces sur des plaques de matériaux. Elle aide les utilisateurs à minimiser les pertes de matière en calculant la disposition la plus efficace des pièces, en tenant compte de leurs dimensions et des contraintes de rotation.

## Fonctionnalités
- **Import de Fichiers Excel** : Chargez facilement vos listes de pièces à partir de fichiers Excel.
- **Optimisation Avancée** : Utilise un algorithme de calpinage basé sur l'arbre binaire avec Branch & Bound pour une efficacité maximale.
- **Visualisation 2D Interactive** : Affichez le résultat du calpinage en temps réel avec la possibilité de naviguer entre les différentes plaques.
- **Gestion du Sens du Fil** : Activez ou désactivez la rotation des pièces pour respecter le sens du fil du matériau.
- **Format de Panneau Configurable** : Choisissez le format de plaque parmi les formats courants ou saisissez des dimensions personnalisées. Le dernier format utilisé est mémorisé.
- **Trait de Scie (Kerf)** : La largeur de lame est prise en compte dans le calcul des coupes, pour que les pièces sortent aux bonnes cotes en atelier.
- **Alertes Explicites** : Les lignes de fichier illisibles et les pièces trop grandes pour le panneau sont signalées au lieu d'être ignorées silencieusement.
- **Statistiques Détaillées** : Obtenez des informations sur le taux d'utilisation du matériau et le nombre de panneaux nécessaires.
- **Messages de Chargement Amusants** : Des phrases aléatoires s'affichent pendant l'optimisation pour rendre l'attente plus agréable.
- **Export des Résultats** : Téléchargez les plans de coupe au format JSON ou PDF.
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

2.  **Ouvrir dans un navigateur** :
    CalpiCAD est une application web statique. Il suffit d'ouvrir le fichier `index.html` dans votre navigateur web préféré.
    ```bash
    # Exemple pour Windows
    start index.html
    # Exemple pour macOS/Linux
    open index.html
    ```
    *Alternativement, vous pouvez utiliser un serveur web local (comme Live Server pour VS Code) pour une meilleure expérience de développement.*

## Configuration

Le format du panneau et le trait de scie se règlent **directement dans l'interface**, section `02 // OPTIMISATION` : choisissez un format courant dans la liste déroulante, ou `Personnalisé…` pour saisir vos propres dimensions (1 à 20 000 mm). Les réglages sont mémorisés dans le navigateur (`localStorage`) et réappliqués à la visite suivante.

Le fichier `algo.js` contient les autres configurations de l'algorithme :

-   `CONFIG.plaque.width`, `CONFIG.plaque.height` et `CONFIG.plaque.kerf` : Valeurs **par défaut**, utilisées tant que rien n'a été choisi dans l'interface.
-   `CONFIG.algo.maxTimeMs` : Durée maximale d'exécution de l'algorithme d'optimisation (actuellement 1 minute).
-   `CONFIG.algo.stabilityThresholdMs` : Temps après lequel l'algorithme s'arrête si aucune amélioration n'est trouvée (actuellement 30 secondes).
-   `CONFIG.algo.optimalGraceMs` : Temps d'optimisation des chutes accordé une fois le nombre minimal de panneaux atteint (actuellement 5 secondes).

Vous pouvez modifier ces valeurs directement dans `algo.js` pour ajuster le comportement de l'optimiseur.

## Contribution
Les contributions sont les bienvenues ! Si vous souhaitez améliorer CalpiCAD, n'hésitez pas à soumettre des pull requests ou à ouvrir des issues sur le dépôt GitHub.

## Contact
Pour toute question ou suggestion, vous pouvez contacter l'auteur :
-   **GitHub** : [hugo-burnet](https://github.com/hugo-burnet)
-   **LinkedIn** : [Hugo Burnet](https://www.linkedin.com/in/hugo-burnet-a11323309/)
