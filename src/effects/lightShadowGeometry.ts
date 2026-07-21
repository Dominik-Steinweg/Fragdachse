/**
 * Projektion von Schattenpolygonen für dynamische Lichtverdeckung.
 *
 * Reine Geometrie ohne Phaser-Abhängigkeit, damit sie ohne WebGL-Kontext testbar bleibt.
 * Alle Funktionen schreiben in vorab allokierte Buffer – auf dem Licht-Pfad wird pro
 * Frame und Lichtquelle über etliche Occluder iteriert, dort darf nichts allokiert werden.
 *
 * Modell (90°-Draufsicht): Der Schatten beginnt kurz hinter der *beleuchteten* Kante des
 * Hindernisses und läuft radial vom Licht weg. Dadurch fängt nur ein schmaler Saum am
 * Rand das volle Licht; die Oberseite dahinter und der Boden hinter dem Hindernis liegen
 * im Schatten.
 *
 * Zusammenhängende Felsen und Basiszellen bilden über das 47-Blob-Autotiling optisch
 * einen einzigen Block. Deshalb wirft nur die *freiliegende* Außenkante Schatten –
 * Kanten zwischen zwei belegten Nachbarzellen werden übersprungen, sonst würde jede
 * Gitterzelle einen Schlagschatten auf ihren Nachbarn werfen.
 */

/** Ein Schattenpolygon: 4 Punkte als flaches [x0,y0,x1,y1,x2,y2,x3,y3]. */
export const SHADOW_QUAD_STRIDE = 8;

/** Bitmaske der freiliegenden Kanten eines Zell-Occluders. */
export const EDGE_TOP = 1;
export const EDGE_BOTTOM = 2;
export const EDGE_LEFT = 4;
export const EDGE_RIGHT = 8;
export const ALL_EDGES_EXPOSED = EDGE_TOP | EDGE_BOTTOM | EDGE_LEFT | EDGE_RIGHT;

/**
 * Sammelt projizierte Schattenquads in einem wachsenden Flat-Array.
 * `length` zählt Quads, nicht Zahlen – `data` wird nur vergrößert, nie verkleinert.
 */
export class ShadowQuadBuffer {
  data: Float64Array;
  length = 0;

  constructor(initialCapacity = 64) {
    this.data = new Float64Array(initialCapacity * SHADOW_QUAD_STRIDE);
  }

  reset(): void {
    this.length = 0;
  }

  /** Reserviert Platz für ein weiteres Quad und liefert dessen Startindex in `data`. */
  allocate(): number {
    const offset = this.length * SHADOW_QUAD_STRIDE;
    if (offset + SHADOW_QUAD_STRIDE > this.data.length) {
      const grown = new Float64Array(Math.max(SHADOW_QUAD_STRIDE, this.data.length * 2));
      grown.set(this.data);
      this.data = grown;
    }
    this.length += 1;
    return offset;
  }
}

/**
 * Schreibt ein Schattenquad aus zwei Silhouettenpunkten. Beide Punkte werden zuerst um
 * `startOffsetPx` vom Licht weggeschoben – das ist der Saum, der voll beleuchtet bleibt –
 * und von dort aus um `extendPx` weiter projiziert.
 */
function pushProjectedEdge(
  out: ShadowQuadBuffer,
  lightX: number, lightY: number,
  ax: number, ay: number,
  bx: number, by: number,
  startOffsetPx: number,
  extendPx: number,
): void {
  const adx = ax - lightX;
  const ady = ay - lightY;
  const bdx = bx - lightX;
  const bdy = by - lightY;
  const aLen = Math.hypot(adx, ady);
  const bLen = Math.hypot(bdx, bdy);
  // Licht exakt auf der Ecke: keine definierte Projektionsrichtung, Quad überspringen.
  if (aLen < 0.0001 || bLen < 0.0001) return;

  const aUnitX = adx / aLen;
  const aUnitY = ady / aLen;
  const bUnitX = bdx / bLen;
  const bUnitY = bdy / bLen;

  const offset = out.allocate();
  const data = out.data;
  data[offset]     = ax + aUnitX * startOffsetPx;
  data[offset + 1] = ay + aUnitY * startOffsetPx;
  data[offset + 2] = bx + bUnitX * startOffsetPx;
  data[offset + 3] = by + bUnitY * startOffsetPx;
  data[offset + 4] = bx + bUnitX * (startOffsetPx + extendPx);
  data[offset + 5] = by + bUnitY * (startOffsetPx + extendPx);
  data[offset + 6] = ax + aUnitX * (startOffsetPx + extendPx);
  data[offset + 7] = ay + aUnitY * (startOffsetPx + extendPx);
}

