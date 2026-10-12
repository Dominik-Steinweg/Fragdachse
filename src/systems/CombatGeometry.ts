import * as Phaser from 'phaser';
import type { CombatAreaPose } from '../combat/CombatAreaAttack';
import type { CombatPartContactSnapshot } from '../combat/CombatPartContact';
import {
  findNearestCircleHit as geomNearestCircleHit,
  findNearestRectangleHit as geomNearestRectangleHit,
  type GeometryHit,
} from '../utils/geometry';
import { isAngleWithinArc } from '../combat/rules/DirectCombatHitResolver';
import { ArenaObstacleIndex, OBSTACLE_BARRIER, OBSTACLE_BASE, OBSTACLE_ROCK } from './ArenaObstacleIndex';
import type { ObstacleRectBody } from './ArenaObstacleIndex';
import { obstacleBlocks, segmentRectInterval, type ObstacleShotOptions } from './ObstacleRules';

/** Art des getroffenen Hindernisses aus dem {@link ArenaObstacleIndex}. */
export type ObstacleHitKind = 'rock' | 'trunk' | 'base' | 'barrier';

export interface ObstacleHit extends GeometryHit {
  kind: ObstacleHitKind;
  /** Index in `layout.rocks`, nur bei `kind === 'rock'`. */
  index?: number;
  baseId?: string;
}

export interface ObstacleTraceOptions extends ObstacleShotOptions {
  /** Dieser Fels blockiert nicht (z. B. der Fels, aus dem der Strahl austritt). */
  skipRockIndex?: number;
  /**
   * Korridorbreite für Körper, die breiter als die Linie sind (z. B. Translocator-Puck).
   * Hindernisse werden um diesen Betrag aufgeblasen.
   */
  clearanceRadius?: number;
}

/**
 * Gemeinsamer mathematischer Kern aller segmentbasierten Trefferprüfungen.
 *
 * Gameplay (`WorldCombatCore`) und eigenständige oder Headless-Aufrufer benutzen dieselbe Instanz-Art
 * dieser Klasse: Sichtlinie, Hitscan-Hindernis, Melee-Bogen und Korridorfreiheit dürfen sich
 * nicht zwischen Aufrufern unterscheiden. Die Klasse hält ausschließlich Scratch-Objekte
 * – keinen Spiel-, Activity-, Runden- oder Netzwerkzustand – und liest die Hindernisgeometrie über den
 * übergebenen {@link ArenaObstacleIndex}.
 *
 * Die Scratch-Objekte machen die Methoden bewusst nicht wiedereintrittsfähig: ein Ergebnis
 * muss ausgewertet sein, bevor der nächste Aufruf startet. Genau das war schon vorher die
 * Bedingung der entsprechenden `WorldCombatCore`-Privatmethoden.
 */
export class CombatGeometry {
  /** Sector deliberately retains melee's center-angle rule; lane uses rounded circle corners. */
  static areaContainsCircle(pose: CombatAreaPose, x: number, y: number, radius: number): boolean {
    const dx = x - pose.originX, dy = y - pose.originY;
    const g = pose.geometry;
    if (g.kind === 'sector') return Math.hypot(dx, dy) <= g.range + radius
      && CombatGeometry.isWithinArc(dx, dy, pose.angle, g.arcDegrees * Math.PI / 360);
    const c = Math.cos(pose.angle), s = Math.sin(pose.angle);
    const u = dx * c + dy * s, v = -dx * s + dy * c;
    return (u - Math.max(0, Math.min(g.length, u))) ** 2
      + (v - Math.max(-g.width / 2, Math.min(g.width / 2, v))) ** 2 <= radius ** 2 + 1e-9;
  }

