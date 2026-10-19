import type { SpawnFront } from '../types';

/**
 * Richtungsgeometrie für Spawnwarnungen: Eine Zone wird vom Bezugspunkt (Mitte des sichtbaren
 * Bereichs) aus auf einen rechteckigen Rand projiziert, und die Richtung wird als Achtel-Kompass
 * benannt. Reine Mathematik ohne Phaser; Bildschirmkoordinaten, y zeigt nach unten.
 *
 * Der Rand wird als Umfang parametrisiert: ab der linken oberen Ecke im Uhrzeigersinn, also
 * Nordseite nach Osten, Ostseite nach Süden, Südseite nach Westen, Westseite nach Norden. Ein
 * Intervall auf diesem Umfang darf damit um Ecken laufen.
 */

/** Achtel-Kompass im Bildschirmsinn: Norden ist oben (−y). */
export type CompassDirection8 =
  | 'north'
  | 'northEast'
  | 'east'
  | 'southEast'
  | 'south'
  | 'southWest'
  | 'west'
  | 'northWest';

export interface BorderRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface WorldRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Authored Spawnzone in Welt-Pixeln; die ID hält die Darstellung über Frames stabil. */
export interface SpawnZoneRect extends WorldRect {
  readonly id: string;
}

export interface PerimeterInterval {
  /** Umfangsposition des Anfangs in [0, Umfang). */
  readonly start: number;
  /** Länge im Uhrzeigersinn, höchstens der ganze Umfang. */
  readonly length: number;
}

export interface PerimeterPoint {
  readonly x: number;
  readonly y: number;
  readonly side: SpawnFront;
}

/** Ein Abschnitt auf genau einer Randseite. */
export interface BorderSidePiece {
  readonly side: SpawnFront;
  /** Feste Koordinate der Seite: y für Nord/Süd, x für West/Ost. */
  readonly at: number;
  /** Spanne entlang der Seite mit `low <= high`: x für Nord/Süd, y für West/Ost. */
  readonly low: number;
  readonly high: number;
  /** Der Gesamtabschnitt läuft am niedrigen bzw. hohen Ende um die Ecke weiter. */
  readonly openLow: boolean;
  readonly openHigh: boolean;
}

export interface BorderProjectionOptions {
  /** Kürzere Projektionen werden symmetrisch auf diese Länge erweitert. */
  readonly minSpan: number;
  /** Längere Projektionen werden um den Strahl zur Zonenmitte gekürzt. */
  readonly maxSpan: number;
}

/** Kompass-Sektoren im Uhrzeigersinn ab Osten, passend zu `atan2` mit y nach unten. */
const COMPASS_BY_SECTOR: readonly CompassDirection8[] = [
  'east', 'southEast', 'south', 'southWest', 'west', 'northWest', 'north', 'northEast',
];

/** Benennt einen Richtungsvektor; ohne Richtung (Nullvektor) gibt es keinen Namen. */
export function compass8(dx: number, dy: number): CompassDirection8 | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return null;
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return COMPASS_BY_SECTOR[((sector % 8) + 8) % 8];
}

/** Eine Front ist eine ganze Arenaseite; ihre Richtung hängt nicht vom Blickpunkt ab. */
export function compassOfSpawnFront(front: SpawnFront): CompassDirection8 {
  return front;
}

export function perimeterLength(border: BorderRect): number {
  const width = Math.max(0, border.right - border.left);
  const height = Math.max(0, border.bottom - border.top);
  return 2 * (width + height);
}

/** Punkt auf dem Umfang; eine Ecke gehört zu der Seite, die an ihr beginnt. */
export function pointAtPerimeter(border: BorderRect, position: number): PerimeterPoint {
  const width = Math.max(0, border.right - border.left);
  const height = Math.max(0, border.bottom - border.top);
  let rest = wrap(position, 2 * (width + height));
  if (rest < width) return { x: border.left + rest, y: border.top, side: 'north' };
  rest -= width;
  if (rest < height) return { x: border.right, y: border.top + rest, side: 'east' };
  rest -= height;
  if (rest < width) return { x: border.right - rest, y: border.bottom, side: 'south' };
  rest -= width;
  return { x: border.left, y: border.bottom - Math.min(rest, height), side: 'west' };
}

