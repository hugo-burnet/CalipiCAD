/**
 * CalpiCAD - Interface Manager (interface.js)
 * Responsibilities:
 * - DOM Manipulation
 * - Event Handling
 * - Visualization (Canvas)
 * - User Feedback (Timer, Progress)
 * - Bridge to OptimizerEngine
 */

class UIManager {
    // Panel dimension bounds, in mm.
    static MIN_DIM = 1;
    static MAX_DIM = 20000;
    // Saw blade width, in mm.
    static MAX_KERF = 50;
    // Reuse threshold for an offcut, in m².
    static MAX_MIN_OFFCUT_M2 = 10;

    constructor() {
        this.engine = new window.OptimizerEngine();
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
        this.updateGrainButton();
        console.log("CalpiCAD Interface Initialized");
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
        data.forEach((row, index) => {
             const getVal = (keys) => {
                 for(let k of keys) {
                     const found = Object.keys(row).find(rk => rk.toLowerCase() === k.toLowerCase());
                     if(found) return row[found];
                 }
                 return null;
             };
             const parseN = (v) => {
                 if(typeof v === 'string') v = v.replace(',', '.').replace(/[^\d.-]/g, '');
                 return parseFloat(v) || 0;
             }

             const ref = getVal(['DENOMINATION', 'Reference', 'Ref']) || `P-${index}`;
             const l = parseN(getVal(['LONGUEUR', 'L']));
             const w = parseN(getVal(['LARGEUR', 'W']));
             const t = parseN(getVal(['EPAISSEUR', 'Epaisseur', 'E']));
             const qty = parseInt(parseN(getVal(['QUANTITE', 'Qte', 'Q']))) || 1;
             const fin = getVal(['FINITION', 'Finish']) || 'Std';

             if(l>0 && w>0 && qty>0) {
                 for(let i=0; i<qty; i++) {
                     pieces.push({ id: `${ref}-${i}`, reference: ref, longueur: l, largeur: w, epaisseur: t, finition: fin });
                 }
             } else {
                 // A row with no readable length/width used to vanish without a trace, producing
                 // an incomplete plan from a malformed file. Report it instead.
                 skipped.push(`Ligne ${index + 2} (${ref}) : longueur/largeur illisible ou nulle`);
             }
        });

        this.setPlanWarning(
            'import',
            skipped.length > 0 ? `${skipped.length} ligne(s) du fichier ont été ignorées :` : null,
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
        Object.values(displayMap).forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${p.reference}</td><td>${p.longueur}</td><td>${p.largeur}</td><td>${p.epaisseur}</td><td>${p.count}</td><td>${p.finition}</td>`;
            this.els.piecesList.appendChild(tr);
        });
        
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
            window.CONFIG.plaque,
            { grainEnabled: grainEnabled },
            (progress) => this.onProgress(progress),
            (result) => this.onComplete(result)
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

    onComplete(result) {
        console.log("Optimization Complete. Result:", result);
        this.state.isOptimizing = false;
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
            this.stopMessageCycle();
            
            // Set success message
            if (this.els.loadingMsg) {
                this.els.loadingMsg.textContent = "Chargement fini, merci de scroller";
                this.els.loadingMsg.style.opacity = '1';
                this.els.loadingMsg.style.color = 'var(--accent-highlight)';
            }
            
            // Reset UI Controls
            this.els.startBtn.innerHTML = '<span class="icon">⚡</span> Lancer l\'Optimisation';
            this.els.startBtn.classList.remove('danger');
            this.els.optStatus.textContent = "Terminé";
            this.els.optStatus.classList.remove('running');
            this.els.grainToggleBtn.disabled = false;
            this.setFormatControlsDisabled(false);

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
            if (this.els.optIter) this.els.optIter.textContent = "-";
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
        const containerW = this.els.vizSection.clientWidth - 40;
        const scale = containerW / plaque.width;

        canvas.width = plaque.width * scale;
        canvas.height = plaque.height * scale;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 1. Background
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

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
                
                const minOffcutW = isMobile ? 150 : 200;
                const minOffcutH = isMobile ? 80 : 100;

                if (r.w > minOffcutW && r.h > minOffcutH) {
                    ctx.fillStyle = '#FFFFFF'; // High contrast
                    // Mobile: 3px (Reduced again), Desktop: 14px
                    ctx.font = isMobile ? `3px sans-serif` : `14px sans-serif`;
                    
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
            const minPieceW = isMobile ? 30 : 40;
            const minPieceH = isMobile ? 20 : 25; 

            if(w > minPieceW && h > minPieceH) {
                ctx.fillStyle = colors.text;
                
                // 1. Calculate Constraints
                const padding = isMobile ? 3 : 5;
                const maxWidth = w - (padding * 2);
                
                // 2. Initial Font Size Calculation
                // Mobile: Max 6px (50% of 11px), desktop max 20px. 
                let baseFs = isMobile ? 6 : 20;
                
                // Heuristic: scale down if name is very long relative to width
                // But don't go below minFs yet
                let fs = baseFs;
                const minFs = isMobile ? 4 : 10;

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
                    const secondaryFs = Math.max(isMobile ? 4 : 7, fs * 0.85);
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
        this.state = { pieces: [], currentPanelIndex: 0, result: null, rotationEnabled: this.state.rotationEnabled, isOptimizing: false, warnings: {} };
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
     * Draws a piece's name and its cut dimensions inside its rectangle on the PDF canvas.
     * Font sizes shrink to fit the box, so a small piece keeps a readable label instead of
     * spilling over its neighbours; the dimensions line is dropped only if it truly cannot fit.
     */
    _drawPdfPieceLabel(ctx, piece, x, y, w, h) {
        const padding = 10;
        const maxW = w - padding * 2;
        const maxH = h - padding * 2;
        if (maxW <= 0 || maxH <= 0) return;

        const name = String(piece.ref ?? '');
        const dims = `${Math.round(piece.width)} x ${Math.round(piece.height)}${piece.rotation === 90 ? ' (pivote)' : ''}`;

        const fit = (text, weight, startFs, minFs) => {
            let fs = startFs;
            ctx.font = `${weight} ${fs}px sans-serif`;
            while (fs > minFs && ctx.measureText(text).width > maxW) {
                fs -= 1;
                ctx.font = `${weight} ${fs}px sans-serif`;
            }
            return fs;
        };

        const truncate = (text) => {
            if (ctx.measureText(text).width <= maxW) return text;
            let cut = text;
            while (cut.length > 1 && ctx.measureText(cut + '..').width > maxW) cut = cut.slice(0, -1);
            return cut + '..';
        };

        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const cx = x + w / 2;
        const gap = 5;
        const MAX_FS = 34;
        const MIN_FS = 8;

        // Both lines must fit the HEIGHT too, not just the width: on a long flat piece the
        // name would otherwise stay huge, blow the height budget, and nothing would be drawn.
        // dims sits at 0.75x the name, so two lines need nameFs * 1.75 + gap <= maxH.
        const twoLineCap = Math.floor((maxH - gap) / 1.75);

        if (twoLineCap >= MIN_FS) {
            const nameFs = fit(name, '600', Math.min(MAX_FS, twoLineCap), MIN_FS);
            ctx.font = `600 ${nameFs}px sans-serif`;
            const nameText = truncate(name);

            const dimFs = Math.max(MIN_FS - 1, Math.round(nameFs * 0.75));
            ctx.font = `400 ${dimFs}px sans-serif`;

            if (ctx.measureText(dims).width <= maxW) {
                const top = y + (h - (nameFs + gap + dimFs)) / 2;
                ctx.font = `600 ${nameFs}px sans-serif`;
                ctx.fillText(nameText, cx, top);
                ctx.fillStyle = '#444';
                ctx.font = `400 ${dimFs}px sans-serif`;
                ctx.fillText(dims, cx, top + nameFs + gap);
                return;
            }
        }

        // Not enough room for two lines: the name alone, sized to whatever height is left.
        const soloFs = fit(name, '600', Math.min(MAX_FS, Math.floor(maxH)), MIN_FS);
        if (soloFs > maxH) return;
        ctx.font = `600 ${soloFs}px sans-serif`;
        ctx.fillText(truncate(name), cx, y + (h - soloFs) / 2);
    }

    downloadPDF() {
         // (Keep existing PDF logic but use this.state.result)
         if(!this.state.result) return;
         if (!window.jspdf) { alert("PDF Lib missing"); return; }
         const { jsPDF } = window.jspdf;
         const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
         const panels = this.state.result.panels;
         
         const plaque = this.state.result.plaque || window.CONFIG.plaque;

         const tempCanvas = document.createElement('canvas');
         const scaleFactor = 2000 / plaque.width;
         tempCanvas.width = 2000;
         tempCanvas.height = plaque.height * scaleFactor;
         const ctx = tempCanvas.getContext('2d');

         const renderToTemp = (pIdx) => {
             const p = panels[pIdx];
             const s = tempCanvas.width / plaque.width;
             ctx.fillStyle = '#FFF'; ctx.fillRect(0,0,tempCanvas.width,tempCanvas.height);
             ctx.lineWidth = 2; ctx.strokeStyle='#000'; ctx.strokeRect(0,0,tempCanvas.width,tempCanvas.height);
             
             p.pieces.forEach(piece => {
                const x = piece.x*s, y = piece.y*s, w = piece.width*s, h = piece.height*s;
                ctx.fillStyle = '#DDD';
                ctx.fillRect(x, y, w, h);
                ctx.strokeRect(x, y, w, h);
                this._drawPdfPieceLabel(ctx, piece, x, y, w, h);
             });
         };
 
         for(let i=0; i<panels.length; i++) {
             if(i > 0) doc.addPage();
             const panel = panels[i];
             doc.setFontSize(16);
             doc.text(`Panneau ${i+1}/${panels.length}`, 10, 15);
             doc.setFontSize(10);
             doc.text(`Format : ${plaque.width} x ${plaque.height} mm  -  ${panel.material.thickness}mm ${panel.material.finish}  -  Util: ${panel.utilization.toFixed(1)}%`, 10, 20);

             const offcuts = panel.offcuts || [];
             const biggest = offcuts.reduce((max, o) => Math.max(max, o.area), 0);
             const details = [
                 `Trait de scie : ${plaque.kerf ?? 0} mm`,
                 `${panel.pieces.length} pièce(s)`,
                 `${panel.cutCount || 0} coupe(s)`,
                 `Chutes : ${offcuts.length}${biggest > 0 ? ` (max ${(biggest / 1e6).toFixed(2)} m²)` : ''}`
             ];
             doc.text(details.join('  -  '), 10, 25);

             renderToTemp(i);
             const imgData = tempCanvas.toDataURL('image/png');

             // Calculate image dimensions to fit within PDF page while maintaining aspect ratio
             const imgWidth = tempCanvas.width;
             const imgHeight = tempCanvas.height;
             const imgAspectRatio = imgWidth / imgHeight;

             const pdfPageWidth = doc.internal.pageSize.getWidth(); // e.g., 297 for landscape A4
             const pdfPageHeight = doc.internal.pageSize.getHeight(); // e.g., 210 for landscape A4

             const xMargin = 10; // Left/Right margin
             const yTopOffset = 30; // After title and info
             const yBottomMargin = 10; // Bottom margin

             const availablePdfWidth = pdfPageWidth - (2 * xMargin);
             const availablePdfHeight = pdfPageHeight - yTopOffset - yBottomMargin;

             let finalImgWidth;
             let finalImgHeight;

             // Scale based on available width first
             finalImgWidth = availablePdfWidth;
             finalImgHeight = finalImgWidth / imgAspectRatio;

             // If height exceeds available height, scale based on height instead
             if (finalImgHeight > availablePdfHeight) {
                 finalImgHeight = availablePdfHeight;
                 finalImgWidth = finalImgHeight * imgAspectRatio;
             }
             
             // Center the image horizontally
             const centerX = (pdfPageWidth - finalImgWidth) / 2;

             doc.addImage(imgData, 'PNG', centerX, yTopOffset, finalImgWidth, finalImgHeight);
         }
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
