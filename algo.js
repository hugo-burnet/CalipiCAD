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
        height: 2070,
        kerf: 3.2 // Largeur du trait de scie, en mm (lame standard scie à panneaux)
    },
    colors: {
        piece: 'rgba(26, 42, 85, 0.5)', // Blue at 50% opacity
        pieceBorder: '#4A6FA5',
        text: '#E0E0E0',
        background: '#0a0a0a',
        cutLine: '#FF5555',
        highlight: '#4CAF50',
        offcut: 'rgba(76, 175, 80, 0.5)', // Green at 50% opacity
        offcutBorder: '#2E7D32',
        waste: 'rgba(198, 40, 40, 0.28)', // Red: leftover too small to reuse
        wasteBorder: '#8E2A2A'
    },
    algo: {
        minOffcutArea: 50000, // mm²
        maxTimeMs: 60000,     // 1 minute
        stabilityThresholdMs: 30000, // Stop if no improvement for 30s
        optimalGraceMs: 5000, // Extra offcut polishing once the panel count is provably minimal
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
        this.offcuts = [];    // Leftovers worth keeping
        this.wasteRects = []; // Leftovers below the reuse threshold
        this.material = null; // Set by engine
        this.cutCount = 0;    // Guillotine cuts actually needed on this panel
    }

    clone() {
        const copy = new PanelSolution(this.width, this.height);
        copy.pieces = this.pieces.map(p => ({...p})); // Shallow copy of piece objects is enough for simple props
        copy.freeRects = this.freeRects.map(r => r.clone());
        copy.offcuts = this.offcuts.map(o => o.clone());
        copy.wasteRects = this.wasteRects.map(o => o.clone());
        copy.material = this.material;
        copy.cutCount = this.cutCount;
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
        this.kerf = plaqueDim.kerf || 0;
        // grainEnabled = true means we MUST respect grain (NO rotation)
        // grainEnabled = false means we can rotate
        this.grainEnabled = grainEnabled;
        this.allowRotation = !grainEnabled;
    }

    /**
     * Solves the packing problem for a list of pieces using First-Fit Decreasing (FFD) strategy.
     * This acts as the core placement logic for the optimizer.
     *
     * The input order IS the heuristic: it decides which piece claims the best free rect first.
     * Pass preserveOrder when the caller has already arranged the pieces (the optimizer perturbs
     * the order on purpose); re-sorting here would silently discard that perturbation.
     *
     * Returns { panels, unplaced } — unplaced holds pieces that do not fit the panel format at all.
     */
    solve(pieces, { preserveOrder = false } = {}) {
        const queue = preserveOrder
            ? [...pieces]
            : [...pieces].sort((a, b) => (b.longueur * b.largeur) - (a.longueur * a.largeur));

        const panels = [];
        const unplaced = [];
        let remaining = queue;

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

            // Nothing fit on an empty panel: whatever is left cannot be cut from this format.
            // Report it instead of emitting a blank panel and dropping the pieces silently.
            if (panel.pieces.length === 0) {
                unplaced.push(...nextPass);
                break;
            }

            this._finalizePanel(panel);
            panels.push(panel);
            remaining = nextPass;
        }

        return { panels, unplaced };
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

        // SPLIT LOGIC (Guillotine split)
        // The piece (fit.w x fit.h) sits in the bottom-left of the free rect. The L-shaped
        // leftover is split into two rectangles by one vertical and one horizontal cut.
        //
        // Each cut destroys `kerf` mm of material, so the leftover strips start one kerf past
        // the piece and are one kerf narrower. Without this the plan looks fine on screen and
        // comes out undersized on the saw.
        const w = fit.w;
        const h = fit.h;
        const kerf = this.kerf;

        // Material physically left over, and the usable part of it once the cut is taken out.
        const rawExtraW = rect.w - w;
        const rawExtraH = rect.h - h;
        const extraW = rawExtraW - kerf;
        const extraH = rawExtraH - kerf;

        // A cut is needed wherever material remains, even a sliver too thin to reuse.
        if (rawExtraW > 0) panel.cutCount++;
        if (rawExtraH > 0) panel.cutCount++;

        // Two ways to extend the cuts across the leftover space:
        //   Option A (vertical cut runs full height): right = extraW x rect.h, top = w x extraH
        //   Option B (horizontal cut runs full width): right = extraW x h, top = rect.w x extraH
        // Keep whichever yields the largest single free rectangle, so big reusable offcuts survive.
        const optionA_Max = Math.max(extraW * rect.h, w * extraH);
        const optionB_Max = Math.max(extraW * h, rect.w * extraH);
        const splitVertically = optionA_Max > optionB_Max;

        if (splitVertically) {
             if (extraW > 0) panel.freeRects.push(new Rect(rect.x + w + kerf, rect.y, extraW, rect.h));
             if (extraH > 0) panel.freeRects.push(new Rect(rect.x, rect.y + h + kerf, w, extraH));
        } else {
             if (extraH > 0) panel.freeRects.push(new Rect(rect.x, rect.y + h + kerf, rect.w, extraH));
             if (extraW > 0) panel.freeRects.push(new Rect(rect.x + w + kerf, rect.y, extraW, h));
        }
    }

    _finalizePanel(panel) {
        // Leftovers split in two: big enough to be worth keeping (offcuts) and the rest (waste).
        // Both are kept so the renderer can account for every square millimetre of the panel —
        // an unpainted area reads as a bug rather than as scrap.
        panel.offcuts = panel.freeRects.filter(r => r.area >= CONFIG.algo.minOffcutArea);
        panel.wasteRects = panel.freeRects.filter(r => r.area < CONFIG.algo.minOffcutArea);
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

    /** Area-descending order: the classic First-Fit Decreasing heuristic, and a strong baseline. */
    _ffdOrder(pieces) {
        return [...pieces].sort((a, b) => (b.longueur * b.largeur) - (a.longueur * a.largeur));
    }

    /**
     * Produces a neighbour of `order` for the local search.
     *
     * A full random shuffle is almost always far worse than FFD, so it practically never wins
     * and the search stalls. Mutating the BEST KNOWN order by a few swaps explores the useful
     * neighbourhood instead, with periodic sort-based restarts to escape local optima.
     */
    _perturb(order, iteration) {
        // Periodic restart from a different global heuristic.
        if (iteration % 25 === 0) {
            const criteria = [
                (a, b) => b.longueur - a.longueur,
                (a, b) => b.largeur - a.largeur,
                (a, b) => Math.max(b.longueur, b.largeur) - Math.max(a.longueur, a.largeur),
                (a, b) => (b.longueur + b.largeur) - (a.longueur + a.largeur)
            ];
            return [...order].sort(criteria[(iteration / 25) % criteria.length]);
        }

        const next = [...order];
        const n = next.length;
        if (n < 2) return next;

        const mutations = 1 + Math.floor(Math.random() * 3);
        for (let m = 0; m < mutations; m++) {
            const roll = Math.random();
            if (roll < 0.5) {
                // Swap two pieces.
                const i = Math.floor(Math.random() * n);
                const j = Math.floor(Math.random() * n);
                [next[i], next[j]] = [next[j], next[i]];
            } else if (roll < 0.8) {
                // Move one piece elsewhere in the queue.
                const from = Math.floor(Math.random() * n);
                const to = Math.floor(Math.random() * n);
                next.splice(to, 0, next.splice(from, 1)[0]);
            } else {
                // Reverse a short segment.
                const start = Math.floor(Math.random() * n);
                const len = 2 + Math.floor(Math.random() * 4);
                const seg = next.slice(start, start + len).reverse();
                next.splice(start, seg.length, ...seg);
            }
        }
        return next;
    }

    /** True when a piece cannot fit the panel in any allowed orientation. */
    _fitsPanel(piece, plaque, allowRotation) {
        const normal = piece.longueur <= plaque.width && piece.largeur <= plaque.height;
        const rotated = allowRotation && piece.largeur <= plaque.width && piece.longueur <= plaque.height;
        return normal || rotated;
    }

    /**
     * Best case a group can reach: the fewest panels its placeable pieces could ever occupy
     * (even a perfect, waste-free packing cannot beat area / panel area), and the number of
     * pieces that fit no panel at all — those can never be placed, so they must not block
     * the "we are done" check.
     */
    _bestCase(group, plaque, allowRotation) {
        const placeable = group.pieces.filter(p => this._fitsPanel(p, plaque, allowRotation));
        const totalArea = placeable.reduce((sum, p) => sum + (p.longueur * p.largeur), 0);
        return {
            minPanels: Math.ceil(totalArea / (plaque.width * plaque.height)),
            minUnplaced: group.pieces.length - placeable.length
        };
    }

    /**
     * Main optimization loop.
     * Runs for up to CONFIG.algo.maxTimeMs, stopping earlier once the search stabilises
     * or once every group has provably reached its minimum panel count.
     */
    async start(pieces, plaque, options, onProgress, onComplete) {
        this.isRunning = true;
        this.stopRequested = false;

        // 1. Initial Setup
        const packer = new BinaryTreePacker(plaque, options.grainEnabled);
        const groups = this._groupPieces(pieces);

        // Store best solutions per group, plus the piece order that produced them —
        // the local search mutates that order rather than starting from scratch.
        const groupBestPanels = {};
        const groupBestOrder = {};
        groups.forEach(g => {
            const order = this._ffdOrder(g.pieces);
            const initial = packer.solve(order, { preserveOrder: true });
            // Ensure material metadata is present from the start
            initial.panels.forEach(p => {
                p.material = { thickness: g.thickness, finish: g.finish, label: g.id };
            });
            groupBestPanels[g.id] = initial;
            groupBestOrder[g.id] = order;
        });

        const startTime = performance.now();
        console.log(`Starting optimization for ${pieces.length} pieces.`);
        let lastYieldTime = startTime;
        let lastImprovementTime = startTime;
        let iteration = 0;

        // Once every group sits at its theoretical minimum, the panel count can no longer be
        // improved — we keep polishing offcuts for a short grace period instead of burning
        // the full stability timeout on a result we already know is optimal.
        const bestCases = {};
        groups.forEach(g => { bestCases[g.id] = this._bestCase(g, plaque, !options.grainEnabled); });
        const allGroupsOptimal = () => groups.every(g => {
            const best = groupBestPanels[g.id];
            const target = bestCases[g.id];
            return best.unplaced.length <= target.minUnplaced && best.panels.length <= target.minPanels;
        });
        let optimalSince = allGroupsOptimal() ? startTime : null;

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

                // Provably optimal panel count: stop after a short offcut-polishing window.
                if (optimalSince !== null && (currentTime - optimalSince) > CONFIG.algo.optimalGraceMs) {
                    console.log("Minimum panel count reached. Stopping early.");
                    break;
                }

                // Yield to UI
                if (currentTime - lastYieldTime > CONFIG.algo.yieldInterval) {
                    await new Promise(r => setTimeout(r, 0));
                    lastYieldTime = performance.now();
                    
                    // Report Progress
                    // We estimate progress based on time, as we don't have a fixed number of iterations
                    // But we also show "Stabilization" progress if we are close to stopping early
                    // The run ends at whichever deadline comes first: the hard timeout or the
                    // stability window. Reporting only the hard timeout made the countdown jump
                    // straight from 0:30 to done, so track the nearest deadline instead.
                    const timeProgress = (elapsed / CONFIG.algo.maxTimeMs) * 100;
                    const stabilityProgress = (timeSinceImprovement / CONFIG.algo.stabilityThresholdMs) * 100;
                    const timeLeft = Math.max(0, Math.min(
                        CONFIG.algo.maxTimeMs - elapsed,
                        CONFIG.algo.stabilityThresholdMs - timeSinceImprovement
                    ));

                    onProgress({
                        percent: Math.min(Math.max(timeProgress, stabilityProgress), 99),
                        iter: iteration,
                        timeLeft: timeLeft,
                        stability: Math.round(stabilityProgress)
                    });
                }

                let improvedGlobal = false;

                // Optimize each group
                for (const group of groups) {
                    // Local search: mutate the order that produced the current best packing.
                    const candidateOrder = this._perturb(groupBestOrder[group.id], iteration);

                    // preserveOrder is essential: the whole point of this loop is the perturbed
                    // order above, and solve() would otherwise re-sort it away.
                    const candidate = packer.solve(candidateOrder, { preserveOrder: true });

                    // Compare
                    if (this._isBetter(candidate, groupBestPanels[group.id])) {
                        // Re-inject metadata (lost during packing usually)
                        candidate.panels.forEach(p => {
                            p.material = { thickness: group.thickness, finish: group.finish, label: group.id };
                        });
                        console.log(`New best for group ${group.id}: ${candidate.panels.length} panels`);
                        groupBestPanels[group.id] = candidate;
                        groupBestOrder[group.id] = candidateOrder;
                        improvedGlobal = true;
                        lastImprovementTime = performance.now();
                    }
                }

                if (improvedGlobal || optimalSince === null) {
                    optimalSince = allGroupsOptimal() ? performance.now() : null;
                }
            }
        } catch (err) {
            console.error("Optimization Loop Error:", err);
        }

        // 3. Finalize
        this.isRunning = false;
        
        // Reconstruct Global Solution
        const best = Object.values(groupBestPanels);
        const allPanels = best.flatMap(b => b.panels);
        const allUnplaced = best.flatMap(b => b.unplaced);
        allPanels.forEach((p, i) => p.id = i + 1);

        const finalResult = this._formatResult(allPanels, allUnplaced);
        onComplete(finalResult);
    }

    stop() {
        this.stopRequested = true;
    }

    /**
     * Ranks two solutions for the same group of pieces.
     *
     * Note on average utilization: it is NOT a usable criterion here. Every piece is always
     * placed, so at equal panel count the used area and the panel count are both constant,
     * making the average identical by construction. The meaningful tie-breaks are how the
     * waste is distributed: one big reusable offcut beats the same area scattered as slivers.
     */
    _isBetter(candidate, currentBest) {
        // 1. Placing more pieces always wins.
        if (candidate.unplaced.length !== currentBest.unplaced.length) {
            return candidate.unplaced.length < currentBest.unplaced.length;
        }

        // 2. Fewer Panels (Primary Cost)
        if (candidate.panels.length !== currentBest.panels.length) {
            return candidate.panels.length < currentBest.panels.length;
        }

        // 3. Maximize the largest single offcut (the most reusable one).
        const getMaxOffcut = (panels) => {
            let max = 0;
            panels.forEach(p => {
                if (p.offcuts) p.offcuts.forEach(o => max = Math.max(max, o.area));
            });
            return max;
        };
        const candOffcut = getMaxOffcut(candidate.panels);
        const bestOffcut = getMaxOffcut(currentBest.panels);
        if (candOffcut !== bestOffcut) return candOffcut > bestOffcut;

        // 4. Concentrate the waste: emptying one panel as much as possible leaves a better remnant.
        const getMinUtil = (panels) => panels.reduce((min, p) => Math.min(min, p.utilization), Infinity);
        return getMinUtil(candidate.panels) < getMinUtil(currentBest.panels);
    }

    _formatResult(panels, unplaced) {
        const globalUtil = panels.length > 0
            ? panels.reduce((acc, p) => acc + p.utilization, 0) / panels.length
            : 0;

        // Actual guillotine cuts recorded during placement, not an estimate.
        const totalCuts = panels.reduce((acc, p) => acc + p.cutCount, 0);

        return {
            panels: panels,
            unplaced: unplaced,
            stats: {
                totalPanels: panels.length,
                globalUtilization: globalUtil,
                totalCuts: totalCuts,
                unplacedCount: unplaced.length,
                timestamp: new Date().toISOString()
            }
        };
    }
}

// Expose to global scope for the interface to use
window.OptimizerEngine = OptimizerEngine;
window.CONFIG = CONFIG; // Expose config if needed by UI