/**
 * Projiziert eine Zone vom Bezugspunkt aus auf den Rand: Das Intervall reicht vom Strahl zur
 * einen bis zum Strahl zur anderen Zonenkante und läuft dabei gegebenenfalls um Ecken. Liegt der
 * Bezugspunkt in der Zone, gibt es keine Richtung und damit kein Intervall.
 */
export function projectZoneOntoBorder(
  border: BorderRect,
  viewCentre: { readonly x: number; readonly y: number },
  zone: WorldRect,
  options: BorderProjectionOptions,
): PerimeterInterval | null {
  const perimeter = perimeterLength(border);
  if (!(perimeter > 0) || !Number.isFinite(viewCentre.x) || !Number.isFinite(viewCentre.y)) return null;
  // Strahlen brauchen einen Ursprung im Rand; ein Blickpunkt außerhalb wird hineingeklemmt.
  const originX = clamp(viewCentre.x, border.left, border.right);
  const originY = clamp(viewCentre.y, border.top, border.bottom);
  const zoneRight = zone.x + zone.width;
  const zoneBottom = zone.y + zone.height;
  if (originX >= zone.x && originX <= zoneRight && originY >= zone.y && originY <= zoneBottom) return null;

  const centreAngle = Math.atan2(zone.y + zone.height / 2 - originY, zone.x + zone.width / 2 - originX);
  // Eine konvexe Zone ohne den Ursprung überdeckt weniger als einen Halbkreis; die Eckwinkel
  // relativ zur Mittelrichtung liegen deshalb sprungfrei in (−π, π).
  let lowAngle = 0;
  let highAngle = 0;
  for (const [cornerX, cornerY] of [[zone.x, zone.y], [zoneRight, zone.y], [zoneRight, zoneBottom], [zone.x, zoneBottom]]) {
    const delta = wrapAngle(Math.atan2(cornerY - originY, cornerX - originX) - centreAngle);
    lowAngle = Math.min(lowAngle, delta);
    highAngle = Math.max(highAngle, delta);
  }
  // Der Umfang läuft im Uhrzeigersinn wie der Winkel von `atan2` mit y nach unten.
  const startPosition = castRayOntoBorder(border, originX, originY, centreAngle + lowAngle);
  const endPosition = castRayOntoBorder(border, originX, originY, centreAngle + highAngle);
  const anchorPosition = castRayOntoBorder(border, originX, originY, centreAngle);
  let start = startPosition;
  let length = wrap(endPosition - startPosition, perimeter);

  const maxSpan = clamp(Number.isFinite(options.maxSpan) ? options.maxSpan : perimeter, 0, perimeter);
  const minSpan = clamp(Number.isFinite(options.minSpan) ? options.minSpan : 0, 0, maxSpan);
  if (length < minSpan) {
    start -= (minSpan - length) / 2;
    length = minSpan;
  } else if (length > maxSpan) {
    // Gekürzt wird um die Zonenmitte, ohne das projizierte Zonenintervall zu verlassen.
    const anchorOffset = Math.min(length, wrap(anchorPosition - startPosition, perimeter));
    start += clamp(anchorOffset - maxSpan / 2, 0, length - maxSpan);
    length = maxSpan;
  }
  return { start: wrap(start, perimeter), length };
}

/** Zerlegt ein Umfangsintervall in Seitenstücke, in Umlaufrichtung geordnet. */
export function splitPerimeterSegment(border: BorderRect, interval: PerimeterInterval): BorderSidePiece[] {
  const width = Math.max(0, border.right - border.left);
  const height = Math.max(0, border.bottom - border.top);
  const perimeter = 2 * (width + height);
  if (!(perimeter > 0) || !(interval.length > 0)) return [];
  const sides: readonly { readonly side: SpawnFront; readonly from: number; readonly to: number }[] = [
    { side: 'north', from: 0, to: width },
    { side: 'east', from: width, to: width + height },
    { side: 'south', from: width + height, to: 2 * width + height },
    { side: 'west', from: 2 * width + height, to: perimeter },
  ];
  const pieces: BorderSidePiece[] = [];
  let position = wrap(interval.start, perimeter);
  let remaining = Math.min(interval.length, perimeter);
  // Höchstens fünf Stücke: ein voller Umlauf beginnt und endet auf derselben Seite.
  for (let guard = 0; remaining > PERIMETER_EPSILON && guard < 8; guard += 1) {
    const sideSpan = sides.find(candidate => position >= candidate.from && position < candidate.to);
    if (!sideSpan) {
      position = wrap(position, perimeter);
      continue;
    }
    const take = Math.min(remaining, sideSpan.to - position);
    const openStart = pieces.length > 0;
    const openEnd = remaining - take > PERIMETER_EPSILON;
    const from = position - sideSpan.from;
    const to = from + take;
    pieces.push(toSidePiece(border, sideSpan.side, from, to, openStart, openEnd));
    remaining -= take;
    position = wrap(position + take, perimeter);
  }
  return pieces;
}

