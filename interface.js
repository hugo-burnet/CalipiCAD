/**
 * CalpiCAD - Interface Manager (interface.js)
 * Responsibilities:
 * - DOM Manipulation
 * - Event Handling
 * - Visualization (Canvas)
 * - User Feedback (Timer, Progress)
 * - Bridge to OptimizerEngine
 */

/**
 * Aiguillage moteur : Web Worker quand c'est possible, moteur en page sinon.
 *
 * Le worker est le chemin normal. Il rend au solveur les ~20 % de budget que le
 * bridage à 4 ms des setTimeout imbriqués lui prenait, et surtout il sort la boucle
 * du thread de rendu : plus aucune saccade pendant l'optimisation.
 *
 * Mais un Worker ne peut pas être créé depuis une page ouverte en file:// (ce que le
 * README propose), d'où la sonde au chargement et le repli sur OptimizerEngine.
 */
class EngineHost {
    static PROBE_TIMEOUT_MS = 4000;

    constructor(workerUrl) {
        this.workerUrl = workerUrl;
        this.worker = null;
        this.local = null;
        this.onProgress = null;
        this.onComplete = null;
        this.usingWorker = this._spawn();
    }

    /** Résout true si le worker répond 'ready', false s'il faut se rabattre sur la page. */
    _spawn() {
        return new Promise((resolve) => {
            let worker;
            try {
                worker = new Worker(this.workerUrl);
            } catch (err) {
                console.warn("CalpiCAD : Worker refusé (page ouverte en file:// ?), optimisation dans la page.", err);
                resolve(false);
                return;
            }

            let timer = null;
            let settled = false;
            const settle = (ok) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (ok) {
                    this.worker = worker;
                    worker.onmessage = (e) => this._dispatch(e.data);
                    worker.onerror = (e) => {
                        console.error("CalpiCAD : erreur du worker.", e.message || e);
                        this._dispatch({ type: 'failed', message: e.message });
                    };
                } else {
                    try { worker.terminate(); } catch (e) { /* déjà mort, rien à faire */ }
                    console.warn("CalpiCAD : Worker injoignable, optimisation dans la page.");
                }
                resolve(ok);
            };

            worker.onmessage = (e) => { if (e.data && e.data.type === 'ready') settle(true); };
            worker.onerror = () => settle(false);
            timer = setTimeout(() => settle(false), EngineHost.PROBE_TIMEOUT_MS);
        });
    }

    _dispatch(msg) {
        if (!msg) return;
        if (msg.type === 'progress') {
            if (this.onProgress) this.onProgress(msg.payload);
        } else if (msg.type === 'complete') {
            if (this.onComplete) this.onComplete(msg.payload);
        } else if (msg.type === 'failed') {
            // On débloque l'interface avec un résultat nul plutôt que de la laisser
            // tourner indéfiniment sur une optimisation morte.
            if (this.onComplete) this.onComplete(null);
        }
    }

    async start(pieces, plaque, options, onProgress, onComplete) {
        this.onProgress = onProgress;
        this.onComplete = onComplete;

        if (await this.usingWorker) {
            this.worker.postMessage({ type: 'start', pieces, plaque, options });
            return;
        }
        if (!this.local) this.local = new window.OptimizerEngine();
        this.local.start(pieces, plaque, options, onProgress, onComplete);
    }

    stop() {
        if (this.worker) this.worker.postMessage({ type: 'stop' });
        if (this.local) this.local.stop();
    }
}

class UIManager {
    // Panel dimension bounds, in mm.
    static MIN_DIM = 1;
    static MAX_DIM = 20000;
    // Saw blade width, in mm.
    static MAX_KERF = 50;
    // Reuse threshold for an offcut, in m².
    static MAX_MIN_OFFCUT_M2 = 10;
    // Garde-fous d'import : une quantité mal tapée (100000 au lieu de 10) figeait
    // l'onglet à la lecture du fichier, avant même le lancement de l'optimisation.
    static MAX_QTY_PER_ROW = 5000;
    static MAX_TOTAL_PIECES = 20000;

    // Palette du PDF, en RGB. Reprend la sémantique de la légende à l'écran, mais en
    // clair : un plan part à l'imprimante de l'atelier, pas sur un fond noir.
    static PDF_COLORS = {
        piece:      [222, 229, 241],
        pieceLine:  [ 74, 111, 165],
        offcut:     [219, 240, 221],
        offcutLine: [ 46, 125,  50],
        waste:      [248, 226, 226],
        wasteLine:  [160,  60,  60],
        panelLine:  [ 20,  20,  20],
        text:       [ 17,  17,  17],
        textDim:    [ 90,  90,  90]
    };

    // Colonnes acceptées, déjà en minuscules : la résolution se fait une seule fois
    // contre les en-têtes du fichier, pas à chaque ligne.
    static COLUMNS = {
        ref:       ['denomination', 'reference', 'ref'],
        longueur:  ['longueur', 'l'],
        largeur:   ['largeur', 'w'],
        epaisseur: ['epaisseur', 'e'],
        quantite:  ['quantite', 'qte', 'q'],
        finition:  ['finition', 'finish']
    };

