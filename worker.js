/**
 * CalpiCAD - Worker d'optimisation (worker.js)
 *
 * Le solveur tournait dans le thread principal et devait rendre la main toutes les
 * 15 ms pour ne pas figer la page. Ici il a le thread pour lui : il ne rend la main
 * que toutes les 250 ms, juste assez pour lire un ordre d'arrêt et publier son
 * avancement. L'interface, elle, reste fluide quoi qu'il arrive.
 *
 * Repli : une page ouverte en file:// ne peut pas créer de Worker. interface.js
 * sonde ce fichier au chargement (message 'ready') et bascule sur le moteur en
 * page si la réponse ne vient pas.
 */

importScripts('algo.js?v=2.0');

let engine = null;

self.onmessage = (e) => {
    const msg = e.data || {};

    if (msg.type === 'start') {
        if (engine && engine.isRunning) return;
        engine = new OptimizerEngine();

        // yieldInterval est imposé ici et non par l'appelant : c'est une propriété du
        // contexte d'exécution, pas un réglage utilisateur.
        const options = { ...(msg.options || {}), yieldInterval: CONFIG.algo.workerYieldInterval };

        try {
            engine.start(
                msg.pieces,
                msg.plaque,
                options,
                (progress) => self.postMessage({ type: 'progress', payload: progress }),
                (result) => self.postMessage({ type: 'complete', payload: result })
            );
        } catch (err) {
            self.postMessage({ type: 'failed', message: String(err && err.message || err) });
        }
        return;
    }

    if (msg.type === 'stop' && engine) {
        engine.stop();
    }
};

// Signale que importScripts a réussi : c'est la réponse attendue par la sonde.
self.postMessage({ type: 'ready' });