/**
 * Vereinigt sich überlappende Umfangsintervalle. Jede Gruppe behält ihre Mitglieder in
 * Eingabereihenfolge, damit die Darstellung sie stabil benennen kann.
 */
export function mergePerimeterIntervals<T extends PerimeterInterval>(
  perimeter: number,
  intervals: readonly T[],
): { readonly interval: PerimeterInterval; readonly members: readonly T[] }[] {
  const groups = intervals.map(interval => ({
    start: wrap(interval.start, perimeter),
    length: Math.min(interval.length, perimeter),
    members: [interval],
  }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let a = 0; a < groups.length && !merged; a += 1) {
      for (let b = a + 1; b < groups.length && !merged; b += 1) {
        const first = groups[a];
        const second = groups[b];
        const secondOffset = wrap(second.start - first.start, perimeter);
        const firstOffset = wrap(first.start - second.start, perimeter);
        if (secondOffset <= first.length) {
          first.length = Math.min(perimeter, Math.max(first.length, secondOffset + second.length));
        } else if (firstOffset <= second.length) {
          first.length = Math.min(perimeter, Math.max(second.length, firstOffset + first.length));
          first.start = second.start;
        } else {
          continue;
        }
        first.members = [...first.members, ...second.members]
          .sort((left, right) => intervals.indexOf(left) - intervals.indexOf(right));
        groups.splice(b, 1);
        merged = true;
      }
    }
  }
  return groups.map(group => ({ interval: { start: group.start, length: group.length }, members: group.members }));
}

const PERIMETER_EPSILON = 1e-6;

function toSidePiece(
  border: BorderRect,
  side: SpawnFront,
  from: number,
  to: number,
  openStart: boolean,
  openEnd: boolean,
): BorderSidePiece {
  // Nord- und Ostseite laufen zur hohen Koordinate, Süd- und Westseite zurück zur niedrigen.
  switch (side) {
    case 'north':
      return { side, at: border.top, low: border.left + from, high: border.left + to, openLow: openStart, openHigh: openEnd };
    case 'east':
      return { side, at: border.right, low: border.top + from, high: border.top + to, openLow: openStart, openHigh: openEnd };
    case 'south':
      return { side, at: border.bottom, low: border.right - to, high: border.right - from, openLow: openEnd, openHigh: openStart };
    case 'west':
      return { side, at: border.left, low: border.bottom - to, high: border.bottom - from, openLow: openEnd, openHigh: openStart };
  }
}

/** Umfangsposition des Treffers eines Strahls aus dem Randinneren. */
function castRayOntoBorder(border: BorderRect, originX: number, originY: number, angle: number): number {
  const width = Math.max(0, border.right - border.left);
  const height = Math.max(0, border.bottom - border.top);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const tx = dx > 0 ? (border.right - originX) / dx : dx < 0 ? (border.left - originX) / dx : Infinity;
  const ty = dy > 0 ? (border.bottom - originY) / dy : dy < 0 ? (border.top - originY) / dy : Infinity;
  if (tx < ty) {
    const y = clamp(originY + dy * tx, border.top, border.bottom);
    return dx > 0 ? width + (y - border.top) : wrap(2 * width + height + (border.bottom - y), 2 * (width + height));
  }
  const x = clamp(originX + dx * ty, border.left, border.right);
  return dy > 0 ? width + height + (border.right - x) : x - border.left;
}

function wrap(value: number, period: number): number {
  if (!(period > 0)) return 0;
  const result = value % period;
  return result < 0 ? result + period : result;
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
