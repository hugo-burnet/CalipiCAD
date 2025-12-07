/**
 * CalpiCAD - Algorithm Core (algo.js)
 * Architecture: Binary Tree Packing with Branch & Bound
 * Responsibilities:
 * - Mathematical data structures
 * - Packing algorithms
 * - Optimization engine (Timer, Progress, Interruption)
 */

/* =========================================
   1. CONFIGURATION & CONSTANTS
   ========================================= */
const CONFIG = {
    plaque: {
        width: 2800,
        height: 2070
    },
    colors: {
        piece: 'rgba(26, 42, 85, 0.5)', // Blue at 50% opacity
        pieceBorder: '#4A6FA5',
        text: '#E0E0E0',
        background: '#0a0a0a',
        cutLine: '#FF5555',
        highlight: '#4CAF50',
        offcut: 'rgba(76, 175, 80, 0.5)', // Green at 50% opacity
        offcutBorder: '#2E7D32'
    },
    algo: {
        minOffcutArea: 50000, // mm²
        maxTimeMs: 60000,     // 1 minute
        stabilityThresholdMs: 30000, // Stop if no improvement for 30s
        yieldInterval: 15     // ms
    }
};

/* =========================================
   2. DATA STRUCTURES
   ========================================= */
class Rect {
    constructor(x, y, w, h) {
        this.x = x; this.y = y; this.w = w; this.h = h;
    }
    get area() { return this.w * this.h; }
    clone() { return new Rect(this.x, this.y, this.w, this.h); }
}

class PlacedPiece {
    constructor(piece, x, y, w, h, rotated) {
        this.id = piece.id;
        this.ref = piece.reference;
        this.x = x; this.y = y;
        this.width = w; this.height = h;
        this.rotation = rotated ? 90 : 0;
        // Metadata for sorting/identification
        this.originalPiece = piece;
    }
}

class PanelSolution {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.pieces = [];
        this.freeRects = [new Rect(0, 0, width, height)];
        this.offcuts = [];
        this.material = null; // Set by engine
    }

    clone() {
        const copy = new PanelSolution(this.width, this.height);
        copy.pieces = this.pieces.map(p => ({...p})); // Shallow copy of piece objects is enough for simple props
        copy.freeRects = this.freeRects.map(r => r.clone());
        copy.offcuts = this.offcuts.map(o => o.clone());
        copy.material = this.material;
        return copy;
    }

    get utilization() {
        const used = this.pieces.reduce((sum, p) => sum + (p.width * p.height), 0);
        return (used / (this.width * this.height)) * 100;
    }

    get waste() {
        const used = this.pieces.reduce((sum, p) => sum + (p.width * p.height), 0);
        return (this.width * this.height) - used;
    }
}

/* =========================================
   3. BINARY TREE PACKER
   ========================================= */
class BinaryTreePacker {
    constructor(plaqueDim, grainEnabled) {
        this.binWidth = plaqueDim.width;
        this.binHeight = plaqueDim.height;
        // grainEnabled = true means we MUST respect grain (NO rotation)
        // grainEnabled = false means we can rotate
        this.grainEnabled = grainEnabled;
        this.allowRotation = !grainEnabled;
    }

    /**
     * Solves the packing problem for a list of pieces using First-Fit Decreasing (FFD) strategy.
     * This acts as the core placement logic for the optimizer.
     */
    solve(pieces) {
        // Sort by Area Descending (heuristic baseline)
        // The optimizer will perturb this order, but we need a default
        const sorted = [...pieces].sort((a, b) => (b.longueur * b.largeur) - (a.longueur * a.largeur));
        const panels = [];
        let remaining = sorted;

        while (remaining.length > 0) {
            const panel = new PanelSolution(this.binWidth, this.binHeight);
            const nextPass = [];

            for (const piece of remaining) {
                const fit = this._findBestFit(piece, panel.freeRects);
                if (fit) {
                    this._placePiece(panel, piece, fit);
                } else {
                    nextPass.push(piece);
                }
            }
            
            this._finalizePanel(panel);
            panels.push(panel);
            remaining = nextPass;
            
            // Safety break for pieces larger than bin
            if (panel.pieces.length === 0 && remaining.length > 0) {
                console.error("Piece too large for bin", remaining[0]);
                break; 
            }
        }
        return panels;
    }

    _findBestFit(piece, freeRects) {
        // Best Short Side Fit (BSSF) Strategy
        // We search ALL free rects and choose the one that minimizes the shorter leftover side.
        // This packs pieces more tightly than First Fit.
        
        let bestScore = Number.MAX_VALUE;
        let bestFit = null;

        for (let i = 0; i < freeRects.length; i++) {
            const r = freeRects[i];
            
            // 1. Try Normal Orientation
            if (piece.longueur <= r.w && piece.largeur <= r.h) {
                const leftoverX = Math.abs(r.w - piece.longueur);
                const leftoverY = Math.abs(r.h - piece.largeur);
                const score = Math.min(leftoverX, leftoverY);
                
                if (score < bestScore) {
                    bestScore = score;
                    bestFit = { rectIdx: i, w: piece.longueur, h: piece.largeur, rotated: false };
                }
            }
            
            // 2. Try Rotated
            // Only if rotation is allowed
            if (this.allowRotation && piece.largeur <= r.w && piece.longueur <= r.h) {
                const leftoverX = Math.abs(r.w - piece.largeur);
                const leftoverY = Math.abs(r.h - piece.longueur);
                const score = Math.min(leftoverX, leftoverY);
                
                if (score < bestScore) {
                    bestScore = score;
                    bestFit = { rectIdx: i, w: piece.largeur, h: piece.longueur, rotated: true };
                }
            }
        }
        return bestFit;
    }

