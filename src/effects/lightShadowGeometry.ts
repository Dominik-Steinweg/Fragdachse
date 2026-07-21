/**
 * Projektion von Schattenpolygonen für dynamische Lichtverdeckung.
 *
 * Reine Geometrie ohne Phaser-Abhängigkeit, damit sie ohne WebGL-Kontext testbar bleibt.
 * Alle Funktionen schreiben in vorab allokierte Buffer – auf dem Licht-Pfad wird pro
 * Frame und Lichtquelle über etliche Occluder iteriert, dort darf nichts allokiert werden.
 *
 * Modell (90°-Draufsicht): Der Schatten beginnt an der vom Licht abgewandten Kante des
 * Hindernisses und läuft radial vom Licht weg. Die Oberseite des Hindernisses selbst
 * bleibt beleuchtet – aus der Vogelperspektive ist genau sie dem Licht zugewandt.
 */

/** Ein Schattenpolygon: 4 Punkte als flaches [x0,y0,x1,y1,x2,y2,x3,y3]. */
export const SHADOW_QUAD_STRIDE = 8;

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
 * Schreibt ein Schattenquad aus zwei Silhouettenpunkten: die Kante A→B bleibt stehen,
 * die beiden anderen Ecken liegen auf den vom Licht weglaufenden Strahlen.
 */
function pushProjectedEdge(
  out: ShadowQuadBuffer,
  lightX: number, lightY: number,
  ax: number, ay: number,
  bx: number, by: number,
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

  const offset = out.allocate();
  const data = out.data;
  data[offset]     = ax;
  data[offset + 1] = ay;
  data[offset + 2] = bx;
  data[offset + 3] = by;
  data[offset + 4] = bx + (bdx / bLen) * extendPx;
  data[offset + 5] = by + (bdy / bLen) * extendPx;
  data[offset + 6] = ax + (adx / aLen) * extendPx;
  data[offset + 7] = ay + (ady / aLen) * extendPx;
}

/**
 * Projiziert den Schatten eines achsenparallelen Rechtecks.
 *
 * Für jede der vier Kanten wird geprüft, ob das Licht hinter deren Ebene liegt, die
 * Kante also abgewandt ist. Nur abgewandte Kanten werfen Schatten; die Vereinigung
 * ihrer Projektionen ist exakt der Silhouetten-Schatten, ohne die neun Voronoi-Fälle
 * einzeln behandeln zu müssen. Je nach Lage des Lichts entstehen zwei oder drei Quads.
 */
export function projectRectShadowQuads(
  out: ShadowQuadBuffer,
  lightX: number, lightY: number,
  left: number, top: number, right: number, bottom: number,
  extendPx: number,
): void {
  // Licht im Hindernis: es gibt keine sinnvolle Silhouette. Alle vier Kanten wären
  // abgewandt und würden die Umgebung komplett schwärzen – hier lieber gar nicht
  // verdecken, das ist der optisch harmlosere Ausgang.
  if (lightX > left && lightX < right && lightY > top && lightY < bottom) return;

  // Oberkante: Außennormale (0,-1) → abgewandt, wenn das Licht unterhalb ihrer Ebene liegt.
  if (lightY > top) pushProjectedEdge(out, lightX, lightY, left, top, right, top, extendPx);
  // Unterkante
  if (lightY < bottom) pushProjectedEdge(out, lightX, lightY, right, bottom, left, bottom, extendPx);
  // Linke Kante
  if (lightX > left) pushProjectedEdge(out, lightX, lightY, left, bottom, left, top, extendPx);
  // Rechte Kante
  if (lightX < right) pushProjectedEdge(out, lightX, lightY, right, top, right, bottom, extendPx);
}

/**
 * Projiziert den Schatten eines Kreises über seine beiden Tangentenpunkte.
 * Liegt das Licht im Kreis, entsteht kein Quad (die Quelle steckt im Hindernis).
 */
export function projectCircleShadowQuad(
  out: ShadowQuadBuffer,
  lightX: number, lightY: number,
  centerX: number, centerY: number, radius: number,
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

  pushProjectedEdge(out, lightX, lightY, ax, ay, bx, by, extendPx);
}
