/**
 * CalpiCAD - Export DXF (dxf.js)
 *
 * Genere un DXF AutoCAD R12 (AC1009) a partir d'un resultat de calpinage.
 *
 * Pourquoi R12 : c'est le dialecte DXF le plus universellement lu (AutoCAD,
 * BricsCAD, LibreCAD, machines a commande numerique), et il ne demande ni
 * handles ni table d'objets - on peut donc l'ecrire sans dependance externe.
 *
 * Deux conventions different entre l'application et AutoCAD :
 *   - l'app place l'origine en HAUT a gauche, Y vers le bas (canvas) ;
 *   - AutoCAD place l'origine en BAS a gauche, Y vers le haut.
 * Toutes les ordonnees sont donc retournees (voir flipY).
 */

const DXF_LAYERS = [
    { name: 'CALPICAD_PANNEAU', color: 7 },  // blanc/noir : contour de plaque
    { name: 'CALPICAD_PIECES',  color: 5 },  // bleu   : pieces a debiter
    { name: 'CALPICAD_CHUTES',  color: 3 },  // vert   : chutes reutilisables
    { name: 'CALPICAD_PERTES',  color: 1 },  // rouge  : pertes sous le seuil
    { name: 'CALPICAD_TEXTE',   color: 2 }   // jaune  : reperes et cotes
];

class DxfBuilder {
    constructor() {
        this.entities = [];
        this.minX = Infinity; this.minY = Infinity;
        this.maxX = -Infinity; this.maxY = -Infinity;
    }

    /** DXF est une suite de paires (code de groupe, valeur), une par ligne. */
    _pair(code, value) {
        return `${code}\n${value}`;
    }

    _num(v) {
        // 4 decimales : largement sous le micron, et evite la notation
        // exponentielle que certains lecteurs DXF refusent.
        return Number(v).toFixed(4);
    }

    _track(x, y) {
        if (x < this.minX) this.minX = x;
        if (y < this.minY) this.minY = y;
        if (x > this.maxX) this.maxX = x;
        if (y > this.maxY) this.maxY = y;
    }