    _placePiece(panel, piece, fit) {
        const rect = panel.freeRects[fit.rectIdx];
        
        // Record placement
        panel.pieces.push(new PlacedPiece(piece, rect.x, rect.y, fit.w, fit.h, fit.rotated));

        // Remove used rect
        panel.freeRects.splice(fit.rectIdx, 1);

        // SPLIT LOGIC (Binary Tree Split)
        // We have a used rectangle (fit.w x fit.h) inside the free rectangle (rect.w x rect.h).
        // We split the remaining L-shaped space into two new rectangles.
        // We want to maximize the size of the new free rectangles (Conserve large offcuts).
        
        const w = fit.w;
        const h = fit.h;
        const extraW = rect.w - w;
        const extraH = rect.h - h;

        // Heuristic: Split along the shorter axis of the leftover space to maximize the larger rectangle.
        // Option A: Split Vertically (Extension of the vertical cut)
        // -> Right Rect: extraW x rect.h
        // -> Top Rect:   w x extraH
        
        // Option B: Split Horizontally (Extension of the horizontal cut)
        // -> Right Rect: extraW x h
        // -> Top Rect:   rect.w x extraH
        
        // We compare the area of the LARGEST resulting rectangle in both scenarios.
        // Max(OptionA_Right, OptionA_Top) vs Max(OptionB_Right, OptionB_Top)
        
        const optionA_Max = Math.max(extraW * rect.h, w * extraH);
        const optionB_Max = Math.max(extraW * h, rect.w * extraH);

        // However, a common heuristic is simply to maximize the area of the rectangle formed by the "Longer Remaining Side".
        // Let's stick to the previous logic which was:
        // const splitVertically = (extraW * rect.h) > (rect.w * extraH);
        // This effectively chooses the split that creates the largest single free rectangle.
        
        const splitVertically = optionA_Max > optionB_Max;

        if (splitVertically) {
             if (extraW > 0) panel.freeRects.push(new Rect(rect.x + w, rect.y, extraW, rect.h));
             if (extraH > 0) panel.freeRects.push(new Rect(rect.x, rect.y + h, w, extraH));
        } else {
             if (extraH > 0) panel.freeRects.push(new Rect(rect.x, rect.y + h, rect.w, extraH));
             if (extraW > 0) panel.freeRects.push(new Rect(rect.x + w, rect.y, extraW, h));
        }
    }

    _finalizePanel(panel) {
        // Filter offcuts based on min area
        panel.offcuts = panel.freeRects.filter(r => r.area >= CONFIG.algo.minOffcutArea);
        // Clean up freeRects (optional, but good for cleanliness)
        panel.freeRects = [];
    }
}

/* =========================================
   4. OPTIMIZER ENGINE
   ========================================= */
class OptimizerEngine {
    constructor() {
        this.isRunning = false;
        this.stopRequested = false;
    }

    /**
     * Groups pieces by Thickness and Finish.
     * We must optimize each group separately as they are different physical materials.
     */
    _groupPieces(pieces) {
        const groups = {};
        pieces.forEach(p => {
            const k = `${p.epaisseur}-${p.finition}`;
            if (!groups[k]) groups[k] = { id: k, thickness: p.epaisseur, finish: p.finition, pieces: [] };
            groups[k].pieces.push(p);
        });
        return Object.values(groups);
    }

