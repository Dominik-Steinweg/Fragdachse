import * as Phaser from 'phaser';
import { BURN_TICK_INTERVAL_MS, isPointInsideArena } from '../config';
import type {
  BurnOnHitConfig,
  FireGrenadeEffect,
  SyncedBurningGroundSnapshot,
  SyncedFireZone,
} from '../types';

/** Gemeinsames, weltweites Raster fuer alle persistenten Brandflaechen. */
export const GROUND_FIRE_CELL_SIZE = 16;

const FADE_IN_MS = 180;
const FADE_OUT_MS = 500;
const FLOW_DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
  [1, -1], [1, 1], [-1, 1], [-1, -1],
];

export interface FireDamageEvent {
  sourceId: string;
  x: number;
  y: number;
  radius: number;
  damage: number;
  ownerId: string;
  rockDamageMult: number;
  trainDamageMult: number;
  weaponName: string;
}

export interface GroundFireContact {
  sourceId: string;
  x: number;
  y: number;
  ownerId: string;
  damagePerTick: number;
  allowTeamDamage: boolean;
  burn?: BurnOnHitConfig;
  weaponName: string;
}

export interface GroundFireProjectileIgniter {
  sourceId: string;
  ownerId: string;
  burn: BurnOnHitConfig;
}

export interface GroundFireOwner {
  sourceId: string;
  ownerId: string;
}

export interface WildfireSourceInfo {
  sourceId: string;
  ownerId: string;
  speedMultiplier: number;
  trailDurationMs: number;
  trailDamagePerTick: number;
  burn?: BurnOnHitConfig;
}

export interface GroundFireCellOptions {
  /** Stabiler logischer Schluessel; pro Rasterzelle wird daraus eine auffrischbare Quelle. */
  sourceKey: string;
  ownerId: string;
  durationMs: number;
  damagePerTick?: number;
  allowTeamDamage?: boolean;
  burn?: BurnOnHitConfig;
  igniteProjectiles?: boolean;
  weaponName?: string;
}

interface ActiveGroundSource {
  id: number;
  key: string;
  ownerId: string;
  x: number;
  y: number;
  radius: number;
  createdAt: number;
  expiresAt: number;
  damagePerTick: number;
  allowTeamDamage: boolean;
  burn?: BurnOnHitConfig;
  igniteProjectiles: boolean;
  rockDamageMult: number;
  trainDamageMult: number;
  weaponName: string;
  exposeAsZone: boolean;
  cells: Set<string>;
  wildfire?: FireGrenadeEffect['wildfire'];
  wildfireEscapeVectors: Map<string, { x: number; y: number }>;
}

interface ActiveGroundCell {
  id: number;
  key: string;
  gridX: number;
  gridY: number;
  sourceKeys: Set<string>;
  expiresAt: number;
  intensity: number;
}

export interface FireSystemUpdate {
  synced: SyncedFireZone[];
  ground: SyncedBurningGroundSnapshot;
  damageEvents: FireDamageEvent[];
  damageTick: boolean;
}

export type GroundFireCellBlockedResolver = (bounds: Phaser.Geom.Rectangle) => boolean;
export type GroundFireLineOfSightResolver = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) => boolean;

/**
 * Host-autoritatives, generisches Brandflaechen-System.
 *
 * Molotov, Napalm, Lauffeuer, Raketenboden und Flammenwerfer-Upgrades legen
 * ausschliesslich Quellen in dasselbe 16-Pixel-Raster. Eine Zelle kann beliebig
 * viele unabhaengige Quellen enthalten; Kontakte werden pro Quelle dedupliziert,
 * so dass Ueberlagerungen spielerisch und optisch intensiver bleiben.
 */
