import * as Phaser from 'phaser';

/** Treffer entlang einer Linie: Distanz vom Linienstart + Trefferpunkt. */
export interface GeometryHit {
  distance: number;
  x: number;
  y: number;
}

/**
 * Wählt aus Schnittpunkten den nächstgelegenen zum Linienstart (`x1`/`y1`).
 * Punkte direkt am Start (≤ 0.01 px) werden ignoriert (Selbsttreffer-Schutz).
 * Leert `points` nach Auswertung, damit das Scratch-Array wiederverwendbar bleibt.
 */
export function pickNearestIntersection(
  line: Phaser.Geom.Line,
  points: Phaser.Math.Vector2[],
): GeometryHit | null {
  let bestHit: GeometryHit | null = null;

  for (const point of points) {
    const distance = Phaser.Math.Distance.Between(line.x1, line.y1, point.x, point.y);
    if (distance <= 0.01) continue;
    if (!bestHit || distance < bestHit.distance) {
      bestHit = { distance, x: point.x, y: point.y };
    }
  }

  points.length = 0;
  return bestHit;
}

/**
 * Nächster Schnittpunkt einer Linie mit einem Rechteck.
 * `scratch` wird als Ausgabe-Puffer für die Schnittpunkte wiederverwendet (keine neue Allokation).
 */
export function findNearestRectangleHit(
  line: Phaser.Geom.Line,
  rect: Phaser.Geom.Rectangle,
  scratch: Phaser.Math.Vector2[],
): GeometryHit | null {
  const points = Phaser.Geom.Intersects.GetLineToRectangle(line, rect, scratch);
  return pickNearestIntersection(line, points);
}

/**
 * Nächster Schnittpunkt einer Linie mit einem Kreis.
 * `scratchCircle` und `scratch` werden wiederverwendet (keine neue Allokation pro Aufruf).
 */
export function findNearestCircleHit(
  line: Phaser.Geom.Line,
  centerX: number,
  centerY: number,
  radius: number,
  scratchCircle: Phaser.Geom.Circle,
  scratch: Phaser.Math.Vector2[],
): GeometryHit | null {
  scratchCircle.setTo(centerX, centerY, radius);
  const points = Phaser.Geom.Intersects.GetLineToCircle(line, scratchCircle, scratch);
  return pickNearestIntersection(line, points);
}