    constructor() {
        this.engine = new EngineHost('worker.js?v=2.0');
        // Identifie le calcul en cours. Retirer le fichier pendant une optimisation
        // laissait arriver l'onComplete du calcul abandonné, qui réaffichait le plan
        // ~1,3 s plus tard — après l'animation de fin.
        this.runToken = 0;
        this.state = {
            currentPanelIndex: 0,
            result: null,
            pieces: [],
            rotationEnabled: true, // Default: Rotation allowed (Sens du fil: Ignoré)
            isOptimizing: false,
            warnings: {} // Keyed warning blocks rendered together in #plan-warning
        };
        
        this.loadingMessages = [
            "Recherche du crayon de touillage… disparu comme d’hab.",
            "Localisation du crayon de touillage : échec critique.",
            "Le crayon de touillage est introuvable. Sa mission : touiller, jamais écrire.",
            "Analyse de l’établi… toujours pas de crayon de touillage.",
            "Synchronisation du crayon de touillage… patientez (longtemps).",
            "Mise à jour du café froid… insérer crayon de touillage.",
            "Scannage atelier : 0 crayon de touillage détecté, 3 bouchons de stylo inutiles.",
            "Activation du crayon de touillage… oh, il était derrière ton oreille.",
            "Calibration du crayon de touillage… viscosité du café confirmée.",
            "Optimisation en cours… sans perdre 2 mm, promis.",
            "Le fil du bois dit non, l’algo dit oui.",
            "Recherche de chutes utiles… aucune trouvée.",
            "On vérifie si ça rentre. Spoiler : non.",
            "Calpinage en cours… on prie pour le sens du décor.",
            "100% numérique, 0% sciure dans les chaussettes.",
            "Analyse en cours… oui, c’est bien du 19 mm.",
            "L’algo ne râle jamais. Dommage qu’il ne ponce pas.",
            "Ça passe ou ça casse… mais ici ça passe.",
            "Découpe virtuelle, doigts réels protégés.",
            "Rotation autorisée… mais pas par le chef d’atelier.",
            "Recherche du panneau parfait… il n’existe pas.",
            "Détection des pièces… même celles que tu as oubliées.",
            "Mise en page mentale… OK. Motivation… non détectée.",
            "Vecteurs alignés, café renversé.",
            "Vérification du plan : largeur et longueur enfin dans le bon ordre.",
            "Gestion des calques… en espérant ne pas perdre le bon.",
            "Trait ultra-fin, cerveau ultra-fatigué.",
            "Le plan avance. Contrairement au chantier.",
            "DXF ouvert. Courage fermé.",
            "Zoom x300 pour retrouver une cote de 12 mm."
        ];
        this.messageInterval = null;
        
        this.els = {
            // Import
            dropZone: document.getElementById('drop-zone'),
            fileInput: document.getElementById('file-upload'),
            fileInfo: document.getElementById('file-info'),
            fileName: document.getElementById('file-name'),
            removeFileBtn: document.getElementById('remove-file'),
            
            // Controls
            optSection: document.getElementById('optimization-controls'),
            grainToggleBtn: document.getElementById('toggle-grain'),
            startBtn: document.getElementById('start-deep-opt'),
            optStatus: document.getElementById('opt-status'),

            // Panel format
            formatPreset: document.getElementById('format-preset'),
            formatCustom: document.getElementById('format-custom'),
            formatWidth: document.getElementById('format-width'),
            formatHeight: document.getElementById('format-height'),
            formatKerf: document.getElementById('format-kerf'),
            formatMinOffcut: document.getElementById('format-min-offcut'),
            formatError: document.getElementById('format-error'),
            planWarning: document.getElementById('plan-warning'),
            
            // Progress / Feedback
            progressBar: document.getElementById('opt-progress'),
            loadingMsg: document.getElementById('loading-message'),
            optIter: document.getElementById('opt-iter'), // Reused for Timer
            optBestPanels: document.getElementById('opt-best-panels'), // Reused for Status
            optBestUtil: document.getElementById('opt-best-util'), // Reused or Hidden
            
            // Results
            resultsSection: document.getElementById('results-section'),
            piecesList: document.getElementById('pieces-list'),
            
            // Visualization
            vizSection: document.getElementById('visualization-section'),
            canvas: document.getElementById('calpinage-canvas'),
            utilRate: document.getElementById('utilization-rate'),
            materialInfo: document.getElementById('material-info'),
            plaqueDims: document.getElementById('plaque-dims'),
            prevBtn: document.getElementById('prev-panel'),
            nextBtn: document.getElementById('next-panel'),
            indicator: document.getElementById('panel-indicator'),
            panelNav: document.getElementById('panel-nav'),
            
            // Export
            exportSection: document.getElementById('export-section'),
            downloadBtn: document.getElementById('download-json'),
            downloadPdfBtn: document.getElementById('download-pdf'),
            downloadDxfBtn: document.getElementById('download-dxf')
        };
    }

    init() {
        this.setupDragDrop();
        this.setupControls();
        this.setupFormatControls();
        this.setupMobileMenu();
        this.setupResizeHandling();
        this.updateGrainButton();
        console.log("CalpiCAD Interface Initialized");
    }

    /**
     * Le canevas est dimensionné une fois au rendu : sans ça, une rotation d'écran ou
     * un redimensionnement de fenêtre le laissait figé à l'ancienne largeur, décalé
     * dans son conteneur. Anti-rebond pour ne pas redessiner à chaque pixel.
     */
    setupResizeHandling() {
        let timer = null;
        window.addEventListener('resize', () => {
            if (!this.state.result) return;
            clearTimeout(timer);
            timer = setTimeout(() => this.renderCanvas(), 150);
        });
    }

    setupMobileMenu() {
        const burger = document.getElementById('burger-menu');
        const nav = document.getElementById('main-nav');
        const links = nav ? nav.querySelectorAll('a') : [];

        if (burger && nav) {
            burger.addEventListener('click', () => {
                burger.classList.toggle('active');
                nav.classList.toggle('nav-open');
                document.body.style.overflow = nav.classList.contains('nav-open') ? 'hidden' : '';
            });

            // Close menu when clicking a link
            links.forEach(link => {
                link.addEventListener('click', () => {
                    burger.classList.remove('active');
                    nav.classList.remove('nav-open');
                    document.body.style.overflow = '';
                });
            });
        }
    }