export class FireSystem {
  private readonly sources = new Map<string, ActiveGroundSource>();
  private readonly cells = new Map<string, ActiveGroundCell>();
  private nextSourceId = 1;
  private nextCellId = 1;
  private lastDamageTick = -1;
  private isCellBlocked: GroundFireCellBlockedResolver | null = null;
  private hasLineOfSight: GroundFireLineOfSightResolver | null = null;
  private groundSnapshotDirty = true;
  private cachedGroundSnapshot: SyncedBurningGroundSnapshot = { cells: [] };
  private lastSimulationMs = 0;
  private lastCreationMs = 0;

  constructor(private readonly scene: Phaser.Scene) {
    void this.scene;
  }

  setGroundResolvers(
    isCellBlocked: GroundFireCellBlockedResolver | null,
    hasLineOfSight: GroundFireLineOfSightResolver | null,
  ): void {
    this.isCellBlocked = isCellBlocked;
    this.hasLineOfSight = hasLineOfSight;
  }

  /** Legt eine neue, eigenstaendig stapelnde Kreisquelle in das gemeinsame Raster. */
  hostCreateZone(x: number, y: number, config: FireGrenadeEffect, ownerId: string): void {
    const durationMs = Math.max(0, config.lingerDuration);
    const radius = Math.max(0, config.radius);
    if (durationMs <= 0 || radius <= 0) return;

    const creationStartedAt = performance.now();
    const now = Date.now();
    const id = this.nextSourceId++;
    const key = `zone:${id}`;
    const source: ActiveGroundSource = {
      id,
      key,
      ownerId,
      x,
      y,
      radius,
      createdAt: now,
      expiresAt: now + durationMs,
      damagePerTick: Math.max(0, config.damagePerTick),
      allowTeamDamage: config.allowTeamDamage === true,
      burn: this.resolveBurn(config.burnDurationMs, config.burnDamagePerTick),
      igniteProjectiles: false,
      rockDamageMult: config.rockDamageMult ?? 1,
      trainDamageMult: config.trainDamageMult ?? 1,
      weaponName: config.weaponName ?? 'Molotov',
      exposeAsZone: true,
      cells: new Set(),
      wildfire: config.wildfire ? { ...config.wildfire } : undefined,
      wildfireEscapeVectors: new Map(),
    };

    this.sources.set(key, source);
    this.rasterizeCircle(source);
    if (source.cells.size === 0) this.sources.delete(key);
    else if (source.wildfire) this.buildWildfireEscapeField(source);
    this.lastCreationMs = performance.now() - creationStartedAt;
  }

  /**
   * Frischt genau eine Rasterzelle auf. Wird fuer lokale Flammenwerfer-Patches
   * verwendet, ist aber absichtlich quellenneutral und fuer weitere Effekte offen.
   */
  hostRefreshGroundCell(x: number, y: number, options: GroundFireCellOptions, now = Date.now()): void {
    const durationMs = Math.max(0, options.durationMs);
    if (durationMs <= 0) return;

    const gridX = Math.floor(x / GROUND_FIRE_CELL_SIZE);
    const gridY = Math.floor(y / GROUND_FIRE_CELL_SIZE);
    const bounds = this.cellBounds(gridX, gridY);
    const centerX = bounds.centerX;
    const centerY = bounds.centerY;
    if (!isPointInsideArena(centerX, centerY) || this.isCellBlocked?.(bounds)) return;

    const key = `cell:${options.sourceKey}:${gridX}:${gridY}`;
    let source = this.sources.get(key);
    if (!source) {
      source = {
        id: this.nextSourceId++,
        key,
        ownerId: options.ownerId,
        x: centerX,
        y: centerY,
        radius: GROUND_FIRE_CELL_SIZE * 0.5,
        createdAt: now,
        expiresAt: now + durationMs,
        damagePerTick: Math.max(0, options.damagePerTick ?? 0),
        allowTeamDamage: options.allowTeamDamage === true,
        burn: options.burn ? { ...options.burn } : undefined,
        igniteProjectiles: options.igniteProjectiles === true,
        rockDamageMult: 0,
        trainDamageMult: 0,
        weaponName: options.weaponName ?? 'Brennender Boden',
        exposeAsZone: false,
        cells: new Set(),
        wildfireEscapeVectors: new Map(),
      };
      this.sources.set(key, source);
      this.attachSourceToCell(source, gridX, gridY);
    } else {
      source.expiresAt = now + durationMs;
      source.damagePerTick = Math.max(0, options.damagePerTick ?? 0);
      source.burn = options.burn ? { ...options.burn } : undefined;
      source.igniteProjectiles = options.igniteProjectiles === true;
      source.weaponName = options.weaponName ?? source.weaponName;
      this.refreshCellAggregate(gridX, gridY);
    }
  }

