/**
 * Gemeinsamer mathematischer Resolver für direkte Trefferprüfungen (Projektil, Hitscan, Melee).
 *
 * Vollständig entkoppelt von Phaser GameObjects, Scenes, Rendering und Netzwerk.
 * Wird sowohl von Gameplay/Runtime (CombatGeometry, CombatSystem) als auch vom Headless
 * Balance Lab verwendet.
 */

export interface DirectCircleHitResult {
  readonly hit: boolean;
  readonly distance: number;
  readonly x: number;
  readonly y: number;
}

export interface MeleeArcHitResult {
  readonly hit: boolean;
  readonly distance: number;
}

/**
 * Prüft, ob ein Zielvektor (dx, dy) innerhalb eines frontalen Fächerbogens liegt.
 *
 * @param dx X-Distanz zum Ziel
 * @param dy Y-Distanz zum Ziel
 * @param facingAngle Blickrichtung im Bogenmaß
 * @param halfArcRad Halber Bogenwinkel im Bogenmaß
 */
export function isAngleWithinArc(
  dx: number,
  dy: number,
  facingAngle: number,
  halfArcRad: number,
): boolean {
  let angleDiff = Math.atan2(dy, dx) - facingAngle;
  while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
  while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
  return Math.abs(angleDiff) <= halfArcRad;
}

/**
 * Kontinuierliche Schnittprüfung eines Liniensegments gegen ein Kreishindernis/-ziel.
 *
 * Verhindert Durchtunnelung (Anti-Tunneling) bei schnellen Projektilen.
 *
 * @param x1 Start X des Segments
 * @param y1 Start Y des Segments
 * @param x2 Ende X des Segments
 * @param y2 Ende Y des Segments
 * @param cx Kreis-Mittelpunkt X
 * @param cy Kreis-Mittelpunkt Y
 * @param radius Kombinierter Kollisionsradius (Zielradius + Geschossradius)
 */
export function checkSweptCircleHit(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cx: number,
  cy: number,
  radius: number,
): DirectCircleHitResult | null {
  const insideDist = Math.hypot(cx - x1, cy - y1);
  if (insideDist <= radius) {
    return { hit: true, distance: 0, x: x1, y: y1 };
  }

  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - cx;
  const fy = y1 - cy;

  const a = dx * dx + dy * dy;
  if (a < 1e-9) {
    return null;
  }

  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);

  let tHit: number | null = null;
  if (t1 >= 0 && t1 <= 1) {
    tHit = t1;
  } else if (t2 >= 0 && t2 <= 1) {
    tHit = t2;
  }

  if (tHit === null) return null;

  const hitX = x1 + tHit * dx;
  const hitY = y1 + tHit * dy;
  const distance = Math.hypot(hitX - x1, hitY - y1);
  return { hit: true, distance, x: hitX, y: hitY };
}

/**
 * Prüft einen Hitscan-Strahl gegen ein Kreisziel unter Berücksichtigung der Strahldicke.
 */
export function checkHitscanRayCircleHit(
  startX: number,
  startY: number,
  angle: number,
  range: number,
  traceThickness: number,
  cx: number,
  cy: number,
  targetRadius: number,
): DirectCircleHitResult | null {
  const endX = startX + Math.cos(angle) * range;
  const endY = startY + Math.sin(angle) * range;
  const effectiveRadius = targetRadius + traceThickness * 0.5;
  const hit = checkSweptCircleHit(startX, startY, endX, endY, cx, cy, effectiveRadius);
  if (hit && hit.distance <= range) {
    return hit;
  }
  return null;
}

/**
 * Prüft einen Nahkampfangriff gegen ein Kreisziel auf Distanz und Winkelbogen.
 */
export function checkMeleeArcHit(
  originX: number,
  originY: number,
  angle: number,
  range: number,
  arcDegrees: number,
  cx: number,
  cy: number,
  targetRadius: number,
): MeleeArcHitResult | null {
  const dx = cx - originX;
  const dy = cy - originY;
  const distance = Math.hypot(dx, dy);
  if (distance > range + targetRadius) {
    return null;
  }
  const halfArcRad = (arcDegrees * Math.PI / 180) / 2;
  if (!isAngleWithinArc(dx, dy, angle, halfArcRad)) {
    return null;
  }
  return { hit: true, distance };
}