    /**
     * AutoCAD R12 n'a pas d'encodage unicode fiable pour les TEXT : les accents
     * ressortent en caracteres parasites selon la page de code du poste. On
     * translittere donc en ASCII pur.
     */
    static sanitize(text) {
        return String(text ?? '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[\r\n]+/g, ' ')
            .replace(/[^\x20-\x7E]/g, '?');
    }

    /** Rectangle ferme, dessine comme une polyligne (un seul objet selectionnable). */
    addRect(layer, x, y, w, h) {
        const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
        pts.forEach(p => this._track(p[0], p[1]));

        const out = [
            this._pair(0, 'POLYLINE'),
            this._pair(8, layer),
            this._pair(66, 1),   // des VERTEX suivent
            this._pair(70, 1),   // polyligne fermee
            this._pair(10, this._num(0)),
            this._pair(20, this._num(0)),
            this._pair(30, this._num(0))
        ];
        pts.forEach(p => {
            out.push(
                this._pair(0, 'VERTEX'),
                this._pair(8, layer),
                this._pair(10, this._num(p[0])),
                this._pair(20, this._num(p[1])),
                this._pair(30, this._num(0))
            );
        });
        out.push(this._pair(0, 'SEQEND'), this._pair(8, layer));
        this.entities.push(out.join('\n'));
    }

    /** Texte, centre sur (x, y) par defaut. */
    addText(layer, x, y, height, text, align = 'center') {
        const content = DxfBuilder.sanitize(text);
        if (!content) return;
        this._track(x, y);

        // 72/73 : justification horizontale/verticale. Des qu'elles sont non
        // nulles, c'est le point 11/21 qui positionne reellement le texte.
        const hJust = align === 'left' ? 0 : 1;
        const vJust = align === 'left' ? 0 : 2;

        this.entities.push([
            this._pair(0, 'TEXT'),
            this._pair(8, layer),
            this._pair(10, this._num(x)),
            this._pair(20, this._num(y)),
            this._pair(30, this._num(0)),
            this._pair(40, this._num(height)),
            this._pair(1, content),
            this._pair(72, hJust),
            this._pair(73, vJust),
            this._pair(11, this._num(x)),
            this._pair(21, this._num(y)),
            this._pair(31, this._num(0))
        ].join('\n'));
    }

    toString() {
        const hasContent = Number.isFinite(this.minX);
        const minX = hasContent ? this.minX : 0;
        const minY = hasContent ? this.minY : 0;
        const maxX = hasContent ? this.maxX : 0;
        const maxY = hasContent ? this.maxY : 0;

        const header = [
            this._pair(0, 'SECTION'),
            this._pair(2, 'HEADER'),
            this._pair(9, '$ACADVER'), this._pair(1, 'AC1009'),
            this._pair(9, '$INSUNITS'), this._pair(70, 4), // 4 = millimetres
            this._pair(9, '$EXTMIN'),
            this._pair(10, this._num(minX)), this._pair(20, this._num(minY)), this._pair(30, this._num(0)),
            this._pair(9, '$EXTMAX'),
            this._pair(10, this._num(maxX)), this._pair(20, this._num(maxY)), this._pair(30, this._num(0)),
            this._pair(0, 'ENDSEC')
        ];

        const tables = [
            this._pair(0, 'SECTION'),
            this._pair(2, 'TABLES'),
            // CONTINUOUS est exige par la plupart des lecteurs DXF.
            this._pair(0, 'TABLE'), this._pair(2, 'LTYPE'), this._pair(70, 1),
            this._pair(0, 'LTYPE'),
            this._pair(2, 'CONTINUOUS'), this._pair(70, 0),
            this._pair(3, 'Solid line'), this._pair(72, 65),
            this._pair(73, 0), this._pair(40, this._num(0)),
            this._pair(0, 'ENDTAB'),
            this._pair(0, 'TABLE'), this._pair(2, 'LAYER'), this._pair(70, DXF_LAYERS.length)
        ];
        DXF_LAYERS.forEach(l => {
            tables.push(
                this._pair(0, 'LAYER'),
                this._pair(2, l.name),
                this._pair(70, 0),
                this._pair(62, l.color),
                this._pair(6, 'CONTINUOUS')
            );
        });
        tables.push(this._pair(0, 'ENDTAB'), this._pair(0, 'ENDSEC'));

        const entities = [
            this._pair(0, 'SECTION'),
            this._pair(2, 'ENTITIES'),
            ...this.entities,
            this._pair(0, 'ENDSEC')
        ];

        return [...header, ...tables, ...entities, this._pair(0, 'EOF')].join('\n') + '\n';
    }
}

/**
 * Construit le DXF complet d'un calpinage.
 *
 * Les panneaux sont disposes en grille avec un espacement franc : les empiler
 * a la meme origine rendrait le fichier inexploitable dans AutoCAD.
 */
function buildCalpinageDxf(result, options = {}) {
    const dxf = new DxfBuilder();
    const panels = result.panels || [];
    const plaque = result.plaque || (window.CONFIG && window.CONFIG.plaque) || { width: 0, height: 0 };

    const W = plaque.width;
    const H = plaque.height;

    const includeOffcuts = options.includeOffcuts !== false;
    const includeWaste = options.includeWaste !== false;

    // Grille approximativement carree : 13 panneaux alignes feraient 36 m de
    // large, illisible au zoom global.
    const cols = options.columns || Math.max(1, Math.ceil(Math.sqrt(panels.length)));
    const titleH = Math.max(40, H * 0.03);
    const gapX = Math.max(200, W * 0.06);
    const gapY = titleH * 3;

    // L'app dessine Y vers le bas, AutoCAD Y vers le haut.
    const flipY = (y, h) => H - (y + h);

    panels.forEach((panel, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const ox = col * (W + gapX);
        const oy = -row * (H + gapY);

        // Contour de la plaque
        dxf.addRect('CALPICAD_PANNEAU', ox, oy, W, H);

        // Cartouche au-dessus du panneau
        const mat = panel.material || {};
        const title = `Panneau ${i + 1}/${panels.length}  -  ${mat.thickness || '?'}mm ${mat.finish || ''}`
            + `  -  ${W} x ${H} mm  -  Util ${(panel.utilization || 0).toFixed(1)}%`;
        dxf.addText('CALPICAD_TEXTE', ox, oy + H + titleH * 0.8, titleH, title, 'left');

        if (includeOffcuts) {
            (panel.offcuts || []).forEach(r => {
                dxf.addRect('CALPICAD_CHUTES', ox + r.x, oy + flipY(r.y, r.h), r.w, r.h);
            });
        }

        if (includeWaste) {
            (panel.wasteRects || []).forEach(r => {
                dxf.addRect('CALPICAD_PERTES', ox + r.x, oy + flipY(r.y, r.h), r.w, r.h);
            });
        }

        (panel.pieces || []).forEach(p => {
            const x = ox + p.x;
            const y = oy + flipY(p.y, p.height);
            dxf.addRect('CALPICAD_PIECES', x, y, p.width, p.height);

            const name = DxfBuilder.sanitize(p.ref);
            const dims = `${Math.round(p.width)} x ${Math.round(p.height)}`
                + (p.rotation === 90 ? ' (pivote)' : '');

            // Hauteur de texte calee sur la boite, en largeur comme en hauteur :
            // sinon le repere d'une petite piece deborde sur ses voisines.
            const byWidth = name.length > 0 ? (p.width * 0.85) / (name.length * 0.62) : p.width;
            const th = Math.min(p.height / 5, byWidth, 60);
            if (th < 6) return; // illisible : on laisse la piece nue

            const cx = x + p.width / 2;
            const cy = y + p.height / 2;

            if (p.height > th * 3.2) {
                dxf.addText('CALPICAD_TEXTE', cx, cy + th * 0.8, th, name);
                dxf.addText('CALPICAD_TEXTE', cx, cy - th * 0.8, th * 0.75, dims);
            } else {
                dxf.addText('CALPICAD_TEXTE', cx, cy, th, name);
            }
        });
    });

    return dxf.toString();
}

window.DxfExporter = { build: buildCalpinageDxf, DxfBuilder, LAYERS: DXF_LAYERS };