/**
 * Projiziert den Schatten einer achsenparallelen Zelle.
 *
 * Es zählen ausschließlich Kanten, die dem Licht *zugewandt* und laut `exposedEdges`
 * freiliegend sind. Zugewandt, weil der Schatten am beleuchteten Rand beginnen soll:
 * so bleibt nur ein `startOffsetPx` breiter Saum hell und die restliche Oberseite liegt
 * im Schatten. Freiliegend, weil eine Kante zwischen zwei belegten Zellen im fertigen
 * Blob gar nicht existiert und dort kein Schatten entstehen darf.
 */
export function projectRectShadowQuads(
  out: ShadowQuadBuffer,
  lightX: number, lightY: number,
  left: number, top: number, right: number, bottom: number,
  startOffsetPx: number,
  extendPx: number,
  exposedEdges: number = ALL_EDGES_EXPOSED,
): void {
  // Licht in der Zelle: es gibt keine sinnvolle Silhouette. Hier lieber gar nicht
  // verdecken, das ist der optisch harmlosere Ausgang.
  if (lightX > left && lightX < right && lightY > top && lightY < bottom) return;

  // Oberkante: Außennormale (0,-1) → zugewandt, wenn das Licht darüber liegt.
  if ((exposedEdges & EDGE_TOP) !== 0 && lightY < top) {
    pushProjectedEdge(out, lightX, lightY, left, top, right, top, startOffsetPx, extendPx);
  }
  if ((exposedEdges & EDGE_BOTTOM) !== 0 && lightY > bottom) {
    pushProjectedEdge(out, lightX, lightY, right, bottom, left, bottom, startOffsetPx, extendPx);
  }
  if ((exposedEdges & EDGE_LEFT) !== 0 && lightX < left) {
    pushProjectedEdge(out, lightX, lightY, left, bottom, left, top, startOffsetPx, extendPx);
  }
  if ((exposedEdges & EDGE_RIGHT) !== 0 && lightX > right) {
    pushProjectedEdge(out, lightX, lightY, right, top, right, bottom, startOffsetPx, extendPx);
  }
}

/**
 * Projiziert den Schatten eines Kreises über seine beiden Tangentenpunkte.
 * Liegt das Licht im Kreis, entsteht kein Quad (die Quelle steckt im Hindernis).
 */
export function projectCircleShadowQuad(
  out: ShadowQuadBuffer,
  lightX: number, lightY: number,
  centerX: number, centerY: number, radius: number,
  startOffsetPx: number,
  extendPx: number,
): void {
  const dx = centerX - lightX;
  const dy = centerY - lightY;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius || distance < 0.0001) return;

  // Tangentenpunkte: um ±asin(r/d) gedrehte Richtung, Länge sqrt(d² - r²).
  const tangentLength = Math.sqrt(distance * distance - radius * radius);
  const baseAngle = Math.atan2(dy, dx);
  const spread = Math.asin(radius / distance);

  const leftAngle = baseAngle - spread;
  const rightAngle = baseAngle + spread;
  const ax = lightX + Math.cos(leftAngle) * tangentLength;
  const ay = lightY + Math.sin(leftAngle) * tangentLength;
  const bx = lightX + Math.cos(rightAngle) * tangentLength;
  const by = lightY + Math.sin(rightAngle) * tangentLength;

  pushProjectedEdge(out, lightX, lightY, ax, ay, bx, by, startOffsetPx, extendPx);
}