    /* =========================================
       EVENT HANDLERS
       ========================================= */
    setupDragDrop() {
        const dz = this.els.dropZone;
        if (dz) {
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                dz.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
            });
            dz.addEventListener('drop', (e) => this.handleFiles(e.dataTransfer.files));
        }
        if (this.els.fileInput) {
            this.els.fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));
        }
    }

    setupControls() {
        if (this.els.prevBtn) this.els.prevBtn.addEventListener('click', () => this.nav(-1));
        if (this.els.nextBtn) this.els.nextBtn.addEventListener('click', () => this.nav(1));
        if (this.els.downloadBtn) this.els.downloadBtn.addEventListener('click', () => this.downloadReport());
        if (this.els.downloadPdfBtn) this.els.downloadPdfBtn.addEventListener('click', () => this.downloadPDF());
        if (this.els.downloadDxfBtn) this.els.downloadDxfBtn.addEventListener('click', () => this.downloadDXF());
        if (this.els.removeFileBtn) this.els.removeFileBtn.addEventListener('click', () => this.reset());
        
        if (this.els.startBtn) {
            this.els.startBtn.addEventListener('click', () => {
                if (this.state.isOptimizing) {
                    this.stopOptimization();
                } else {
                    this.startOptimization();
                }
            });
        }

        if (this.els.grainToggleBtn) {
            this.els.grainToggleBtn.addEventListener('click', () => {
                // Toggle allowed only if not optimizing
                if (this.state.isOptimizing) return;
                
                this.state.rotationEnabled = !this.state.rotationEnabled;
                this.updateGrainButton();
            });
        }
        
        // Template download
        const dlTemplate = document.getElementById('download-template-btn');
        if (dlTemplate) dlTemplate.addEventListener('click', window.downloadTemplate);
        const dlTemplateModal = document.getElementById('download-template-modal-btn');
        if (dlTemplateModal) dlTemplateModal.addEventListener('click', window.downloadTemplate);

        // Modals
        this.setupModals();
    }

    /* =========================================
       PANEL FORMAT
       ========================================= */
    setupFormatControls() {
        const { formatPreset, formatWidth, formatHeight, formatKerf } = this.els;
        if (!formatPreset || !formatWidth || !formatHeight) return;

        this.loadPlaqueFormat();

        if (formatKerf) {
            formatKerf.addEventListener('input', () => this.applyKerf());
        }
        if (this.els.formatMinOffcut) {
            this.els.formatMinOffcut.addEventListener('input', () => this.applyMinOffcut());
        }

        formatPreset.addEventListener('change', () => {
            if (formatPreset.value === 'custom') {
                this.toggleCustomFormat(true);
                formatWidth.focus();
                this.applyCustomFormat();
            } else {
                this.toggleCustomFormat(false);
                const [w, h] = formatPreset.value.split('x').map(Number);
                formatWidth.value = w;
                formatHeight.value = h;
                this.setPlaqueFormat(w, h);
            }
        });

        [formatWidth, formatHeight].forEach(input => {
            input.addEventListener('input', () => this.applyCustomFormat());
        });
    }

    /** Restores the last used format (localStorage), falling back to CONFIG defaults. */
    loadPlaqueFormat() {
        const { formatPreset, formatWidth, formatHeight, formatKerf, formatMinOffcut } = this.els;
        let { width, height, kerf } = window.CONFIG.plaque;
        let minOffcutArea = window.CONFIG.algo.minOffcutArea;

        try {
            const saved = JSON.parse(localStorage.getItem('calpicad.plaque'));
            if (saved && this.isValidDimension(saved.width) && this.isValidDimension(saved.height)) {
                width = saved.width;
                height = saved.height;
            }
            if (saved && this.isValidKerf(saved.kerf)) kerf = saved.kerf;
            if (saved && this.isValidMinOffcut(saved.minOffcutArea / 1e6)) minOffcutArea = saved.minOffcutArea;
        } catch (e) {
            // Corrupted or unavailable storage: keep the defaults.
        }

        formatWidth.value = width;
        formatHeight.value = height;
        if (formatKerf) formatKerf.value = kerf;
        if (formatMinOffcut) formatMinOffcut.value = +(minOffcutArea / 1e6).toFixed(3);
        this.setMinOffcutArea(minOffcutArea);

        const preset = `${width}x${height}`;
        const isPreset = [...formatPreset.options].some(o => o.value === preset);
        formatPreset.value = isPreset ? preset : 'custom';
        this.toggleCustomFormat(!isPreset);

        this.setPlaqueFormat(width, height, kerf);
    }

    applyCustomFormat() {
        const w = parseInt(this.els.formatWidth.value, 10);
        const h = parseInt(this.els.formatHeight.value, 10);

        if (!this.isValidDimension(w) || !this.isValidDimension(h)) {
            this.showFormatError(`Dimensions invalides (entre ${UIManager.MIN_DIM} et ${UIManager.MAX_DIM} mm).`);
            return;
        }

        this.showFormatError(null);
        this.setPlaqueFormat(w, h);
    }

    applyKerf() {
        const kerf = parseFloat(this.els.formatKerf.value);

        if (!this.isValidKerf(kerf)) {
            this.showFormatError(`Trait de scie invalide (entre 0 et ${UIManager.MAX_KERF} mm).`);
            return;
        }

        this.showFormatError(null);
        this.setPlaqueFormat(window.CONFIG.plaque.width, window.CONFIG.plaque.height, kerf);
    }

    /** The field is in m² (what a workshop thinks in); the algorithm works in mm². */
    applyMinOffcut() {
        const m2 = parseFloat(this.els.formatMinOffcut.value);

        if (!this.isValidMinOffcut(m2)) {
            this.showFormatError(`Chute minimale invalide (entre 0 et ${UIManager.MAX_MIN_OFFCUT_M2} m²).`);
            return;
        }

        this.showFormatError(null);
        this.setMinOffcutArea(m2 * 1e6);
    }

    setMinOffcutArea(areaMm2) {
        window.CONFIG.algo.minOffcutArea = areaMm2;
        this.saveSettings();
    }

    isValidDimension(value) {
        return Number.isFinite(value) && value >= UIManager.MIN_DIM && value <= UIManager.MAX_DIM;
    }

    isValidKerf(value) {
        return Number.isFinite(value) && value >= 0 && value <= UIManager.MAX_KERF;
    }

    isValidMinOffcut(valueM2) {
        return Number.isFinite(valueM2) && valueM2 >= 0 && valueM2 <= UIManager.MAX_MIN_OFFCUT_M2;
    }

    setPlaqueFormat(width, height, kerf = window.CONFIG.plaque.kerf) {
        window.CONFIG.plaque.width = width;
        window.CONFIG.plaque.height = height;
        window.CONFIG.plaque.kerf = kerf;
        this.saveSettings();
    }

    saveSettings() {
        const { width, height, kerf } = window.CONFIG.plaque;
        try {
            localStorage.setItem('calpicad.plaque', JSON.stringify({
                width, height, kerf,
                minOffcutArea: window.CONFIG.algo.minOffcutArea
            }));
        } catch (e) {
            // Storage unavailable (private mode): the settings still apply for this session.
        }
    }

    toggleCustomFormat(visible) {
        this.els.formatCustom.classList.toggle('visible', visible);
        if (!visible) this.showFormatError(null);
    }

    showFormatError(message) {
        const el = this.els.formatError;
        if (el) {
            el.textContent = message || '';
            el.classList.toggle('visible', Boolean(message));
        }
        // Block the optimization while the format is unusable.
        if (this.els.startBtn && !this.state.isOptimizing) {
            this.els.startBtn.disabled = Boolean(message);
        }
    }

    setFormatControlsDisabled(disabled) {
        [this.els.formatPreset, this.els.formatWidth, this.els.formatHeight, this.els.formatKerf, this.els.formatMinOffcut].forEach(el => {
            if (el) el.disabled = disabled;
        });
    }

    /**
     * Records a warning under `key` (null clears it) and re-renders the banner.
     * Import warnings and optimization warnings coexist, so neither overwrites the other.
     */
    setPlanWarning(key, title, items) {
        if (!title) {
            delete this.state.warnings[key];
        } else {
            this.state.warnings[key] = { title, items: items || [] };
        }
        this.renderPlanWarnings();
    }

    renderPlanWarnings() {
        const el = this.els.planWarning;
        if (!el) return;

        const blocks = Object.values(this.state.warnings);
        if (blocks.length === 0) {
            el.innerHTML = '';
            el.classList.remove('visible');
            return;
        }

        el.innerHTML = blocks.map(b => {
            const list = b.items.length
                ? `<ul>${b.items.map(i => `<li>${this.escapeHtml(i)}</li>`).join('')}</ul>`
                : '';
            return `<strong>${this.escapeHtml(b.title)}</strong>${list}`;
        }).join('');
        el.classList.add('visible');
    }

    escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = String(value);
        return div.innerHTML;
    }

    setupModals() {
        const docLink = document.getElementById('nav-doc');
        const contactLink = document.getElementById('nav-contact');
        const docModal = document.getElementById('doc-modal');
        const contactModal = document.getElementById('contact-modal');
        const closeDoc = document.getElementById('close-doc-modal');
        const closeContact = document.getElementById('close-contact-modal');

        const openModal = (modal) => {
            modal.style.display = 'flex';
            // Force reflow
            void modal.offsetWidth;
            modal.classList.add('visible');
        };

        const closeModal = (modal) => {
            modal.classList.remove('visible');
            setTimeout(() => {
                modal.style.display = 'none';
            }, 300); // Match CSS transition duration
        };

        if(docLink && docModal) {
            docLink.addEventListener('click', (e) => { e.preventDefault(); openModal(docModal); });
        }
        if(contactLink && contactModal) {
            contactLink.addEventListener('click', (e) => { e.preventDefault(); openModal(contactModal); });
        }
        if(closeDoc && docModal) {
            closeDoc.addEventListener('click', () => closeModal(docModal));
        }
        if(closeContact && contactModal) {
            closeContact.addEventListener('click', () => closeModal(contactModal));
        }
        
        // Close on outside click
        window.addEventListener('click', (e) => {
            if (e.target === docModal) closeModal(docModal);
            if (e.target === contactModal) closeModal(contactModal);
        });
    }

    updateGrainButton() {
        const btn = this.els.grainToggleBtn;
        if (!btn) return;
        if (this.state.rotationEnabled) {
            btn.innerHTML = '<span class="icon">↻</span> Sens du fil: Ignoré (Rotation OK)';
            btn.title = "Rotation autorisée";
            btn.classList.remove('restricted');
        } else {
            btn.innerHTML = '<span class="icon">⊘</span> Sens du fil: Respecté (Pas de rotation)';
            btn.title = "Rotation interdite";
            btn.classList.add('restricted');
        }
    }

    /* =========================================
       FILE PROCESSING
       ========================================= */
    handleFiles(files) {
        if (!files || files.length === 0) return;
        const file = files[0];
        
        if (this.els.fileInfo) this.els.fileInfo.style.display = 'flex';
        if (this.els.fileName) this.els.fileName.textContent = file.name;
        if (this.els.dropZone) this.els.dropZone.style.display = 'none';
        
        this.processExcel(file);
    }

    async processExcel(file) {
        if (typeof XLSX === 'undefined') {
            alert("Erreur: Librairie XLSX manquante.");
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
                const pieces = this.normalizeData(jsonData);
                
                if (pieces.length > 0) {
                    this.state.pieces = pieces;
                    this.displayPiecesPreview(pieces);
                    // Show optimization controls
                    if (this.els.optSection) this.els.optSection.style.display = 'block';
                } else {
                    alert('Aucune pièce valide trouvée.');
                }
            } catch (err) {
                console.error(err);
                alert('Erreur lecture fichier.');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    normalizeData(data) {
        const pieces = [];
        const skipped = [];

        // Table d'en-têtes résolue une seule fois. La version précédente refaisait un
        // Object.keys().find() avec toLowerCase() pour chaque colonne ET chaque ligne,
        // ce qui rendait l'import quadratique. sheet_to_json({defval}) donne à toutes
        // les lignes le même jeu de clés, donc la première suffit à les connaître.
        const headers = {};
        for (const key of Object.keys(data[0] || {})) {
            headers[String(key).trim().toLowerCase()] = key;
        }
        const cols = {};
        for (const [field, candidates] of Object.entries(UIManager.COLUMNS)) {
            cols[field] = candidates.map(c => headers[c]).filter(k => k !== undefined);
        }

        const getVal = (row, keys) => {
            for (const key of keys) {
                const v = row[key];
                // On passe au synonyme suivant si la colonne existe mais est vide :
                // un fichier qui a DENOMINATION vide et Ref rempli doit lire Ref.
                if (v !== null && v !== undefined && String(v).trim() !== '') return v;
            }
            return null;
        };

        const parseN = (v) => {
            if (typeof v === 'string') v = v.replace(',', '.').replace(/[^\d.-]/g, '');
            return parseFloat(v) || 0;
        };

        let capped = false;

        data.forEach((row, index) => {
            const rawRef = getVal(row, cols.ref);
            const ref = rawRef !== null ? String(rawRef).trim() : `P-${index}`;
            const l = parseN(getVal(row, cols.longueur));
            const w = parseN(getVal(row, cols.largeur));
            const t = parseN(getVal(row, cols.epaisseur));

            // Finition normalisée : brute, "BLANC", "blanc" et "BLANC " partaient dans
            // trois groupes matière distincts, donc trois jeux de panneaux au lieu d'un.
            const fin = String(getVal(row, cols.finition) ?? '').trim().toUpperCase() || 'STD';

            if (!(l > 0 && w > 0)) {
                // A row with no readable length/width used to vanish without a trace, producing
                // an incomplete plan from a malformed file. Report it instead.
                skipped.push(`Ligne ${index + 2} (${ref}) : longueur/largeur illisible ou nulle`);
                return;
            }

            let qty = Math.floor(parseN(getVal(row, cols.quantite))) || 1;
            if (qty < 1) qty = 1;
            if (qty > UIManager.MAX_QTY_PER_ROW) {
                skipped.push(`Ligne ${index + 2} (${ref}) : quantité ${qty} ramenée à ${UIManager.MAX_QTY_PER_ROW}`);
                qty = UIManager.MAX_QTY_PER_ROW;
            }
            if (pieces.length + qty > UIManager.MAX_TOTAL_PIECES) {
                qty = Math.max(0, UIManager.MAX_TOTAL_PIECES - pieces.length);
                capped = true;
            }

            for (let i = 0; i < qty; i++) {
                // L'index de ligne entre dans l'id : deux lignes de même référence
                // produisaient des identifiants en double.
                pieces.push({ id: `${ref}-${index}-${i}`, reference: ref, longueur: l, largeur: w, epaisseur: t, finition: fin });
            }
        });

        if (capped) {
            skipped.push(`Total plafonné à ${UIManager.MAX_TOTAL_PIECES} pièces : la fin du fichier a été tronquée`);
        }

        this.setPlanWarning(
            'import',
            skipped.length > 0 ? `${skipped.length} ligne(s) du fichier ont été ignorées ou corrigées :` : null,
            skipped
        );

        return pieces;
    }

    displayPiecesPreview(pieces) {
        // Display list of detected pieces immediately (User requested "Results" hidden, but usually preview is fine. 
        // Actually, the user said "Interdiction d'affichage des résultats avant optimisation complète".
        // This usually refers to the optimization *outcome* (panels), not the input list.
        // I'll show the input list as "Pieces Detected" but hide the Visualization/Export sections.)
        
        if (!this.els.piecesList) return;
        this.els.piecesList.innerHTML = '';
        const displayMap = {};
        pieces.forEach(p => {
            const k = `${p.reference}|${p.longueur}x${p.largeur}`;
            if(!displayMap[k]) displayMap[k] = { ...p, count: 0 };
            displayMap[k].count++;
        });
        // textContent et non innerHTML : le fichier Excel est une source non fiable, et
        // une DENOMINATION contenant du HTML s'exécutait dans la page. Fragment unique
        // pour ne pas relayouter à chaque ligne.
        const rows = document.createDocumentFragment();
        Object.values(displayMap).forEach(p => {
            const tr = document.createElement('tr');
            [p.reference, p.longueur, p.largeur, p.epaisseur, p.count, p.finition].forEach(value => {
                const td = document.createElement('td');
                td.textContent = value;
                tr.appendChild(td);
            });
            rows.appendChild(tr);
        });
        this.els.piecesList.appendChild(rows);
        
        if (this.els.resultsSection) this.els.resultsSection.style.display = 'block';
        // Hide result-dependent sections
        if (this.els.vizSection) this.els.vizSection.style.display = 'none';
        if (this.els.exportSection) this.els.exportSection.style.display = 'none';
    }

    /* =========================================
       OPTIMIZATION FLOW
       ========================================= */
    startOptimization() {
        if (this.state.pieces.length === 0) return;

        const token = ++this.runToken;
        this.state.isOptimizing = true;
        this.state.result = null;

        // UI Updates for Running State
        this.els.startBtn.innerHTML = '<span class="icon">⏹</span> Arrêter';
        this.els.startBtn.classList.add('danger');
        this.els.optStatus.textContent = "Calcul en cours...";
        this.els.optStatus.classList.add('running');
        this.els.grainToggleBtn.disabled = true;
        this.setFormatControlsDisabled(true);

        // Hide previous results
        this.els.vizSection.style.display = 'none';
        this.els.exportSection.style.display = 'none';
        this.setPlanWarning('unplaced', null);
        
        // Init Stats Display
        if (this.els.progressBar) {
            this.els.progressBar.style.width = '0%';
            this.els.progressBar.classList.remove('gold-finish');
        }
        if (this.els.optIter) this.els.optIter.textContent = "1:00"; // Timer start
        if (this.els.optBestPanels) this.els.optBestPanels.textContent = "0%"; // Progress text
        if (this.els.optBestUtil) this.els.optBestUtil.textContent = "-";

        // IMPORTANT: The user wants "Interdiction d'affichage des résultats avant optimisation complète"
        // So we do NOT show intermediate panels in the visualization area.

        this.startMessageCycle();

        const grainEnabled = !this.state.rotationEnabled; // If rotation enabled, grain is NOT respected (false)

        this.engine.start(
            this.state.pieces,
            { ...window.CONFIG.plaque },
            {
                grainEnabled: grainEnabled,
                // Le worker a sa propre copie de CONFIG : le seuil réglé dans
                // l'interface doit voyager avec la demande, pas via le global.
                minOffcutArea: window.CONFIG.algo.minOffcutArea
            },
            // Le jeton écarte les retours d'un calcul abandonné entre-temps.
            (progress) => { if (token === this.runToken) this.onProgress(progress); },
            (result) => { if (token === this.runToken) this.onComplete(result, token); }
        );
    }

    stopOptimization() {
        this.engine.stop();
        this.stopMessageCycle();
        // UI will be reset in onComplete which is called even on stop
    }

    startMessageCycle() {
        if (!this.els.loadingMsg) return;
        
        const showNextMessage = () => {
            // Random message from the list
            const msg = this.loadingMessages[Math.floor(Math.random() * this.loadingMessages.length)];
            
            // Fade out
            this.els.loadingMsg.style.opacity = '0';
            
            setTimeout(() => {
                this.els.loadingMsg.textContent = msg;
                // Fade in
                this.els.loadingMsg.style.opacity = '1';
            }, 500);
        };

        // Initial message
        showNextMessage();

        // Cycle every 5 seconds
        this.messageInterval = setInterval(showNextMessage, 5000);
    }

    stopMessageCycle() {
        if (this.messageInterval) {
            clearInterval(this.messageInterval);
            this.messageInterval = null;
        }
        if (this.els.loadingMsg) {
            this.els.loadingMsg.textContent = "";
        }
    }

    onProgress(data) {
        // Update Progress Bar
        if (this.els.progressBar) {
            this.els.progressBar.style.width = `${data.percent}%`;
        }
        
        // Update Timer (timeLeft is in ms)
        const secondsLeft = Math.ceil(data.timeLeft / 1000);
        const mins = Math.floor(secondsLeft / 60);
        const secs = secondsLeft % 60;
        const timerText = `${mins}:${secs.toString().padStart(2, '0')}`;
        
        if (this.els.optIter) {
            this.els.optIter.parentElement.querySelector('.label').textContent = "Temps Restant";
            this.els.optIter.textContent = timerText;
        }

        if (this.els.optBestPanels) {
            this.els.optBestPanels.parentElement.querySelector('.label').textContent = "Progression";
            this.els.optBestPanels.textContent = `${Math.round(data.percent)}%`;
        }
    }

    /** Rend la main à l'utilisateur : bouton, badge et réglages de format. */
    _resetRunUi() {
        this.state.isOptimizing = false;
        this.stopMessageCycle();
        this.els.startBtn.innerHTML = '<span class="icon">⚡</span> Lancer l\'Optimisation';
        this.els.startBtn.classList.remove('danger');
        this.els.optStatus.classList.remove('running');
        this.els.grainToggleBtn.disabled = false;
        this.setFormatControlsDisabled(false);
    }

    onComplete(result, token) {
        if (token !== this.runToken) return;

        // Le worker n'a pas pu mener le calcul à terme : on débloque l'interface au
        // lieu de la laisser tourner sur une optimisation morte.
        if (!result) {
            this._resetRunUi();
            this.els.optStatus.textContent = "Échec";
            alert("L'optimisation a échoué. Voir la console pour le détail.");
            return;
        }

        console.log("Optimization Complete.", result.stats);
        // Snapshot the format used, so changing it afterwards doesn't rescale an existing plan.
        result.plaque = { ...window.CONFIG.plaque };
        this.state.result = result;

        // 1. Trigger Visual Completion
        if (this.els.progressBar) this.els.progressBar.style.width = '100%';
        if (this.els.optBestPanels) this.els.optBestPanels.textContent = "100%";
        
        // Update status immediately to indicate finishing phase
        this.els.optStatus.textContent = "Finalisation...";

        // 2. Animation Sequence
        const finalize = () => {
            // L'animation dure 1,3 s, pendant lesquelles l'utilisateur peut avoir retiré
            // le fichier : sans ce test, le plan abandonné réapparaissait à l'écran.
            if (token !== this.runToken) return;

            // Le drapeau ne tombe qu'ici, avec le libellé du bouton. Le remettre à faux
            // dès l'arrivée du résultat ouvrait une fenêtre de 1,3 s où le bouton
            // affichait « Arrêter » mais relançait un second calcul.
            this._resetRunUi();

            // Set success message
            if (this.els.loadingMsg) {
                this.els.loadingMsg.textContent = "Chargement fini, merci de scroller";
                this.els.loadingMsg.style.opacity = '1';
                this.els.loadingMsg.style.color = 'var(--accent-highlight)';
            }

            this.els.optStatus.textContent = "Terminé";

            // Pieces that fit no panel at all must be called out: they are absent from the plan.
            const unplaced = result.unplaced || [];
            const plaque = result.plaque;
            this.setPlanWarning(
                'unplaced',
                unplaced.length > 0
                    ? `${unplaced.length} pièce(s) ne rentrent pas dans un panneau de ${plaque.width} × ${plaque.height} mm et sont absentes du plan :`
                    : null,
                [...new Set(unplaced.map(p => `${p.reference} — ${p.longueur} × ${p.largeur} mm`))]
            );

            // Show Results
            this.state.currentPanelIndex = 0;
            this.updateView();
            
            // Restore Labels
            if (this.els.optIter) this.els.optIter.parentElement.querySelector('.label').textContent = "Itérations";
            if (this.els.optBestPanels) this.els.optBestPanels.parentElement.querySelector('.label').textContent = "Meilleure Solution";
            
            // Update final stats
            // Le moteur remonte désormais son compteur : la case « Itérations » affichait
            // un tiret depuis toujours faute de valeur à y mettre.
            if (this.els.optIter) this.els.optIter.textContent = (result.stats.iterations ?? '-').toLocaleString('fr-FR');
            if (this.els.optBestPanels) this.els.optBestPanels.textContent = result.stats.totalPanels;
            if (this.els.optBestUtil) this.els.optBestUtil.textContent = result.stats.globalUtilization.toFixed(1) + '%';
        };

        if (this.els.progressBar) {
            // Step 1: Allow width transition to progress (match CSS transition time ~600ms)
            // We trigger gold effect slightly before end for smooth blend
            setTimeout(() => {
                this.els.progressBar.classList.add('gold-finish');
                
                // Step 2: Allow user to enjoy the gold finish (ASMR delay)
                setTimeout(() => {
                    finalize();
                }, 800); // 0.8s gold glory
                
            }, 500);
        } else {
            finalize();
        }
    }

    /* =========================================
       RENDERING
       ========================================= */
    updateView() {
        if (!this.state.result || this.state.result.panels.length === 0) return;
        
        this.els.vizSection.style.display = 'block';
        this.els.exportSection.style.display = 'block';
        
        if (this.els.panelNav) {
            this.els.panelNav.style.display = this.state.result.panels.length > 1 ? 'flex' : 'none';
        }

        this.renderStats();
        
        // Wait for DOM update to ensure container has width
        requestAnimationFrame(() => {
            this.renderCanvas();
        });
    }

    nav(dir) {
        const max = this.state.result.panels.length - 1;
        let newIdx = this.state.currentPanelIndex + dir;
        if (newIdx < 0) newIdx = 0;
        if (newIdx > max) newIdx = max;
        this.state.currentPanelIndex = newIdx;
        this.updateView();
    }

    renderStats() {
        const panel = this.state.result.panels[this.state.currentPanelIndex];
        const total = this.state.result.panels.length;
        if (this.els.indicator) this.els.indicator.textContent = `PANNEAU ${this.state.currentPanelIndex + 1} / ${total}`;
        if (this.els.prevBtn) this.els.prevBtn.disabled = this.state.currentPanelIndex === 0;
        if (this.els.nextBtn) this.els.nextBtn.disabled = this.state.currentPanelIndex === total - 1;
        
        const plaque = this.state.result.plaque || window.CONFIG.plaque;
        if(this.els.plaqueDims) this.els.plaqueDims.textContent = `PLAQUE: ${plaque.width}x${plaque.height}mm`;
        if(this.els.materialInfo) this.els.materialInfo.textContent = `${panel.material.thickness}mm - ${panel.material.finish}`;
        
        const waste = panel.waste / 1000000; // m2
        const util = panel.utilization.toFixed(1);
        if (this.els.utilRate) this.els.utilRate.textContent = `UTILISATION: ${util}% | PERTE: ${waste.toFixed(2)}m²`;
    }

    renderCanvas() {
        if(!this.state.result) return;
        const canvas = this.els.canvas;
        const ctx = canvas.getContext('2d');
        const panel = this.state.result.panels[this.state.currentPanelIndex];
        const plaque = this.state.result.plaque || window.CONFIG.plaque;
        const colors = window.CONFIG.colors;
        const isMobile = window.innerWidth <= 768;

        // Auto-scale
        const cssWidth = Math.max(1, this.els.vizSection.clientWidth - 40);
        const scale = cssWidth / plaque.width;
        const cssHeight = plaque.height * scale;

        // Le canevas était dimensionné en pixels CSS : sur un écran à forte densité
        // tout sortait à la moitié ou au tiers de la résolution native, d'où le flou —
        // et d'où les polices de 3 px qu'on avait fini par mettre sur mobile pour
        // compenser. On dessine dans le repère CSS et ctx.scale absorbe la densité.
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        ctx.clearRect(0, 0, cssWidth, cssHeight);

        // 1. Background
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, cssWidth, cssHeight);

        // 2. Offcuts
        if (panel.offcuts) {
            panel.offcuts.forEach(r => {
                ctx.fillStyle = colors.offcut;
                ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
                ctx.strokeStyle = colors.offcutBorder;
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 5]);
                ctx.strokeRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
                ctx.setLineDash([]);
                
                // Seuils en pixels écran et non en mm : c'est la place réellement
                // disponible qui décide si la cote est lisible, pas la taille de la chute.
                const labelFs = isMobile ? 9 : 14;
                const drawnW = r.w * scale;
                const drawnH = r.h * scale;

                if (drawnW > labelFs * 4 && drawnH > labelFs * 1.8) {
                    ctx.fillStyle = '#FFFFFF'; // High contrast
                    ctx.font = `${labelFs}px sans-serif`;
                    
                    // Fix truncation: Use top baseline and add padding to "lower" the text into the box
                    ctx.textBaseline = 'top'; 
                    ctx.textAlign = 'left';
                    
                    const padding = 3; // Reduced padding to move text closer to corner
                    ctx.fillText(`${Math.round(r.w)}x${Math.round(r.h)}`, r.x * scale + padding, r.y * scale + padding);
                }
            });
        }

        // 2b. Waste: leftovers below the reuse threshold. Painted with hatching so every part
        // of the panel is visibly accounted for — a bare area used to look like a rendering bug.
        if (panel.wasteRects) {
            panel.wasteRects.forEach(r => {
                const x = r.x * scale, y = r.y * scale, w = r.w * scale, h = r.h * scale;
                ctx.fillStyle = colors.waste;
                ctx.fillRect(x, y, w, h);

                ctx.save();
                ctx.beginPath();
                ctx.rect(x, y, w, h);
                ctx.clip();
                ctx.strokeStyle = colors.wasteBorder;
                ctx.lineWidth = 1;
                const step = 8;
                for (let d = -h; d < w; d += step) {
                    ctx.beginPath();
                    ctx.moveTo(x + d, y + h);
                    ctx.lineTo(x + d + h, y);
                    ctx.stroke();
                }
                ctx.restore();

                ctx.strokeStyle = colors.wasteBorder;
                ctx.lineWidth = 1;
                ctx.strokeRect(x, y, w, h);
            });
        }

        // 3. Pieces
        panel.pieces.forEach(p => {
            const x = p.x * scale;
            const y = p.y * scale;
            const w = p.width * scale;
            const h = p.height * scale;

            ctx.fillStyle = colors.piece; 
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = colors.pieceBorder;
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, w, h);

            // Text Rendering with smart scaling and truncation
            const minPieceW = isMobile ? 34 : 40;
            const minPieceH = isMobile ? 24 : 25;

            if(w > minPieceW && h > minPieceH) {
                ctx.fillStyle = colors.text;

                // 1. Calculate Constraints
                const padding = isMobile ? 3 : 5;
                const maxWidth = w - (padding * 2);

                // 2. Initial Font Size Calculation
                // Le canevas est maintenant rendu à la densité réelle de l'écran, donc
                // une taille en pixels CSS est enfin une taille lisible : plus besoin
                // des 6 px / 4 px qui compensaient le sous-échantillonnage.
                let fs = isMobile ? 11 : 20;
                const minFs = isMobile ? 7 : 10;

                ctx.font = `600 ${fs}px sans-serif`;
                
                // 3. Adaptive Scaling & Truncation
                let textToDraw = p.ref;
                let textWidth = ctx.measureText(textToDraw).width;
                
                // If text is too wide, try reducing font size first (down to minFs)
                while (textWidth > maxWidth && fs > minFs) {
                    fs -= 0.5;
                    ctx.font = `600 ${fs}px sans-serif`;
                    textWidth = ctx.measureText(textToDraw).width;
                }
                
                // If still too wide after shrinking font, truncate with ellipsis
                if (textWidth > maxWidth) {
                    const ellipsis = '..';
                    while (textToDraw.length > 0 && ctx.measureText(textToDraw + ellipsis).width > maxWidth) {
                        textToDraw = textToDraw.slice(0, -1);
                    }
                    textToDraw += ellipsis;
                }

                // 4. Positioning & Drawing
                let textX, textY;

                if (isMobile) {
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'top';
                    textX = x + padding;
                    textY = y + padding;
                    
                    ctx.fillText(textToDraw, textX, textY);
                    
                    // Secondary Text (Dimensions)
                    const secondaryFs = Math.max(8, fs * 0.85);
                    const dimY = textY + fs + 2;
                    
                    // Ensure enough height remains for dimensions
                    if (h > (dimY - y) + secondaryFs) {
                        ctx.fillStyle = '#AAA'; // Secondary color
                        ctx.font = `400 ${secondaryFs}px sans-serif`;
                        
                        let dimText = `${Math.round(p.width)}x${Math.round(p.height)}${p.rotation===90?' ↻':''}`;
                        // Check if dimensions fit, otherwise simplify
                        if (ctx.measureText(dimText).width > maxWidth) {
                             dimText = `${Math.round(p.width)}x${Math.round(p.height)}`;
                        }
                        // Only draw if it fits now
                        if (ctx.measureText(dimText).width <= maxWidth) {
                            ctx.fillText(dimText, textX, dimY);
                        }
                    }

                } else {
                    // Desktop Centered
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    textX = x + w/2;
                    
                    // Vertical centering calculation
                    const secondaryFs = Math.max(10, fs * 0.8);
                    const totalContentHeight = fs + secondaryFs + 4; // text + gap + dims
                    const startY = y + (h - totalContentHeight) / 2;

                    // Draw Name (top half of center)
                    ctx.textBaseline = 'top';
                    ctx.fillText(textToDraw, textX, startY);
                    
                    // Draw Dimensions (bottom half)
                    ctx.fillStyle = '#AAA';
                    ctx.font = `400 ${secondaryFs}px sans-serif`;
                    ctx.fillText(`${Math.round(p.width)}x${Math.round(p.height)}${p.rotation===90?' ↻':''}`, textX, startY + fs + 4);
                }
            }
        });
    }
    
    reset() {
        this.stopOptimization();
        // Invalide le calcul en vol : son onComplete (et l'animation de 1,3 s qui le
        // suit) doit être ignoré, sinon le plan du fichier qu'on vient de retirer
        // revenait s'afficher tout seul.
        this.runToken++;
        this.state = { pieces: [], currentPanelIndex: 0, result: null, rotationEnabled: this.state.rotationEnabled, isOptimizing: false, warnings: {} };
        this._resetRunUi();
        this.els.optStatus.textContent = "Prêt";
        if (this.els.progressBar) {
            this.els.progressBar.style.width = '0%';
            this.els.progressBar.classList.remove('gold-finish');
        }
        this.renderPlanWarnings();
        if (this.els.fileInput) this.els.fileInput.value = '';
        if (this.els.dropZone) this.els.dropZone.style.display = 'block';
        if (this.els.fileInfo) this.els.fileInfo.style.display = 'none';
        if (this.els.resultsSection) this.els.resultsSection.style.display = 'none';
        if (this.els.vizSection) this.els.vizSection.style.display = 'none';
        if (this.els.optSection) this.els.optSection.style.display = 'none';
        if (this.els.panelNav) this.els.panelNav.style.display = 'none';
        if (this.els.exportSection) this.els.exportSection.style.display = 'none';
    }
    
    /**
     * Hachures à 45° découpées analytiquement aux bords du rectangle.
     * jsPDF n'a pas de masque de découpe simple, et une diagonale qui dépasse vient
     * salir la pièce voisine. La droite est paramétrée par t, on ne garde que
     * l'intervalle de t qui reste dans la boîte.
     */
    _pdfHatch(doc, x, y, w, h, step) {
        for (let d = -h; d < w; d += step) {
            const t0 = Math.max(0, -d);
            const t1 = Math.min(h, w - d);
            if (t1 <= t0) continue;
            doc.line(x + d + t0, y + h - t0, x + d + t1, y + h - t1);
        }
    }

    /**
     * Écrit un libellé centré (nom + cotes) dans un rectangle, coordonnées en mm.
     *
     * Les deux lignes doivent tenir en LARGEUR comme en HAUTEUR : ne calibrer que la
     * largeur laissait une pièce longue et plate garder une police énorme qui débordait
     * verticalement. Si les cotes ne rentrent pas, on garde le nom seul.
     */
    _pdfLabel(doc, rectX, rectY, rectW, rectH, name, dims) {
        const PT_MM = 25.4 / 72; // jsPDF dimensionne les polices en points, le plan en mm
        const MIN_PT = 4.5;
        const MAX_PT = 10;
        const pad = 1;
        const gap = 0.6;

        const maxW = rectW - pad * 2;
        const maxH = rectH - pad * 2;
        if (maxW <= 1 || maxH <= 1 || !name) return;

        const C = UIManager.PDF_COLORS;

        const fit = (text, style, capPt) => {
            let pt = Math.min(MAX_PT, capPt);
            while (pt > MIN_PT) {
                doc.setFont('helvetica', style);
                doc.setFontSize(pt);
                if (doc.getTextWidth(text) <= maxW) break;
                pt -= 0.25;
            }
            return pt;
        };

        // Mesure avec la police courante : à appeler après fit().
        const truncate = (text) => {
            if (doc.getTextWidth(text) <= maxW) return text;
            let cut = text;
            while (cut.length > 1 && doc.getTextWidth(cut + '..') > maxW) cut = cut.slice(0, -1);
            return cut + '..';
        };

        const cx = rectX + rectW / 2;
        const cy = rectY + rectH / 2;

        // Deux lignes = namePt + 0,75 x namePt en points, plus l'interligne en mm.
        const twoLineCapPt = (maxH - gap) / (1.75 * PT_MM);

        if (dims && twoLineCapPt >= MIN_PT) {
            const namePt = fit(name, 'bold', twoLineCapPt);
            const dimPt = Math.max(MIN_PT, namePt * 0.75);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(dimPt);
            if (doc.getTextWidth(dims) <= maxW) {
                const nameH = namePt * PT_MM;
                const dimH = dimPt * PT_MM;
                const top = cy - (nameH + gap + dimH) / 2;

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(namePt);
                doc.setTextColor(C.text[0], C.text[1], C.text[2]);
                doc.text(truncate(name), cx, top, { align: 'center', baseline: 'top' });

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(dimPt);
                doc.setTextColor(C.textDim[0], C.textDim[1], C.textDim[2]);
                doc.text(dims, cx, top + nameH + gap, { align: 'center', baseline: 'top' });
                return;
            }
        }

        // Pas la place pour deux lignes : le nom seul, calibré sur ce qui reste.
        const soloPt = fit(name, 'bold', maxH / PT_MM);
        if (soloPt * PT_MM > maxH) return;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(soloPt);
        doc.setTextColor(C.text[0], C.text[1], C.text[2]);
        doc.text(truncate(name), cx, cy, { align: 'center', baseline: 'middle' });
    }

    /** Légende de bas de page, alignée sur celle du rendu 2D. */
    _pdfLegend(doc, x, y) {
        const C = UIManager.PDF_COLORS;
        const items = [
            [C.piece, C.pieceLine, 'Pièce'],
            [C.offcut, C.offcutLine, 'Chute réutilisable'],
            [C.waste, C.wasteLine, 'Perte (sous le seuil)']
        ];
        const box = 3.4;
        let cursor = x;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setLineWidth(0.2);

        items.forEach(([fill, line, label]) => {
            doc.setFillColor(fill[0], fill[1], fill[2]);
            doc.setDrawColor(line[0], line[1], line[2]);
            doc.rect(cursor, y, box, box, 'FD');
            doc.setTextColor(C.textDim[0], C.textDim[1], C.textDim[2]);
            doc.text(label, cursor + box + 1.6, y + box - 0.6);
            cursor += box + 1.6 + doc.getTextWidth(label) + 6;
        });
    }

    /**
     * Plan de découpe au format PDF VECTORIEL.
     *
     * La version précédente rastérisait chaque panneau dans un canevas de 2000 px puis
     * l'injectait en PNG base64 : plusieurs Mo par page, donc des fichiers de dizaines
     * de Mo pour un plan de dix panneaux, flous dès qu'on zoome et sans texte
     * sélectionnable. Tout est tracé ici en primitives jsPDF — quelques Ko, net à
     * n'importe quel zoom, et les repères sont cherchables dans le lecteur.
     *
     * Les chutes et les pertes sont dessinées elles aussi : l'écran les annonçait dans
     * sa légende, le PDF ne montrait que les pièces.
     */
    downloadPDF() {
        if (!this.state.result) return;
        if (!window.jspdf) { alert("PDF Lib missing"); return; }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const C = UIManager.PDF_COLORS;
        const panels = this.state.result.panels;
        const plaque = this.state.result.plaque || window.CONFIG.plaque;

        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 10;
        const headerH = 28; // titre + deux lignes de détails
        const footerH = 12; // légende

        const availW = pageW - margin * 2;
        const availH = pageH - headerH - footerH - margin;
        const scale = Math.min(availW / plaque.width, availH / plaque.height);
        const drawW = plaque.width * scale;
        const drawH = plaque.height * scale;
        const ox = (pageW - drawW) / 2;
        const oy = headerH;

        panels.forEach((panel, i) => {
            if (i > 0) doc.addPage();

            // --- Cartouche ---
            doc.setTextColor(C.text[0], C.text[1], C.text[2]);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(15);
            doc.text(`Panneau ${i + 1}/${panels.length}`, margin, 13);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9.5);
            doc.text(
                `Format : ${plaque.width} x ${plaque.height} mm  -  ${panel.material.thickness}mm ${panel.material.finish}`
                + `  -  Util : ${panel.utilization.toFixed(1)}%`,
                margin, 18.5
            );

            const offcuts = panel.offcuts || [];
            const biggest = offcuts.reduce((max, o) => Math.max(max, o.area || 0), 0);
            doc.setTextColor(C.textDim[0], C.textDim[1], C.textDim[2]);
            doc.setFontSize(9);
            doc.text([
                `Trait de scie : ${plaque.kerf ?? 0} mm`,
                `${panel.pieces.length} pièce(s)`,
                `${panel.cutCount || 0} coupe(s)`,
                `Chutes : ${offcuts.length}${biggest > 0 ? ` (max ${(biggest / 1e6).toFixed(2)} m²)` : ''}`
            ].join('   -   '), margin, 23.5);

            // --- Contour de la plaque ---
            doc.setFillColor(255, 255, 255);
            doc.setDrawColor(C.panelLine[0], C.panelLine[1], C.panelLine[2]);
            doc.setLineWidth(0.5);
            doc.rect(ox, oy, drawW, drawH, 'FD');

            // --- Chutes réutilisables ---
            offcuts.forEach(r => {
                const x = ox + r.x * scale, y = oy + r.y * scale;
                const w = r.w * scale, h = r.h * scale;
                doc.setFillColor(C.offcut[0], C.offcut[1], C.offcut[2]);
                doc.setDrawColor(C.offcutLine[0], C.offcutLine[1], C.offcutLine[2]);
                doc.setLineWidth(0.2);
                doc.rect(x, y, w, h, 'FD');
                this._pdfLabel(doc, x, y, w, h, `${Math.round(r.w)} x ${Math.round(r.h)}`, '');
            });

            // --- Pertes sous le seuil, hachurées comme à l'écran ---
            (panel.wasteRects || []).forEach(r => {
                const x = ox + r.x * scale, y = oy + r.y * scale;
                const w = r.w * scale, h = r.h * scale;
                doc.setFillColor(C.waste[0], C.waste[1], C.waste[2]);
                doc.setDrawColor(C.wasteLine[0], C.wasteLine[1], C.wasteLine[2]);
                doc.setLineWidth(0.2);
                doc.rect(x, y, w, h, 'FD');
                doc.setLineWidth(0.08);
                this._pdfHatch(doc, x, y, w, h, 1.6);
            });

            // --- Pièces ---
            panel.pieces.forEach(p => {
                const x = ox + p.x * scale, y = oy + p.y * scale;
                const w = p.width * scale, h = p.height * scale;
                doc.setFillColor(C.piece[0], C.piece[1], C.piece[2]);
                doc.setDrawColor(C.pieceLine[0], C.pieceLine[1], C.pieceLine[2]);
                doc.setLineWidth(0.25);
                doc.rect(x, y, w, h, 'FD');
                this._pdfLabel(
                    doc, x, y, w, h,
                    String(p.ref ?? ''),
                    `${Math.round(p.width)} x ${Math.round(p.height)}${p.rotation === 90 ? ' (pivote)' : ''}`
                );
            });

            this._pdfLegend(doc, margin, pageH - footerH + 3);
        });

        doc.save('calpinage_result.pdf');
    }

    downloadDXF() {
        if (!this.state.result) return;
        if (!window.DxfExporter) { alert("Module DXF manquant"); return; }

        const dxf = window.DxfExporter.build(this.state.result);
        const blob = new Blob([dxf], { type: 'application/dxf' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `calpinage.dxf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }

    downloadReport() {
        if(!this.state.result) return;
        const blob = new Blob([JSON.stringify(this.state.result, null, 2)], {type: 'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `calpinage_export.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // L'URL d'objet retenait le blob pour toute la durée de vie de la page :
        // un export répété gardait autant de copies du résultat en mémoire.
        URL.revokeObjectURL(a.href);
    }
}

// Bootstrap
window.downloadTemplate = function() {
    if (typeof XLSX === 'undefined') {
        alert("Erreur: La librairie XLSX n'est pas chargée.");
        return;
    }
    const data = [{ "DENOMINATION": "Exemple", "LONGUEUR": 800, "LARGEUR": 400, "EPAISSEUR": 19, "QUANTITE": 5, "FINITION": "BLANC" }];
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Modele");
    const wbout = XLSX.write(wb, {bookType:'xlsx', type:'array'});
    const blob = new Blob([wbout], {type:"application/octet-stream"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "gabarit.xlsx";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

document.addEventListener('DOMContentLoaded', () => {
    window.app = {
        ui: new UIManager()
    };
    window.app.ui.init();
});