  hostRefreshGroundCellsAlongSegment(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    options: GroundFireCellOptions,
    now = Date.now(),
  ): void {
    this.visitGridSegment(fromX, fromY, toX, toY, (gridX, gridY) => {
      this.hostRefreshGroundCell(
        (gridX + 0.5) * GROUND_FIRE_CELL_SIZE,
        (gridY + 0.5) * GROUND_FIRE_CELL_SIZE,
        options,
        now,
      );
    });
  }

  canPlaceGroundCell(x: number, y: number): boolean {
    const gridX = Math.floor(x / GROUND_FIRE_CELL_SIZE);
    const gridY = Math.floor(y / GROUND_FIRE_CELL_SIZE);
    const bounds = this.cellBounds(gridX, gridY);
    return isPointInsideArena(bounds.centerX, bounds.centerY) && !this.isCellBlocked?.(bounds);
  }

  getWildfireSourceInfo(sourceId: string): WildfireSourceInfo | null {
    const source = this.sources.get(sourceId);
    if (!source?.wildfire) return null;
    return {
      sourceId: source.key,
      ownerId: source.ownerId,
      speedMultiplier: Math.max(1, source.wildfire.speedMultiplier),
      trailDurationMs: Math.max(0, source.wildfire.trailDurationMs),
      trailDamagePerTick: Math.max(0, source.wildfire.trailDamagePerTick),
      burn: source.burn ? { ...source.burn } : undefined,
    };
  }

  /**
   * Liefert den vorberechneten Flow-Vektor zum naechsten Ausgang dieser
   * Molotov-Flaeche. Ausserhalb der Quelle wird absichtlich kein neuer Vektor
   * geliefert, damit der Gegner seine letzte Fluchtrichtung beibehalten kann.
   */
  getWildfireEscapeVector(
    sourceId: string,
    x: number,
    y: number,
    radius = 0,
  ): { x: number; y: number } | null {
    const source = this.sources.get(sourceId);
    if (!source?.wildfire) return null;
    const centerGridX = Math.floor(x / GROUND_FIRE_CELL_SIZE);
    const centerGridY = Math.floor(y / GROUND_FIRE_CELL_SIZE);
    const centerVector = source.wildfireEscapeVectors.get(this.cellKey(centerGridX, centerGridY));
    if (centerVector) return { ...centerVector };

    const cellRadius = Math.max(0, Math.ceil(radius / GROUND_FIRE_CELL_SIZE));
    let nearest: { vector: { x: number; y: number }; distanceSq: number } | null = null;
    for (let offsetY = -cellRadius; offsetY <= cellRadius; offsetY += 1) {
      for (let offsetX = -cellRadius; offsetX <= cellRadius; offsetX += 1) {
        const vector = source.wildfireEscapeVectors.get(this.cellKey(
          centerGridX + offsetX,
          centerGridY + offsetY,
        ));
        if (!vector) continue;
        const distanceSq = offsetX * offsetX + offsetY * offsetY;
        if (!nearest || distanceSq < nearest.distanceSq) nearest = { vector, distanceSq };
      }
    }
    return nearest ? { ...nearest.vector } : null;
  }