  static partShapes(snapshot: CombatPartContactSnapshot): readonly { ax: number; ay: number; bx: number; by: number; radius: number }[] {
    const { x, y, angle } = snapshot.contact, c = Math.cos(angle), s = Math.sin(angle);
    const point = (px: number, py: number) => ({ x: x + px * c - py * s, y: y + px * s + py * c });
    return snapshot.shapes.map(shape => {
      const a = shape.kind === 'circle' ? point(shape.x, shape.y) : point(shape.fromX, shape.fromY);
      const b = shape.kind === 'circle' ? a : point(shape.toX, shape.toY);
      return { ax: a.x, ay: a.y, bx: b.x, by: b.y, radius: shape.radius };
    });
  }

  /** Nearest exposed surface, never the hidden root or the outgoing attack lane. */
  static nearestPartPoint(snapshot: CombatPartContactSnapshot, x: number, y: number) {
    let best: { x: number; y: number; distance: number } | null = null;
    for (const p of CombatGeometry.partShapes(snapshot)) {
      const dx = p.bx - p.ax, dy = p.by - p.ay, length2 = dx * dx + dy * dy;
      const t = length2 ? Math.max(0, Math.min(1, ((x - p.ax) * dx + (y - p.ay) * dy) / length2)) : 0;
      const cx = p.ax + t * dx, cy = p.ay + t * dy, d = Math.hypot(x - cx, y - cy);
      const distance = Math.max(0, d - p.radius), scale = d > 0 ? distance / d : 0;
      const candidate = { x: x + (cx - x) * scale, y: y + (cy - y) * scale, distance };
      if (!best || distance < best.distance) best = candidate;
    }
    return best;
  }

  /** Sector membership of exposed capsule centerlines, retaining the melee radius rule. */
  static partMeleeContact(snapshot: CombatPartContactSnapshot, pose: CombatAreaPose) {
    if (pose.geometry.kind !== 'sector') return null;
    let best: { x: number; y: number; radius: number; distance: number } | null = null;
    for (const p of CombatGeometry.partShapes(snapshot)) {
      const dx = p.bx - p.ax, dy = p.by - p.ay, length2 = dx * dx + dy * dy;
      const ts = [0, 1, length2 ? Math.max(0, Math.min(1,
        ((pose.originX - p.ax) * dx + (pose.originY - p.ay) * dy) / length2)) : 0];
      for (const angle of [pose.angle - pose.geometry.arcDegrees * Math.PI / 360, pose.angle + pose.geometry.arcDegrees * Math.PI / 360]) {
        const c = Math.cos(angle), s = Math.sin(angle), denominator = dx * s - dy * c;
        if (Math.abs(denominator) < 1e-12) continue;
        const t = ((pose.originX - p.ax) * s - (pose.originY - p.ay) * c) / denominator;
        if (t >= 0 && t <= 1) ts.push(t);
      }
      for (const t of ts) {
        const x = p.ax + dx * t, y = p.ay + dy * t;
        if (!CombatGeometry.areaContainsCircle(pose, x, y, p.radius)) continue;
        const distance = Math.hypot(x - pose.originX, y - pose.originY);
        if (!best || distance < best.distance) best = { x, y, radius: p.radius, distance };
      }
    }
    return best;
  }

