import * as Phaser from 'phaser';
import {
  findNearestCircleHit as geomNearestCircleHit,
  findNearestRectangleHit as geomNearestRectangleHit,
  type GeometryHit,
} from '../utils/geometry';
import { isAngleWithinArc } from '../combat/rules/DirectCombatHitResolver';
import { ArenaObstacleIndex, OBSTACLE_BARRIER, OBSTACLE_BASE, OBSTACLE_ROCK } from './ArenaObstacleIndex';

/** Art des getroffenen Hindernisses aus dem {@link ArenaObstacleIndex}. */
export type ObstacleHitKind = 'rock' | 'trunk' | 'base' | 'barrier';

export interface ObstacleHit extends GeometryHit {
  kind: ObstacleHitKind;
  /** Index in `layout.rocks`, nur bei `kind === 'rock'`. */
  index?: number;
}

export interface ObstacleTraceOptions {
  /** Dieser Fels blockiert nicht (z. B. der Fels, aus dem der Strahl austritt). */
  skipRockIndex?: number;
  /** Coop-Defense-Basen ignorieren (Quellen oberhalb der eigenen Basisfläche). */
  ignoreBases?: boolean;
  /**
   * Korridorbreite für Körper, die breiter als die Linie sind (z. B. Translocator-Puck).
   * Hindernisse werden um diesen Betrag aufgeblasen.
   */
  clearanceRadius?: number;
}

/**
 * Gemeinsamer mathematischer Kern aller segmentbasierten Trefferprüfungen.
 *
 * Gameplay (`CombatSystem`) und eigenständige oder Headless-Aufrufer benutzen dieselbe Instanz-Art
 * dieser Klasse: Sichtlinie, Hitscan-Hindernis, Melee-Bogen und Korridorfreiheit dürfen sich
 * nicht zwischen Aufrufern unterscheiden. Die Klasse hält ausschließlich Scratch-Objekte
 * – keinen Spiel-, Activity-, Runden- oder Netzwerkzustand – und liest die Hindernisgeometrie über den
 * übergebenen {@link ArenaObstacleIndex}.
 *
 * Die Scratch-Objekte machen die Methoden bewusst nicht wiedereintrittsfähig: ein Ergebnis
 * muss ausgewertet sein, bevor der nächste Aufruf startet. Genau das war schon vorher die
 * Bedingung der entsprechenden `CombatSystem`-Privatmethoden.
 */
export class CombatGeometry {
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
    const { skipRockIndex, ignoreBases = false, clearanceRadius = 0 } = options;
    const clearance = Math.max(0, clearanceRadius);
    let bestHit: ObstacleHit | null = null;

    this.obstacleIndex.querySegment(
      line.x1, line.y1, line.x2, line.y2,
      (kind, rockIndex, left, top, right, bottom) => {
        if (kind === OBSTACLE_ROCK && rockIndex === skipRockIndex) return false;
        if (ignoreBases && kind === OBSTACLE_BASE) return false;
        const hit = this.nearestRectangleHit(
          line,
          this.obstacleRect(left - clearance, top - clearance, right + clearance, bottom + clearance),
        );
        if (hit && (!bestHit || hit.distance < bestHit.distance)) {
          bestHit = {
            ...hit,
            kind: kind === OBSTACLE_ROCK ? 'rock' : kind === OBSTACLE_BARRIER ? 'barrier' : 'base',
            ...(kind === OBSTACLE_ROCK ? { index: rockIndex } : {}),
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
    const { skipRockIndex, ignoreBases = false, clearanceRadius = 0 } = options;
    const clearance = Math.max(0, clearanceRadius);
    let blocked = false;

    this.obstacleIndex.querySegment(
      line.x1, line.y1, line.x2, line.y2,
      (kind, rockIndex, left, top, right, bottom) => {
        if (kind === OBSTACLE_ROCK && rockIndex === skipRockIndex) return false;
        if (ignoreBases && kind === OBSTACLE_BASE) return false;
        const hit = this.nearestRectangleHit(
          line,
          this.obstacleRect(left - clearance, top - clearance, right + clearance, bottom + clearance),
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
    const blockDistance = Phaser.Geom.Line.Length(line) - 2;
    return !this.isPathBlocked(line, blockDistance, options);
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