  hostUpdate(now: number): FireSystemUpdate {
    const simulationStartedAt = performance.now();
    this.removeExpiredSources(now);
    const tick = Math.floor(now / BURN_TICK_INTERVAL_MS);
    const damageTick = tick !== this.lastDamageTick;
    if (damageTick) this.lastDamageTick = tick;

    const activeSources = [...this.sources.values()].sort((left, right) => left.id - right.id);
    const synced = activeSources
      .filter(source => source.exposeAsZone)
      .map(source => ({
        id: source.id,
        x: source.x,
        y: source.y,
        radius: source.radius,
        alpha: Math.round(this.computeAlpha(source, now) * 100) / 100,
      }));
    const damageEvents = damageTick
      ? activeSources
        .filter(source => source.damagePerTick > 0)
        .map(source => ({
          sourceId: source.key,
          x: source.x,
          y: source.y,
          radius: source.radius,
          damage: source.damagePerTick,
          ownerId: source.ownerId,
          rockDamageMult: source.rockDamageMult,
          trainDamageMult: source.trainDamageMult,
          weaponName: source.weaponName,
        }))
      : [];

    const result = { synced, ground: this.getGroundSnapshot(), damageEvents, damageTick };
    this.lastSimulationMs = performance.now() - simulationStartedAt;
    return result;
  }

  takePerformanceMetrics(): { simulationMs: number; creationMs: number } {
    const metrics = { simulationMs: this.lastSimulationMs, creationMs: this.lastCreationMs };
    this.lastCreationMs = 0;
    return metrics;
  }