  /** Exact segment vs circle/capsule union, expanded by the projectile's collision radius. */
  static tracePart(snapshot: CombatPartContactSnapshot, sx: number, sy: number, ex: number, ey: number, padding = 0) {
    const dx = ex - sx, dy = ey - sy, length = Math.hypot(dx, dy);
    let first = Infinity;
    for (const p of CombatGeometry.partShapes(snapshot)) {
      const radius = p.radius + padding;
      const vx = p.bx - p.ax, vy = p.by - p.ay, vl = Math.hypot(vx, vy);
      const circle = (x: number, y: number) => {
        const ox = sx - x, oy = sy - y, cc = ox * ox + oy * oy - radius * radius;
        if (cc <= 0) { first = 0; return; }
        const aa = dx * dx + dy * dy, bb = ox * dx + oy * dy, disc = bb * bb - aa * cc;
        if (aa === 0 || disc < 0) return;
        const t = (-bb - Math.sqrt(disc)) / aa;
        if (t >= 0 && t <= 1) first = Math.min(first, t);
      };
      circle(p.ax, p.ay); circle(p.bx, p.by);
      if (vl > 0) {
        const c = vx / vl, s = vy / vl;
        const u = (sx - p.ax) * c + (sy - p.ay) * s, v = -(sx - p.ax) * s + (sy - p.ay) * c;
        const du = dx * c + dy * s, dv = -dx * s + dy * c;
        let lo = 0, hi = 1;
        for (const [start, delta, min, max] of [[u, du, 0, vl], [v, dv, -radius, radius]]) {
          if (delta === 0) { if (start < min || start > max) hi = -1; }
          else { const a = (min - start) / delta, b = (max - start) / delta;
            lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b)); }
        }
        if (lo <= hi) first = Math.min(first, lo);
      }
    }
    return Number.isFinite(first) ? { x: sx + dx * first, y: sy + dy * first, distance: length * first } : null;
  }
  private readonly scratchCircle = new Phaser.Geom.Circle();
  private readonly scratchPoints: Phaser.Math.Vector2[] = [];
  /** Ziel der aus dem Index gelieferten Hindernis-Bounds, damit kein Rechteck pro Kandidat entsteht. */
  private readonly scratchObstacleRect = new Phaser.Geom.Rectangle();
  private readonly scratchLine = new Phaser.Geom.Line();

  constructor(private readonly obstacleIndex: ArenaObstacleIndex) {}

  /** Nächster Schnittpunkt der Linie mit einem Rechteck. */
  nearestRectangleHit(line: Phaser.Geom.Line, rect: Phaser.Geom.Rectangle): GeometryHit | null {
    return geomNearestRectangleHit(line, rect, this.scratchPoints);
  }

  /** Nächster Schnittpunkt der Linie mit einem Kreis. */
  nearestCircleHit(
    line: Phaser.Geom.Line,
    centerX: number,
    centerY: number,
    radius: number,
  ): GeometryHit | null {
    return geomNearestCircleHit(line, centerX, centerY, radius, this.scratchCircle, this.scratchPoints);
  }

  /** Übernimmt die vom Hindernis-Index gelieferten Kanten in das Scratch-Rechteck. */
  obstacleRect(left: number, top: number, right: number, bottom: number): Phaser.Geom.Rectangle {
    return this.scratchObstacleRect.setTo(left, top, right - left, bottom - top);
  }

  /**
   * Nächstes Hindernis auf dem Segment. Arena-Außenwände und bewegliche Sonderkörper gehören
   * nicht hierher – die kennt nur der jeweilige Aufrufer und vergleicht sie selbst gegen
   * dieses Ergebnis.
   */
  nearestObstacleHit(line: Phaser.Geom.Line, options: ObstacleTraceOptions = {}): ObstacleHit | null {
    const { clearanceRadius = 0 } = options;
    const halfWidth = Math.max(0, options.halfWidth ?? clearanceRadius);
    const halfHeight = Math.max(0, options.halfHeight ?? clearanceRadius);
    const clearance = Math.max(halfWidth, halfHeight);
    const carrierExit = this.carrierExitFraction(line.x1, line.y1, line.x2, line.y2, options.sourceCarrierBaseId, halfWidth, halfHeight);
    let bestHit: ObstacleHit | null = null;

    this.obstacleIndex.querySegment(
      line.x1, line.y1, line.x2, line.y2,
      (kind, rockIndex, left, top, right, bottom, source) => {
        const interval = segmentRectInterval(line.x1, line.y1, line.x2, line.y2,
          left - halfWidth, top - halfHeight, right + halfWidth, bottom + halfHeight);
        if (!interval || this.ignoresRect(kind, rockIndex, source, options, interval.enter, carrierExit)) return false;
        const hit = options.purpose && options.purpose !== 'physical'
          ? { x: line.x1 + (line.x2 - line.x1) * Math.max(0, interval.enter),
            y: line.y1 + (line.y2 - line.y1) * Math.max(0, interval.enter),
            distance: Math.hypot(line.x2 - line.x1, line.y2 - line.y1) * Math.max(0, interval.enter) }
          : this.nearestRectangleHit(line, this.obstacleRect(left - halfWidth, top - halfHeight, right + halfWidth, bottom + halfHeight));
        if (hit && (!bestHit || hit.distance < bestHit.distance)) {
          bestHit = {
            ...hit,
            kind: kind === OBSTACLE_ROCK ? 'rock' : kind === OBSTACLE_BARRIER ? 'barrier' : 'base',
            ...(kind === OBSTACLE_ROCK ? { index: rockIndex } : {}),
            ...(kind === OBSTACLE_BASE ? { baseId: this.obstacleIndex.getBaseId(source) } : {}),
          };
        }
        return false;
      },
      (centerX, centerY, radius) => {
        const hit = this.nearestCircleHit(line, centerX, centerY, radius + clearance);
        if (hit && (!bestHit || hit.distance < bestHit.distance)) bestHit = { ...hit, kind: 'trunk' };
        return false;
      },
      clearance,
    );

    return bestHit;
  }

  /**
   * Blockiert ein Hindernis das Segment vor `maxDistance`? Frühausstieg beim ersten Treffer;
   * Arena-Außenwände zählen nicht mit.
   */
  isPathBlocked(
    line: Phaser.Geom.Line,
    maxDistance: number,
    options: ObstacleTraceOptions = {},
  ): boolean {
    const { clearanceRadius = 0 } = options;
    const halfWidth = Math.max(0, options.halfWidth ?? clearanceRadius);
    const halfHeight = Math.max(0, options.halfHeight ?? clearanceRadius);
    const clearance = Math.max(halfWidth, halfHeight);
    const carrierExit = this.carrierExitFraction(line.x1, line.y1, line.x2, line.y2, options.sourceCarrierBaseId, halfWidth, halfHeight);
    let blocked = false;

    this.obstacleIndex.querySegment(
      line.x1, line.y1, line.x2, line.y2,
      (kind, rockIndex, left, top, right, bottom, source) => {
        const interval = segmentRectInterval(line.x1, line.y1, line.x2, line.y2,
          left - halfWidth, top - halfHeight, right + halfWidth, bottom + halfHeight);
        if (!interval || this.ignoresRect(kind, rockIndex, source, options, interval.enter, carrierExit)) return false;
        if (options.purpose && options.purpose !== 'physical') {
          if (Math.max(0, interval.enter) * Math.hypot(line.x2 - line.x1, line.y2 - line.y1) < maxDistance) { blocked = true; return true; }
          return false;
        }
        const hit = this.nearestRectangleHit(
          line,
          this.obstacleRect(left - halfWidth, top - halfHeight, right + halfWidth, bottom + halfHeight),
        );
        if (hit && hit.distance < maxDistance) { blocked = true; return true; }
        return false;
      },
      (centerX, centerY, radius) => {
        const hit = this.nearestCircleHit(line, centerX, centerY, radius + clearance);
        if (hit && hit.distance < maxDistance) { blocked = true; return true; }
        return false;
      },
      clearance,
    );

    return blocked;
  }

  getRockClass(index: number) { return this.obstacleIndex.getRockClass(index); }

  /** Narrow phase for a base identity; aggregate bounds never become collision geometry. */
  baseHit(baseId: string, sx: number, sy: number, ex: number, ey: number,
    halfWidth = 0, halfHeight = halfWidth, sourceCarrierBaseId?: string): GeometryHit | null {
    const carrierExit = this.carrierExitFraction(sx, sy, ex, ey, sourceCarrierBaseId, halfWidth, halfHeight);
    let nearest = Infinity;
    this.obstacleIndex.querySegment(sx, sy, ex, ey, (kind, _id, l, t, r, b, source) => {
      if (kind !== OBSTACLE_BASE || this.obstacleIndex.getBaseId(source) !== baseId) return false;
      const interval = segmentRectInterval(sx, sy, ex, ey, l - halfWidth, t - halfHeight, r + halfWidth, b + halfHeight);
      if (!interval || (baseId === sourceCarrierBaseId && carrierExit >= 0 && interval.enter <= carrierExit + 1e-9)) return false;
      nearest = Math.min(nearest, Math.max(0, interval.enter));
      return false;
    }, () => false, Math.max(halfWidth, halfHeight));
    return Number.isFinite(nearest) ? { x: sx + (ex - sx) * nearest, y: sy + (ey - sy) * nearest,
      distance: Math.hypot(ex - sx, ey - sy) * nearest } : null;
  }

  carrierExitFraction(sx: number, sy: number, ex: number, ey: number, baseId?: string,
    halfWidth = 0, halfHeight = halfWidth): number {
    return this.obstacleIndex.carrierExitFraction(baseId, sx, sy, ex, ey, halfWidth, halfHeight);
  }

  private ignoresRect(kind: number, rockIndex: number, source: ObstacleRectBody,
    options: ObstacleTraceOptions, enter: number, carrierExit: number): boolean {
    if (kind !== OBSTACLE_ROCK && source.obstacleClass
      && !obstacleBlocks(source.obstacleClass, options.purpose ?? 'physical')) return true;
    if (kind === OBSTACLE_ROCK) {
      if (rockIndex === options.skipRockIndex || options.ignoreRocks) return true;
      const height = this.obstacleIndex.getRockClass(rockIndex);
      if (!obstacleBlocks(height, options.purpose ?? 'physical')) return true;
      if (height === 'low' && options.purpose === 'support'
        && options.acceptsLowTarget && !options.acceptsLowTarget(rockIndex)) return true;
    }
    return kind === OBSTACLE_BASE && options.sourceCarrierBaseId !== undefined
      && this.obstacleIndex.getBaseId(source) === options.sourceCarrierBaseId
      && carrierExit >= 0 && enter <= carrierExit + 1e-9;
  }

  /**
   * Freie Sichtlinie zwischen zwei Punkten. Die letzten 2 px vor dem Ziel zählen nicht mit,
   * damit ein Hindernis direkt hinter dem Ziel die Linie nicht sperrt.
   */
  hasLineOfSight(
    startX: number, startY: number,
    endX: number, endY: number,
    options: ObstacleTraceOptions = {},
  ): boolean {
    const line = this.scratchLine.setTo(startX, startY, endX, endY);
    const blockDistance = Math.hypot(line.x2 - line.x1, line.y2 - line.y1) - 2;
    return !this.isPathBlocked(line, blockDistance, options);
  }

  /**
   * Does any part of a segment remain visible from an origin? Visibility can change only at
   * obstacle silhouettes or segment/obstacle intersections. Partition at those boundaries,
   * then use the canonical LOS rule on each interval; a shielded midpoint alone is insufficient.
   */
  hasVisibleSegmentFrom(cx: number, cy: number, ax: number, ay: number, bx: number, by: number): boolean {
    const dx = bx - ax, dy = by - ay;
    if (Math.hypot(dx, dy) < 0.000001) return this.hasLineOfSight(cx, cy, ax, ay);
    const cuts = [0, 1];
    const cut = (t: number) => { if (t > 0 && t < 1) cuts.push(t); };
    const ray = (rx: number, ry: number) => {
      const determinant = rx * dy - ry * dx;
      if (Math.abs(determinant) < 0.000001) return;
      const ox = ax - cx, oy = ay - cy;
      const alongRay = (ox * dy - oy * dx) / determinant;
      if (alongRay >= 0) cut((ox * ry - oy * rx) / determinant);
    };
    const edge = (x: number, y: number, ex: number, ey: number) => {
      const determinant = dx * ey - dy * ex;
      if (Math.abs(determinant) < 0.000001) return;
      const ox = x - ax, oy = y - ay;
      const u = (ox * dy - oy * dx) / determinant;
      if (u >= 0 && u <= 1) cut((ox * ey - oy * ex) / determinant);
    };
    const radius = Math.max(Math.hypot(ax - cx, ay - cy), Math.hypot(bx - cx, by - cy));
    this.obstacleIndex.querySegment(cx, cy, cx, cy, (_kind, _id, left, top, right, bottom) => {
      for (const [x, y] of [[left, top], [right, top], [right, bottom], [left, bottom]]) ray(x - cx, y - cy);
      edge(left, top, right - left, 0); edge(right, top, 0, bottom - top);
      edge(left, bottom, right - left, 0); edge(left, top, 0, bottom - top);
      return false;
    }, (x, y, r) => {
      const ox = x - cx, oy = y - cy, distance = Math.hypot(ox, oy);
      if (distance > r) {
        const angle = Math.atan2(oy, ox), offset = Math.asin(r / distance);
        ray(Math.cos(angle - offset), Math.sin(angle - offset));
        ray(Math.cos(angle + offset), Math.sin(angle + offset));
      }
      const qx = ax - x, qy = ay - y, lengthSq = dx * dx + dy * dy;
      const dot = qx * dx + qy * dy, discriminant = dot * dot - lengthSq * (qx * qx + qy * qy - r * r);
      if (discriminant >= 0) { cut((-dot - Math.sqrt(discriminant)) / lengthSq); cut((-dot + Math.sqrt(discriminant)) / lengthSq); }
      return false;
    }, radius);
    cuts.sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i] - cuts[i - 1] < 0.000001) continue;
      const t = (cuts[i] + cuts[i - 1]) / 2;
      if (this.hasLineOfSight(cx, cy, ax + dx * t, ay + dy * t)) return true;
    }
    return false;
  }

  /**
   * Liegt ein Ziel im Trefferbogen einer Nahkampfattacke? `facingAngle` und die aus
   * `dx`/`dy` gebildete Zielrichtung sind Weltwinkel im Bogenmaß.
   */
  static isWithinArc(dx: number, dy: number, facingAngle: number, halfArcRad: number): boolean {
    return isAngleWithinArc(dx, dy, facingAngle, halfArcRad);
  }

  /**
   * Trefferdistanz eines bewegten Kreisziels entlang des Segments.
   *
   * Geprüft werden die aktuelle Position, die um `rewindMs` zurückgerechnete Position und ein
   * aufgeweiteter Kreis auf halbem Weg dazwischen – der überstrichene Korridor. Damit trifft
   * ein Schuss auch dann, wenn das Ziel zwischen zwei Frames am Strahl vorbeigezogen ist.
   */
  sweptCircleHitDistance(
    line: Phaser.Geom.Line,
    centerX: number, centerY: number,
    velocityX: number, velocityY: number,
    radius: number,
    rewindMs: number,
    maxRewindOffset: number,
  ): number | null {
    const currentHit = this.nearestCircleHit(line, centerX, centerY, radius);

    const rewindX = centerX - velocityX * (rewindMs / 1000);
    const rewindY = centerY - velocityY * (rewindMs / 1000);
    const rewindHit = this.nearestCircleHit(line, rewindX, rewindY, radius);

    const rewindOffset = Math.min(
      maxRewindOffset,
      Phaser.Math.Distance.Between(centerX, centerY, rewindX, rewindY),
    );
    const sweepHit = this.nearestCircleHit(
      line,
      (centerX + rewindX) * 0.5,
      (centerY + rewindY) * 0.5,
      radius + rewindOffset * 0.5,
    );

    let best: number | null = null;
    for (const hit of [currentHit, rewindHit, sweepHit]) {
      if (!hit) continue;
      if (best === null || hit.distance < best) best = hit.distance;
    }
    return best;
  }
}