    /**
     * Main optimization loop.
     * Runs for up to CONFIG.algo.maxTimeMs (3 minutes).
     */
    async start(pieces, plaque, options, onProgress, onComplete) {
        this.isRunning = true;
        this.stopRequested = false;
        
        // 1. Initial Setup
        const packer = new BinaryTreePacker(plaque, options.grainEnabled);
        const groups = this._groupPieces(pieces);
        
        // Store best solutions per group
        const groupBestPanels = {};
        groups.forEach(g => {
            // Initial fast pass
            const initialPanels = packer.solve(g.pieces);
            // Ensure material metadata is present from the start
            initialPanels.forEach(p => {
                p.material = { thickness: g.thickness, finish: g.finish, label: g.id };
            });
            groupBestPanels[g.id] = initialPanels;
        });

        const startTime = performance.now();
        console.log(`Starting optimization for ${pieces.length} pieces.`);
        let lastYieldTime = startTime;
        let lastImprovementTime = startTime;
        let iteration = 0;

        try {
            // 2. Optimization Loop
            while (this.isRunning && !this.stopRequested) {
                iteration++;
                const currentTime = performance.now();
                const elapsed = currentTime - startTime;
                const timeSinceImprovement = currentTime - lastImprovementTime;

                // Timeout Check
                if (elapsed > CONFIG.algo.maxTimeMs) {
                    console.warn("Optimization timeout reached (1 minute)");
                    break;
                }

                // Stability Check (Auto-Stop)
                if (timeSinceImprovement > CONFIG.algo.stabilityThresholdMs) {
                    console.log("Optimization stabilized. Stopping early.");
                    break;
                }

                // Yield to UI
                if (currentTime - lastYieldTime > CONFIG.algo.yieldInterval) {
                    await new Promise(r => setTimeout(r, 0));
                    lastYieldTime = performance.now();
                    
                    // Report Progress
                    // We estimate progress based on time, as we don't have a fixed number of iterations
                    // But we also show "Stabilization" progress if we are close to stopping early
                    const timeProgress = (elapsed / CONFIG.algo.maxTimeMs) * 100;
                    const stabilityProgress = (timeSinceImprovement / CONFIG.algo.stabilityThresholdMs) * 100;
                    
                    // The "Effective" progress is the max of both, but we shouldn't jump around too much.
                    // Let's stick to time progress for the bar, but maybe update the text?
                    // For now, simple time progress is less confusing, but let's accelerate it if we are stable.
                    
                    onProgress({
                        percent: Math.min(timeProgress, 99),
                        iter: iteration,
                        timeLeft: Math.max(0, CONFIG.algo.maxTimeMs - elapsed),
                        stability: Math.round(stabilityProgress)
                    });
                }

                let improvedGlobal = false;

                // Optimize each group
                for (const group of groups) {
                    // Strategy: Perturbation
                    // We shuffle the pieces or apply different sorting criteria to find better packings
                    const shuffledPieces = [...group.pieces];
                    
                    if (Math.random() > 0.4) {
                        // Random Shuffle
                        for (let i = shuffledPieces.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [shuffledPieces[i], shuffledPieces[j]] = [shuffledPieces[j], shuffledPieces[i]];
                        }
                    } else {
                        // Systematic Sort Variations
                        const criteria = [
                            (a, b) => b.longueur - a.longueur, // Width
                            (a, b) => b.largeur - a.largeur,   // Height
                            (a, b) => Math.max(b.longueur, b.largeur) - Math.max(a.longueur, a.largeur), // Max Side
                            (a, b) => (b.longueur * b.largeur) - (a.longueur * a.largeur) // Area
                        ];
                        const sortFn = criteria[iteration % criteria.length];
                        shuffledPieces.sort(sortFn);
                    }

                    // Solve
                    const candidatePanels = packer.solve(shuffledPieces);

                    // Compare
                    if (this._isBetter(candidatePanels, groupBestPanels[group.id])) {
                        // Re-inject metadata (lost during packing usually)
                        candidatePanels.forEach(p => {
                            p.material = { thickness: group.thickness, finish: group.finish, label: group.id };
                        });
                        console.log(`New best for group ${group.id}: ${candidatePanels.length} panels`);
                        groupBestPanels[group.id] = candidatePanels;
                        improvedGlobal = true;
                        lastImprovementTime = performance.now();
                    }
                }
            }
        } catch (err) {
            console.error("Optimization Loop Error:", err);
        }

        // 3. Finalize
        this.isRunning = false;
        
        // Reconstruct Global Solution
        const allPanels = Object.values(groupBestPanels).flat();
        allPanels.forEach((p, i) => p.id = i + 1);
        
        const finalResult = this._formatResult(allPanels);
        onComplete(finalResult);
    }

    stop() {
        this.stopRequested = true;
    }

    _isBetter(candidate, currentBest) {
        // 1. Fewer Panels is always better (Primary Cost)
        if (candidate.length < currentBest.length) return true;
        if (candidate.length > currentBest.length) return false;

        // 2. Calculate Average Utilization
        const getUtil = (panels) => panels.reduce((sum, p) => sum + p.utilization, 0) / panels.length;
        const candUtil = getUtil(candidate);
        const bestUtil = getUtil(currentBest);

        if (candUtil > bestUtil + 0.01) return true; // Significant util increase
        if (candUtil < bestUtil - 0.01) return false;

        // 3. Maximize Largest Offcut (Area)
        const getMaxOffcut = (panels) => {
            let max = 0;
            panels.forEach(p => {
                if (p.offcuts) p.offcuts.forEach(o => max = Math.max(max, o.area));
            });
            return max;
        };
        
        return getMaxOffcut(candidate) > getMaxOffcut(currentBest);
    }

    _formatResult(panels) {
        const globalUtil = panels.length > 0 
            ? panels.reduce((acc, p) => acc + p.utilization, 0) / panels.length 
            : 0;

        const totalCuts = panels.reduce((acc, p) => acc + 4 + p.pieces.length, 0);

        return {
            panels: panels,
            stats: {
                totalPanels: panels.length,
                globalUtilization: globalUtil,
                totalCuts: totalCuts,
                timestamp: new Date().toISOString()
            }
        };
    }
}

// Expose to global scope for the interface to use
window.OptimizerEngine = OptimizerEngine;
window.CONFIG = CONFIG; // Expose config if needed by UI