  /** Liefert jede beruehrte Quelle genau einmal, auch wenn mehrere ihrer Zellen getroffen werden. */
  collectContacts(x: number, y: number, radius: number, now = Date.now()): GroundFireContact[] {
    const contacts = new Map<string, GroundFireContact>();
    this.visitTouchingCells(x, y, Math.max(0, radius), (cell) => {
      for (const sourceKey of cell.sourceKeys) {
        if (contacts.has(sourceKey)) continue;
        const source = this.sources.get(sourceKey);
        if (!source || source.expiresAt <= now) continue;
        contacts.set(sourceKey, {
          sourceId: source.key,
          x: source.x,
          y: source.y,
          ownerId: source.ownerId,
          damagePerTick: source.damagePerTick,
          allowTeamDamage: source.allowTeamDamage,
          burn: source.burn ? { ...source.burn } : undefined,
          weaponName: source.weaponName,
        });
      }
    });
    return [...contacts.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  }

  collectProjectileIgnitersAlongSegment(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    now = Date.now(),
  ): GroundFireProjectileIgniter[] {
    const igniters = new Map<string, GroundFireProjectileIgniter>();
    this.visitGridSegment(fromX, fromY, toX, toY, (gridX, gridY) => {
      const cell = this.cells.get(this.cellKey(gridX, gridY));
      if (!cell) return;
      for (const sourceKey of cell.sourceKeys) {
        if (igniters.has(sourceKey)) continue;
        const source = this.sources.get(sourceKey);
        if (!source || source.expiresAt <= now || !source.igniteProjectiles || !source.burn) continue;
        igniters.set(sourceKey, {
          sourceId: source.key,
          ownerId: source.ownerId,
          burn: { ...source.burn },
        });
      }
    });
    return [...igniters.values()];
  }

  /** Liefert alle aktiven Feuerbesitzer entlang eines Segmentes, unabhaengig vom Quelltyp. */
  collectGroundFireOwnersAlongSegment(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    now = Date.now(),
  ): GroundFireOwner[] {
    const owners = new Map<string, GroundFireOwner>();
    this.visitGridSegment(fromX, fromY, toX, toY, (gridX, gridY) => {
      const cell = this.cells.get(this.cellKey(gridX, gridY));
      if (!cell) return;
      for (const sourceKey of cell.sourceKeys) {
        const source = this.sources.get(sourceKey);
        if (!source || source.expiresAt <= now) continue;
        const key = `${source.ownerId}\u001f${source.key}`;
        if (!owners.has(key)) owners.set(key, { sourceId: source.key, ownerId: source.ownerId });
      }
    });
    return [...owners.values()];
  }

  /** Alte Kreisvisuals sind absichtlich deaktiviert; Clients rendern das gemeinsame Raster. */
  syncVisuals(_zones: SyncedFireZone[]): void {}

  destroyAll(): void {
    this.sources.clear();
    this.cells.clear();
    this.nextSourceId = 1;
    this.nextCellId = 1;
    this.lastDamageTick = -1;
    this.groundSnapshotDirty = true;
    this.cachedGroundSnapshot = { cells: [] };
    this.lastSimulationMs = 0;
    this.lastCreationMs = 0;
  }

  private rasterizeCircle(source: ActiveGroundSource): void {
    const minGridX = Math.floor((source.x - source.radius) / GROUND_FIRE_CELL_SIZE);
    const maxGridX = Math.floor((source.x + source.radius) / GROUND_FIRE_CELL_SIZE);
    const minGridY = Math.floor((source.y - source.radius) / GROUND_FIRE_CELL_SIZE);
    const maxGridY = Math.floor((source.y + source.radius) / GROUND_FIRE_CELL_SIZE);
    const radiusSq = source.radius * source.radius;

    for (let gridY = minGridY; gridY <= maxGridY; gridY++) {
      for (let gridX = minGridX; gridX <= maxGridX; gridX++) {
        const bounds = this.cellBounds(gridX, gridY);
        const centerX = bounds.centerX;
        const centerY = bounds.centerY;
        if (!isPointInsideArena(centerX, centerY)) continue;
        const nearestX = Phaser.Math.Clamp(source.x, bounds.left, bounds.right);
        const nearestY = Phaser.Math.Clamp(source.y, bounds.top, bounds.bottom);
        const dx = source.x - nearestX;
        const dy = source.y - nearestY;
        if (dx * dx + dy * dy > radiusSq) continue;
        if (this.isCellBlocked?.(bounds)) continue;
        if (this.hasLineOfSight && !this.hasLineOfSight(source.x, source.y, centerX, centerY)) continue;
        this.attachSourceToCell(source, gridX, gridY);
      }
    }
  }

  /**
   * Multi-Source-Flowfield pro Molotov statt einer Wegsuche pro Gegner. Alle
   * offenen Randzellen sind Ziele; die Integration propagiert einmalig beim
   * Erzeugen der Flaeche durch deren begehbare Rasterzellen.
   */
  private buildWildfireEscapeField(source: ActiveGroundSource): void {
    source.wildfireEscapeVectors.clear();
    const distances = new Map<string, number>();
    const queue: Array<{ gridX: number; gridY: number }> = [];

    for (const key of source.cells) {
      const { gridX, gridY } = this.parseCellKey(key);
      const centerX = (gridX + 0.5) * GROUND_FIRE_CELL_SIZE;
      const centerY = (gridY + 0.5) * GROUND_FIRE_CELL_SIZE;
      const outwardX = centerX - source.x;
      const outwardY = centerY - source.y;
      let bestExit: { x: number; y: number; score: number } | null = null;

      for (const [dx, dy] of FLOW_DIRECTIONS) {
        const neighborKey = this.cellKey(gridX + dx, gridY + dy);
        if (source.cells.has(neighborKey)) continue;
        if (!this.canTraverseGridStep(gridX, gridY, gridX + dx, gridY + dy)) continue;
        const length = Math.hypot(dx, dy);
        const score = (dx * outwardX + dy * outwardY) / Math.max(0.001, length);
        if (!bestExit || score > bestExit.score) {
          bestExit = { x: dx / length, y: dy / length, score };
        }
      }

      if (!bestExit) continue;
      distances.set(key, 0);
      source.wildfireEscapeVectors.set(key, { x: bestExit.x, y: bestExit.y });
      queue.push({ gridX, gridY });
    }

    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const current = queue[queueIndex++];
      const currentKey = this.cellKey(current.gridX, current.gridY);
      const currentDistance = distances.get(currentKey) ?? 0;

      for (const [dx, dy] of FLOW_DIRECTIONS) {
        const neighborX = current.gridX + dx;
        const neighborY = current.gridY + dy;
        const neighborKey = this.cellKey(neighborX, neighborY);
        if (!source.cells.has(neighborKey)) continue;
        if (!this.canTraverseGridStep(neighborX, neighborY, current.gridX, current.gridY)) continue;
        const nextDistance = currentDistance + Math.hypot(dx, dy);
        if ((distances.get(neighborKey) ?? Infinity) <= nextDistance) continue;

        const length = Math.hypot(dx, dy);
        distances.set(neighborKey, nextDistance);
        source.wildfireEscapeVectors.set(neighborKey, { x: -dx / length, y: -dy / length });
        queue.push({ gridX: neighborX, gridY: neighborY });
      }
    }
  }

  private canTraverseGridStep(fromX: number, fromY: number, toX: number, toY: number): boolean {
    if (!this.canPlaceGridCell(toX, toY)) return false;
    const dx = toX - fromX;
    const dy = toY - fromY;
    if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) return true;
    return this.canPlaceGridCell(fromX + dx, fromY)
      && this.canPlaceGridCell(fromX, fromY + dy);
  }

  private canPlaceGridCell(gridX: number, gridY: number): boolean {
    const bounds = this.cellBounds(gridX, gridY);
    return isPointInsideArena(bounds.centerX, bounds.centerY) && !this.isCellBlocked?.(bounds);
  }

  private parseCellKey(key: string): { gridX: number; gridY: number } {
    const separator = key.indexOf(':');
    return {
      gridX: Number(key.slice(0, separator)),
      gridY: Number(key.slice(separator + 1)),
    };
  }

  private attachSourceToCell(source: ActiveGroundSource, gridX: number, gridY: number): void {
    const key = this.cellKey(gridX, gridY);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { id: this.nextCellId++, key, gridX, gridY, sourceKeys: new Set(), expiresAt: 0, intensity: 0 };
      this.cells.set(key, cell);
    }
    cell.sourceKeys.add(source.key);
    source.cells.add(key);
    this.refreshCellAggregate(gridX, gridY);
  }

  private removeExpiredSources(now: number): void {
    for (const [sourceKey, source] of this.sources) {
      if (source.expiresAt > now) continue;
      for (const cellKey of source.cells) {
        const cell = this.cells.get(cellKey);
        if (!cell) continue;
        cell.sourceKeys.delete(sourceKey);
        if (cell.sourceKeys.size === 0) {
          this.cells.delete(cellKey);
          this.groundSnapshotDirty = true;
        } else {
          this.refreshCellAggregate(cell.gridX, cell.gridY);
        }
      }
      this.sources.delete(sourceKey);
    }
  }

  private getGroundSnapshot(): SyncedBurningGroundSnapshot {
    if (!this.groundSnapshotDirty) return this.cachedGroundSnapshot;
    this.cachedGroundSnapshot = {
      cells: [...this.cells.values()]
        .sort((left, right) => left.id - right.id)
        .map(cell => ({
          id: cell.id,
          gridX: cell.gridX,
          gridY: cell.gridY,
          expiresAt: cell.expiresAt,
          intensity: Math.max(1, cell.intensity),
        })),
    };
    this.groundSnapshotDirty = false;
    return this.cachedGroundSnapshot;
  }

  private refreshCellAggregate(gridX: number, gridY: number): void {
    const cell = this.cells.get(this.cellKey(gridX, gridY));
    if (!cell) return;
    let expiresAt = 0;
    let intensity = 0;
    for (const sourceKey of cell.sourceKeys) {
      const source = this.sources.get(sourceKey);
      if (!source) continue;
      expiresAt = Math.max(expiresAt, source.expiresAt);
      intensity += 1;
    }
    cell.expiresAt = expiresAt;
    cell.intensity = intensity;
    this.groundSnapshotDirty = true;
  }

  private visitTouchingCells(
    x: number,
    y: number,
    radius: number,
    visitor: (cell: ActiveGroundCell) => void,
  ): void {
    const minGridX = Math.floor((x - radius) / GROUND_FIRE_CELL_SIZE);
    const maxGridX = Math.floor((x + radius) / GROUND_FIRE_CELL_SIZE);
    const minGridY = Math.floor((y - radius) / GROUND_FIRE_CELL_SIZE);
    const maxGridY = Math.floor((y + radius) / GROUND_FIRE_CELL_SIZE);
    const radiusSq = radius * radius;
    for (let gridY = minGridY; gridY <= maxGridY; gridY++) {
      for (let gridX = minGridX; gridX <= maxGridX; gridX++) {
        const cell = this.cells.get(this.cellKey(gridX, gridY));
        if (!cell) continue;
        const bounds = this.cellBounds(gridX, gridY);
        const nearestX = Phaser.Math.Clamp(x, bounds.left, bounds.right);
        const nearestY = Phaser.Math.Clamp(y, bounds.top, bounds.bottom);
        const dx = x - nearestX;
        const dy = y - nearestY;
        if (dx * dx + dy * dy <= radiusSq) visitor(cell);
      }
    }
  }

  private visitGridSegment(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    visitor: (gridX: number, gridY: number) => void,
  ): void {
    let gridX = Math.floor(fromX / GROUND_FIRE_CELL_SIZE);
    let gridY = Math.floor(fromY / GROUND_FIRE_CELL_SIZE);
    const endGridX = Math.floor(toX / GROUND_FIRE_CELL_SIZE);
    const endGridY = Math.floor(toY / GROUND_FIRE_CELL_SIZE);
    const dx = toX - fromX;
    const dy = toY - fromY;
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const tDeltaX = stepX === 0 ? Infinity : GROUND_FIRE_CELL_SIZE / Math.abs(dx);
    const tDeltaY = stepY === 0 ? Infinity : GROUND_FIRE_CELL_SIZE / Math.abs(dy);
    const nextBoundaryX = stepX > 0 ? (gridX + 1) * GROUND_FIRE_CELL_SIZE : gridX * GROUND_FIRE_CELL_SIZE;
    const nextBoundaryY = stepY > 0 ? (gridY + 1) * GROUND_FIRE_CELL_SIZE : gridY * GROUND_FIRE_CELL_SIZE;
    let tMaxX = stepX === 0 ? Infinity : Math.abs((nextBoundaryX - fromX) / dx);
    let tMaxY = stepY === 0 ? Infinity : Math.abs((nextBoundaryY - fromY) / dy);

    for (;;) {
      visitor(gridX, gridY);
      if (gridX === endGridX && gridY === endGridY) return;
      if (tMaxX < tMaxY) {
        gridX += stepX;
        tMaxX += tDeltaX;
      } else {
        gridY += stepY;
        tMaxY += tDeltaY;
      }
    }
  }

  private computeAlpha(source: ActiveGroundSource, now: number): number {
    const age = now - source.createdAt;
    const remaining = source.expiresAt - now;
    return Phaser.Math.Clamp(Math.min(age / FADE_IN_MS, remaining / FADE_OUT_MS, 1), 0, 1);
  }

  private resolveBurn(durationMs?: number, damagePerTick?: number): BurnOnHitConfig | undefined {
    if ((durationMs ?? 0) <= 0 || (damagePerTick ?? 0) <= 0) return undefined;
    return { durationMs: durationMs ?? 0, damagePerTick: damagePerTick ?? 0 };
  }

  private cellBounds(gridX: number, gridY: number): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(
      gridX * GROUND_FIRE_CELL_SIZE,
      gridY * GROUND_FIRE_CELL_SIZE,
      GROUND_FIRE_CELL_SIZE,
      GROUND_FIRE_CELL_SIZE,
    );
  }

  private cellKey(gridX: number, gridY: number): string {
    return `${gridX}:${gridY}`;
  }
}
