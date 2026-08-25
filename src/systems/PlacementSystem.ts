import * as Phaser from 'phaser';
import { AutoTiler, ROCK_AUTOTILE } from '../arena/AutoTiler';
import { isCoopDefenseBaseCell, type BaseSpec } from '../arena/BaseRegistry';
import { RockGridIndex } from '../arena/RockGridIndex';
import type { PlayerManager } from '../entities/PlayerManager';
import type { PlaceableUtilityConfig, TunnelUltimateConfig } from '../loadout/LoadoutConfig';
import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  clipPointToArenaRay,
  isPointInsideArena,
} from '../config';
import type { ArenaLayout, ConstructionOwnership, LoadoutToolRef, PlaceableKind, SyncedPlaceableRock, UtilityPlacementPreviewState } from '../types';
import type { PersistentBaseRewardDefinition } from '../config/persistentBaseRewards';
import {
  getCoopDefenseConstructionDefinition,
  getConstructionIdForUtility,
  normalizeConstructionId,
  sumPlaceableCapacity,
  type CoopDefenseConstructionDefinition,
} from '../config/coopDefenseConstructions';

interface RuntimeRockRecord extends SyncedPlaceableRock { lastAttackerId?: string }

export interface PlacementSyncResult {
  added: SyncedPlaceableRock[];
  updated: SyncedPlaceableRock[];
  removed: SyncedPlaceableRock[];
}

export class PlacementSystem {
  private readonly layout: ArenaLayout;
  private readonly rockGrid: RockGridIndex;
  /** Authored Coop-Defense base footprint; empty outside the mode or without bases. */
  private readonly coopDefenseBases: readonly BaseSpec[];
  private closedBarrierCellResolver: ((gridX: number, gridY: number) => boolean) | null = null;
  private readonly playerManager: PlayerManager;
  private readonly runtimeRocks = new Map<number, RuntimeRockRecord>();
  private readonly treeCells = new Set<string>();
  private readonly trackCells = new Set<string>();
  private readonly pedestalCells = new Set<string>();
  /** Vorbereitete Gefahrenzellen je authored Event; gesperrt wird erst ab der Ankuendigung. */
  private readonly hazardCellEventIds = new Map<string, string>();
  private isHazardEventArmed: ((eventId: string) => boolean) | null = null;
  private persistentRewardDestroyedHandler: ((rock: SyncedPlaceableRock) => void) | null = null;
  private nextRockId: number;

  constructor(
    layout: ArenaLayout,
    rockGrid: RockGridIndex,
    playerManager: PlayerManager,
    coopDefenseBases: readonly BaseSpec[] = [],
  ) {
    this.layout = layout;
    this.rockGrid = rockGrid;
    this.playerManager = playerManager;
    this.coopDefenseBases = coopDefenseBases;
    this.nextRockId = layout.rocks.length;

    for (const tree of layout.trees) {
      this.treeCells.add(this.key(tree.gridX, tree.gridY));
    }
    for (const track of layout.tracks) {
      this.trackCells.add(this.key(track.gridX, track.gridY));
      this.trackCells.add(this.key(track.gridX + 1, track.gridY));
    }
    for (const pedestal of layout.powerUpPedestals) {
      this.pedestalCells.add(this.key(pedestal.gridX, pedestal.gridY));
    }
    for (const zone of layout.groundHazardZones ?? []) {
      for (const cell of zone.cells) {
        this.hazardCellEventIds.set(this.key(cell.gridX, cell.gridY), zone.eventId);
      }
    }
  }

  setClosedBarrierCellResolver(resolver: ((gridX: number, gridY: number) => boolean) | null): void {
    this.closedBarrierCellResolver = resolver;
  }

  isClosedBarrierCell(gridX: number, gridY: number): boolean {
    return this.closedBarrierCellResolver?.(gridX, gridY) === true;
  }

  doesGridSegmentCrossClosedBarrier(
    startGridX: number,
    startGridY: number,
    endGridX: number,
    endGridY: number,
  ): boolean {
    const startX = startGridX + 0.5;
    const startY = startGridY + 0.5;
    const endX = endGridX + 0.5;
    const endY = endGridY + 0.5;
    const minGridX = Math.max(0, Math.floor(Math.min(startX, endX)));
    const maxGridX = Math.min(GRID_COLS - 1, Math.floor(Math.max(startX, endX)));
    const minGridY = Math.max(0, Math.floor(Math.min(startY, endY)));
    const maxGridY = Math.min(GRID_ROWS - 1, Math.floor(Math.max(startY, endY)));
    for (let gridY = minGridY; gridY <= maxGridY; gridY += 1) {
      for (let gridX = minGridX; gridX <= maxGridX; gridX += 1) {
        if (!this.isClosedBarrierCell(gridX, gridY)) continue;
        if (segmentIntersectsGridCell(startX, startY, endX, endY, gridX, gridY)) return true;
      }
    }
    return false;
  }

  /**
   * Verdrahtet den host-autoritaeren Lifecycle der Ground-Hazard-Events.
   *
   * Eine vorbereitete Gefahrenflaeche ist bis zu ihrem Trigger nur Layout: Sie darf das Bauen nicht
   * sperren, sonst sterilisiert ein Event, das vielleicht nie eintritt, die ganze Runde ueber ein
   * Stueck Arena. Ab der Ankuendigung greift die Sperre auf Host und Client aus demselben
   * replizierten Snapshot, damit Bauvorschau und Host-Pruefung dieselbe Antwort geben.
   */
  setHazardEventArmedResolver(resolver: ((eventId: string) => boolean) | null): void {
    this.isHazardEventArmed = resolver;
  }

  setPersistentRewardDestroyedHandler(handler: ((rock: SyncedPlaceableRock) => void) | null): void {
    this.persistentRewardDestroyedHandler = handler;
  }

  notifyPersistentRewardDestroyed(rock: SyncedPlaceableRock): void {
    if (rock.persistentRewardId) this.persistentRewardDestroyedHandler?.({ ...rock });
  }

  private isHazardCellLocked(cellKey: string): boolean {
    const eventId = this.hazardCellEventIds.get(cellKey);
    if (eventId === undefined) return false;
    // Ohne Resolver bleibt es bei der konservativen Sperre: Wer den Lifecycle nicht kennt, darf
    // nicht versehentlich in eine bereits brennende Flaeche bauen lassen.
    return this.isHazardEventArmed?.(eventId) ?? true;
  }

  getRuntimeRock(id: number): SyncedPlaceableRock | undefined {
    return this.runtimeRocks.get(id);
  }

  getRuntimeRockAt(gridX: number, gridY: number): SyncedPlaceableRock | undefined {
    const id = this.rockGrid.getIndex(gridX, gridY);
    return id >= 0 ? this.runtimeRocks.get(id) : undefined;
  }

  getAllRuntimeRocks(): readonly SyncedPlaceableRock[] {
    return [...this.runtimeRocks.values()];
  }

  hasRuntimeRock(id: number): boolean {
    return this.runtimeRocks.has(id);
  }

  getNetSnapshot(): SyncedPlaceableRock[] {
    return [...this.runtimeRocks.values()]
      .sort((left, right) => left.id - right.id)
      .map((rock) => ({ ...rock }));
  }

  update(now: number): SyncedPlaceableRock[] {
    const expired: SyncedPlaceableRock[] = [];
    for (const rock of this.runtimeRocks.values()) {
      if (normalizeConstructionId(rock.constructionId) || normalizeConstructionId(rock.toolRef?.id)) continue;
      if (rock.expiresAt <= 0) continue;
      if (now < rock.expiresAt) continue;
      this.runtimeRocks.delete(rock.id);
      this.removeRockFootprint(rock);
      expired.push({ ...rock });
    }
    return expired;
  }

  removeRock(id: number): SyncedPlaceableRock | undefined {
    const rock = this.runtimeRocks.get(id);
    if (!rock) return undefined;
    this.runtimeRocks.delete(id);
    this.removeRockFootprint(rock);
    return { ...rock };
  }

  applyDamage(id: number, damage: number, attackerId?: string): SyncedPlaceableRock | undefined {
    const rock = this.runtimeRocks.get(id);
    if (!rock) return undefined;
    if (
      rock.indestructible === true
      || (
      rock.constructionId
      && getCoopDefenseConstructionDefinition(rock.constructionId).indestructible === true
      )
    ) {
      return { ...rock };
    }
    rock.hp = Math.max(0, rock.hp - damage);
    rock.lastAttackerId = attackerId;
    return { ...rock };
  }

  updateAngle(id: number, angle: number): void {
    const rock = this.runtimeRocks.get(id);
    if (!rock) return;
    rock.angle = angle;
  }

  repairRock(id: number, amount: number): SyncedPlaceableRock | undefined {
    const rock = this.runtimeRocks.get(id);
    if (!rock || amount <= 0 || rock.hp <= 0 || rock.hp >= rock.maxHp) return undefined;
    rock.hp = Math.min(rock.maxHp, rock.hp + amount);
    return { ...rock };
  }

  getOwnedConstructions(ownerId: string): readonly SyncedPlaceableRock[] {
    return [...this.runtimeRocks.values()].filter((rock) => (
      rock.ownerId === ownerId && rock.constructionId !== undefined
    ));
  }

  /**
   * Entfernt den vollstaendigen eigenen Konstruktionsbestand in einem Durchlauf. Die
   * Owner-Pruefung bleibt an derselben Datenquelle wie beim Einzelrueckbau; statische
   * Felsen und nicht als Konstruktion markierte Runtime-Objekte sind ausgeschlossen.
   */
  removeOwnedConstructions(
    ownerId: string,
    expectedOwnership?: ConstructionOwnership,
  ): SyncedPlaceableRock[] {
    const removed: SyncedPlaceableRock[] = [];
    for (const rock of this.getOwnedConstructions(ownerId)) {
      if (
        rock.ownerId !== ownerId
        || rock.constructionId === undefined
        || rock.ownership === 'base-owned'
        || (expectedOwnership !== undefined && rock.ownership !== expectedOwnership)
      ) continue;
      const result = this.removeRock(rock.id);
      if (result) removed.push(result);
    }
    return removed;
  }

  /**
   * Belegte Konstruktionskapazitaet eines Spielers. Laeuft auf Host und Client, weil beide
   * denselben Bestand halten; das HUD und die Bauvorschau brauchen deshalb keinen eigenen
   * Netzwerkwert.
   */
  getUsedCapacity(ownerId: string): number {
    return sumPlaceableCapacity(this.runtimeRocks.values(), ownerId);
  }

  /** Rueckbau: entfernt ein Konstrukt nur, wenn es dem anfragenden Spieler gehoert. */
  removeRockAt(
    gridX: number,
    gridY: number,
    ownerId: string,
    expectedOwnership?: ConstructionOwnership,
  ): SyncedPlaceableRock | undefined {
    // Der Grid-Index fuehrt statische Layout-Felsen und platzierte Objekte gemeinsam; nur
    // Letztere stehen in `runtimeRocks` und sind damit ueberhaupt rueckbaubar.
    const id = this.rockGrid.getIndex(gridX, gridY);
    if (id < 0) return undefined;
    const rock = this.runtimeRocks.get(id);
    if (
      !rock
      || rock.ownerId !== ownerId
      || rock.ownership === 'base-owned'
      || (expectedOwnership !== undefined && rock.ownership !== expectedOwnership)
    ) return undefined;
    return this.removeRock(id);
  }

  tryPlaceConstruction(
    cfg: CoopDefenseConstructionDefinition,
    maxHp: number,
    playerId: string,
    ownerColor: number,
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
    ownership: ConstructionOwnership = 'host-persistent',
  ): SyncedPlaceableRock | null {
    const preview = this.getConstructionPlacementPreview(cfg, originX, originY, targetX, targetY);
    if (!preview?.isValid) return null;
    const resolvedMaxHp = Math.max(1, maxHp);
    const rock: RuntimeRockRecord = {
      id: this.nextRockId++,
      kind: cfg.kind,
      constructionId: cfg.id,
      gridX: preview.gridX,
      gridY: preview.gridY,
      hp: resolvedMaxHp,
      maxHp: resolvedMaxHp,
      ownerId: playerId,
      ownerColor,
      expiresAt: 0,
      warningStartsAt: 0,
      angle: preview.angle,
      ownership,
      toolRef: { kind: 'construction', id: cfg.id } satisfies LoadoutToolRef,
      targetRange: cfg.kind === 'turret' ? cfg.targetRange : undefined,
      turretWeaponId: cfg.kind === 'turret' ? cfg.weaponId : undefined,
      energyInjectorEffect: cfg.energyInjectorEffect,
      footprint: cfg.footprint,
    };
    this.runtimeRocks.set(rock.id, rock);
    this.setRockFootprint(rock);
    return { ...rock };
  }

  /**
   * Host-only restore path. It deliberately skips player range/occupancy checks but reuses the
   * normal grid, static geometry, hazard and barrier collision contract and creates the same
   * RuntimeRock model as a regular placement.
   */
  materializePersistentPlaceable(
    cfg: CoopDefenseConstructionDefinition | PlaceableUtilityConfig,
    gridX: number,
    gridY: number,
    angle: number,
    playerId: string,
    ownerColor: number,
    ownership: ConstructionOwnership = 'host-persistent',
  ): SyncedPlaceableRock | null {
    const isConstruction = 'capacityCost' in cfg;
    const utilityConstructionId = isConstruction ? null : getConstructionIdForUtility(cfg.id);
    const footprint = isConstruction ? cfg.footprint : cfg.placeable.footprint;
    if (!this.canPlaceCells(footprint, gridX, gridY, false)) return null;

    const safeAngle = Number.isFinite(angle) ? angle : 0;
    const rock: RuntimeRockRecord = isConstruction
      ? {
        id: this.nextRockId++,
        kind: cfg.kind,
        constructionId: cfg.id,
        gridX,
        gridY,
        hp: Math.max(1, cfg.maxHp),
        maxHp: Math.max(1, cfg.maxHp),
        ownerId: playerId,
        ownerColor,
        expiresAt: 0,
        warningStartsAt: 0,
        angle: safeAngle,
        ownership,
        targetRange: cfg.kind === 'turret' ? cfg.targetRange : undefined,
        turretWeaponId: cfg.kind === 'turret' ? cfg.weaponId : undefined,
        energyInjectorEffect: cfg.energyInjectorEffect,
        toolRef: { kind: 'construction', id: cfg.id } satisfies LoadoutToolRef,
      }
      : utilityConstructionId
        ? {
        id: this.nextRockId++,
        kind: cfg.placeable.kind,
        constructionId: utilityConstructionId,
        gridX,
        gridY,
        hp: Math.max(1, cfg.placeable.maxHp),
        maxHp: Math.max(1, cfg.placeable.maxHp),
        ownerId: playerId,
        ownerColor,
        expiresAt: 0,
        warningStartsAt: 0,
        angle: safeAngle,
        ownership,
        toolRef: { kind: 'construction', id: utilityConstructionId } satisfies LoadoutToolRef,
        enemyDestroyedExplosionRadius: cfg.placeable.kind === 'rock'
          ? (cfg.placeable.enemyDestroyedExplosionRadius ?? 0) : 0,
        enemyDestroyedExplosionDamage: cfg.placeable.kind === 'rock'
          ? (cfg.placeable.enemyDestroyedExplosionDamage ?? 0) : 0,
        enemyDestroyedExplosionKnockback: cfg.placeable.kind === 'rock'
          ? (cfg.placeable.enemyDestroyedExplosionKnockback ?? 0) : 0,
        secondProjectileDamageFactor: cfg.placeable.kind === 'turret'
          ? (cfg.placeable.secondProjectileDamageFactor ?? 0) : 0,
        targetRange: cfg.placeable.kind === 'turret' ? cfg.placeable.targetRange : undefined,
        turretWeaponId: cfg.placeable.kind === 'turret'
          ? (cfg.placeable.plasmaWeaponEnabled ?? 0) > 0
            ? 'SPORE_TURRET_PLASMA'
            : cfg.type === 'placeable_turret' ? cfg.weaponId as SyncedPlaceableRock['turretWeaponId'] : undefined
          : undefined,
        energyInjectorEffect: cfg.placeable.kind === 'turret'
          ? cfg.placeable.energyInjectorEffect : undefined,
      }
      : {
        id: this.nextRockId++,
        kind: cfg.placeable.kind,
        gridX,
        gridY,
        hp: Math.max(1, cfg.placeable.maxHp),
        maxHp: Math.max(1, cfg.placeable.maxHp),
        ownerId: playerId,
        ownerColor,
        expiresAt: 0,
        warningStartsAt: 0,
        angle: safeAngle,
        indestructible: cfg.placeable.indestructible,
        toolRef: { kind: 'utility', id: cfg.id } satisfies LoadoutToolRef,
        enemyDestroyedExplosionRadius: cfg.placeable.kind === 'rock'
          ? (cfg.placeable.enemyDestroyedExplosionRadius ?? 0) : 0,
        enemyDestroyedExplosionDamage: cfg.placeable.kind === 'rock'
          ? (cfg.placeable.enemyDestroyedExplosionDamage ?? 0) : 0,
        enemyDestroyedExplosionKnockback: cfg.placeable.kind === 'rock'
          ? (cfg.placeable.enemyDestroyedExplosionKnockback ?? 0) : 0,
        secondProjectileDamageFactor: cfg.placeable.kind === 'turret'
          ? (cfg.placeable.secondProjectileDamageFactor ?? 0) : 0,
        targetRange: cfg.placeable.kind === 'turret' ? cfg.placeable.targetRange : undefined,
        turretWeaponId: cfg.placeable.kind === 'turret'
          && (cfg.placeable.plasmaWeaponEnabled ?? 0) > 0
          ? 'SPORE_TURRET_PLASMA' : undefined,
        energyInjectorEffect: cfg.placeable.kind === 'turret'
          ? cfg.placeable.energyInjectorEffect : undefined,
      };

    rock.footprint = footprint;
    this.runtimeRocks.set(rock.id, rock);
    this.setRockFootprint(rock);
    return { ...rock };
  }

  materializePersistentReward(
    definition: PersistentBaseRewardDefinition,
    gridX: number,
    gridY: number,
    angle: number,
    hostOwnerId: string,
    ownerColor: number,
    persistentId: string,
  ): SyncedPlaceableRock | null {
    if (!this.canPlaceCells(definition.footprint, gridX, gridY, false)) return null;
    const rock: RuntimeRockRecord = {
      id: this.nextRockId++,
      kind: definition.kind,
      gridX,
      gridY,
      hp: definition.maxHp,
      maxHp: definition.maxHp,
      ownerId: hostOwnerId,
      ownerColor,
      expiresAt: 0,
      warningStartsAt: 0,
      angle: Number.isFinite(angle) ? angle : 0,
      ownership: 'base-owned',
      indestructible: definition.indestructible === true,
      persistentRewardId: definition.id,
      persistentId,
      footprint: definition.footprint,
      ...(definition.constructionType === 'watchtower'
        ? { targetRange: 800 }
        : {}),
    };
    this.runtimeRocks.set(rock.id, rock);
    this.setRockFootprint(rock);
    return { ...rock };
  }

  /**
   * Atomically moves a runtime object while preserving its runtime ID, HP and all metadata.
   * The caller supplies the authored footprint so the same primitive works for constructions
   * and base-owned rewards.
   */
  repositionRuntimeRock(
    id: number,
    gridX: number,
    gridY: number,
    footprint: readonly { readonly dx: number; readonly dy: number }[],
    angle: number,
  ): SyncedPlaceableRock | null {
    const rock = this.runtimeRocks.get(id);
    if (!rock) return null;
    const previousCells = footprint.map((cell) => ({ gridX: rock.gridX + cell.dx, gridY: rock.gridY + cell.dy }));
    for (const cell of previousCells) {
      if (this.rockGrid.getIndex(cell.gridX, cell.gridY) === id) this.rockGrid.remove(cell.gridX, cell.gridY);
    }
    if (!this.canPlaceCells(footprint, gridX, gridY, false)) {
      for (const cell of previousCells) this.rockGrid.set(cell.gridX, cell.gridY, id);
      return null;
    }
    rock.gridX = gridX;
    rock.gridY = gridY;
    rock.angle = Number.isFinite(angle) ? angle : rock.angle;
    for (const cell of footprint) this.rockGrid.set(gridX + cell.dx, gridY + cell.dy, id);
    return { ...rock };
  }

  /**
   * Validates a move against the current grid while treating the source footprint as empty.
   * This is intentionally the same collision primitive used by the host's atomic reposition,
   * exposed separately so the local preview cannot advertise a target the host will reject.
   */
  canRepositionCells(
    id: number,
    gridX: number,
    gridY: number,
    footprint: readonly { readonly dx: number; readonly dy: number }[],
  ): boolean {
    const rock = this.runtimeRocks.get(id);
    if (!rock) return false;
    const sourceFootprint = footprint.length > 0 ? footprint : [{ dx: 0, dy: 0 }];
    const previousCells = sourceFootprint.map((cell) => ({
      gridX: rock.gridX + cell.dx,
      gridY: rock.gridY + cell.dy,
    }));
    for (const cell of previousCells) {
      if (this.rockGrid.getIndex(cell.gridX, cell.gridY) === id) this.rockGrid.remove(cell.gridX, cell.gridY);
    }
    const valid = this.canPlaceCells(sourceFootprint, gridX, gridY, false);
    for (const cell of previousCells) this.rockGrid.set(cell.gridX, cell.gridY, id);
    return valid;
  }

  getConstructionPlacementPreview(
    cfg: CoopDefenseConstructionDefinition,
    originX: number,
    originY: number,
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined {
    const targetCell = this.resolveTargetCell(originX, originY, pointerX, pointerY, cfg.placementRange);
    if (!targetCell) return undefined;
    const targetWorld = this.gridToWorld(targetCell.gridX, targetCell.gridY);
    const mask = AutoTiler.computeMask(targetCell.gridX, targetCell.gridY, (gx, gy) => {
      if (gx === targetCell.gridX && gy === targetCell.gridY) return true;
      return this.rockGrid.isOccupied(gx, gy);
    });
    return {
      angle: Phaser.Math.Angle.Between(originX, originY, targetWorld.x, targetWorld.y),
      targetX: targetWorld.x,
      targetY: targetWorld.y,
      gridX: targetCell.gridX,
      gridY: targetCell.gridY,
      isValid: this.canPlaceCells(cfg.footprint, targetCell.gridX, targetCell.gridY),
      frame: cfg.kind === 'turret' ? AutoTiler.getFrame(mask, ROCK_AUTOTILE) : 0,
      range: cfg.placementRange,
      kind: cfg.kind,
      sourceSlot: 'utility',
      constructionId: cfg.id,
    };
  }

  /** Vorschau fuer den Rueckbau: gueltig genau dann, wenn dort ein eigenes Konstrukt steht. */
  getDismantlePreview(
    ownerId: string,
    originX: number,
    originY: number,
    pointerX: number,
    pointerY: number,
    range: number,
  ): UtilityPlacementPreviewState | undefined {
    const targetCell = this.resolveTargetCell(originX, originY, pointerX, pointerY, range);
    if (!targetCell) return undefined;
    const targetWorld = this.gridToWorld(targetCell.gridX, targetCell.gridY);
    const id = this.rockGrid.getIndex(targetCell.gridX, targetCell.gridY);
    const rock = id >= 0 ? this.runtimeRocks.get(id) : undefined;
    return {
      angle: Phaser.Math.Angle.Between(originX, originY, targetWorld.x, targetWorld.y),
      targetX: targetWorld.x,
      targetY: targetWorld.y,
      gridX: targetCell.gridX,
      gridY: targetCell.gridY,
      isValid: rock?.ownerId === ownerId,
      frame: 0,
      range,
      kind: rock?.kind ?? 'rock',
      sourceSlot: 'utility',
      mode: 'dismantle',
    };
  }

  tryPlaceRock(
    cfg: PlaceableUtilityConfig,
    playerId: string,
    ownerColor: number,
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
    now: number,
    ownership?: ConstructionOwnership,
  ): SyncedPlaceableRock | null {
    const preview = this.getPlacementPreview(cfg, originX, originY, targetX, targetY);
    if (!preview || !preview.isValid) return null;

    // `lifetimeMs <= 0` kennzeichnet dauerhafte Konstrukte (Mauer, Fliegenpilz). `update()`
    // ueberspringt `expiresAt <= 0` bereits, deshalb genuegt hier die Null.
    const constructionId = getConstructionIdForUtility(cfg.id);
    const isPermanent = constructionId !== null || cfg.placeable.lifetimeMs <= 0;
    const rock: RuntimeRockRecord = {
      id: this.nextRockId++,
      kind: cfg.placeable.kind,
      gridX: preview.gridX,
      gridY: preview.gridY,
      hp: cfg.placeable.maxHp,
      maxHp: cfg.placeable.maxHp,
      ownerId: playerId,
      ownerColor,
      expiresAt: isPermanent ? 0 : now + cfg.placeable.lifetimeMs,
      warningStartsAt: isPermanent
        ? 0
        : now + Math.max(0, cfg.placeable.lifetimeMs - cfg.placeable.warningPulseMs),
      angle: preview.angle,
      constructionId: constructionId ?? undefined,
      ownership: constructionId ? (ownership ?? 'host-persistent') : undefined,
      indestructible: cfg.placeable.indestructible,
      toolRef: constructionId
        ? { kind: 'construction', id: constructionId }
        : { kind: 'utility', id: cfg.id } satisfies LoadoutToolRef,
      enemyDestroyedExplosionRadius: cfg.placeable.kind === 'rock' ? (cfg.placeable.enemyDestroyedExplosionRadius ?? 0) : 0,
      enemyDestroyedExplosionDamage: cfg.placeable.kind === 'rock' ? (cfg.placeable.enemyDestroyedExplosionDamage ?? 0) : 0,
      enemyDestroyedExplosionKnockback: cfg.placeable.kind === 'rock' ? (cfg.placeable.enemyDestroyedExplosionKnockback ?? 0) : 0,
      secondProjectileDamageFactor: cfg.placeable.kind === 'turret' ? (cfg.placeable.secondProjectileDamageFactor ?? 0) : 0,
      targetRange: cfg.placeable.kind === 'turret' ? cfg.placeable.targetRange : undefined,
      turretWeaponId: cfg.placeable.kind === 'turret'
        ? (cfg.placeable.plasmaWeaponEnabled ?? 0) > 0
          ? 'SPORE_TURRET_PLASMA'
          : cfg.type === 'placeable_turret' ? cfg.weaponId as SyncedPlaceableRock['turretWeaponId'] : undefined
        : undefined,
      energyInjectorEffect: cfg.placeable.kind === 'turret'
        ? cfg.placeable.energyInjectorEffect
        : undefined,
      footprint: cfg.placeable.footprint,
    };

    this.runtimeRocks.set(rock.id, rock);
    this.setRockFootprint(rock);
    return { ...rock };
  }

  syncFromSnapshot(snapshot: readonly SyncedPlaceableRock[]): PlacementSyncResult {
    const normalizedSnapshot = snapshot.map(normalizeRockSnapshot);
    const next = new Map<number, SyncedPlaceableRock>();
    for (const rock of normalizedSnapshot) {
      next.set(rock.id, rock);
    }

    const added: SyncedPlaceableRock[] = [];
    const updated: SyncedPlaceableRock[] = [];
    const removed: SyncedPlaceableRock[] = [];

    for (const [id, existing] of this.runtimeRocks) {
      if (next.has(id)) continue;
      this.runtimeRocks.delete(id);
      this.removeRockFootprint(existing);
      removed.push({ ...existing });
    }

    for (const incoming of normalizedSnapshot) {
      const current = this.runtimeRocks.get(incoming.id);
      if (!current) {
        this.runtimeRocks.set(incoming.id, { ...incoming });
        this.setRockFootprint(incoming);
        this.nextRockId = Math.max(this.nextRockId, incoming.id + 1);
        added.push({ ...incoming });
        continue;
      }

      if (
        current.gridX !== incoming.gridX
        || current.gridY !== incoming.gridY
        || current.hp !== incoming.hp
        || current.maxHp !== incoming.maxHp
        || current.ownerColor !== incoming.ownerColor
        || current.expiresAt !== incoming.expiresAt
        || current.warningStartsAt !== incoming.warningStartsAt
        || current.kind !== incoming.kind
        || current.angle !== incoming.angle
        || current.indestructible !== incoming.indestructible
        || current.constructionId !== incoming.constructionId
        || current.ownership !== incoming.ownership
        || current.toolRef?.kind !== incoming.toolRef?.kind
        || current.toolRef?.id !== incoming.toolRef?.id
        || current.turretWeaponId !== incoming.turretWeaponId
        || current.targetRange !== incoming.targetRange
        || current.persistentRewardId !== incoming.persistentRewardId
        || current.persistentId !== incoming.persistentId
      ) {
        this.runtimeRocks.set(incoming.id, { ...incoming });
        if (current.gridX !== incoming.gridX || current.gridY !== incoming.gridY) {
          this.removeRockFootprint(current);
          this.setRockFootprint(incoming);
        }
        updated.push({ ...incoming });
      }
    }

    return { added, updated, removed };
  }

  getPlacementPreview(
    cfg: PlaceableUtilityConfig,
    originX: number,
    originY: number,
    pointerX: number,
    pointerY: number,
  ): UtilityPlacementPreviewState | undefined {
    const targetCell = this.resolveTargetCell(originX, originY, pointerX, pointerY, cfg.placeable.range);
    if (!targetCell) return undefined;

    const targetWorld = this.gridToWorld(targetCell.gridX, targetCell.gridY);
    const isValid = this.canPlaceAt(targetCell.gridX, targetCell.gridY, cfg);
    const mask = AutoTiler.computeMask(targetCell.gridX, targetCell.gridY, (gx, gy) => {
      if (gx === targetCell.gridX && gy === targetCell.gridY) return true;
      return this.rockGrid.isOccupied(gx, gy);
    });

    return {
      angle: Phaser.Math.Angle.Between(originX, originY, targetWorld.x, targetWorld.y),
      targetX: targetWorld.x,
      targetY: targetWorld.y,
      gridX: targetCell.gridX,
      gridY: targetCell.gridY,
      isValid,
      frame: cfg.placeable.kind === 'turret' ? AutoTiler.getFrame(mask, ROCK_AUTOTILE) : 0,
      range: cfg.placeable.range,
      kind: cfg.placeable.kind,
      sourceSlot: 'utility',
      powerUpDefId: cfg.type === 'placeable_pedestal' ? cfg.powerUpDefId : undefined,
      constructionId: getConstructionIdForUtility(cfg.id) ?? undefined,
    };
  }

  getTunnelPlacementPreview(
    cfg: TunnelUltimateConfig,
    originX: number,
    originY: number,
    pointerX: number,
    pointerY: number,
    anchor?: { x: number; y: number; gridX: number; gridY: number } | null,
  ): UtilityPlacementPreviewState | undefined {
    const targetCell = this.resolveTargetCell(originX, originY, pointerX, pointerY, cfg.placement.range);
    if (!targetCell) return undefined;

    const targetWorld = this.gridToWorld(targetCell.gridX, targetCell.gridY);
    const isTargetValid = this.canPlaceSingleCell(targetCell.gridX, targetCell.gridY);
    const isDistinct = !anchor || anchor.gridX !== targetCell.gridX || anchor.gridY !== targetCell.gridY;

    return {
      angle: Phaser.Math.Angle.Between(originX, originY, targetWorld.x, targetWorld.y),
      targetX: targetWorld.x,
      targetY: targetWorld.y,
      gridX: targetCell.gridX,
      gridY: targetCell.gridY,
      isValid: isTargetValid && isDistinct,
      frame: 0,
      range: cfg.placement.range,
      kind: 'tunnel',
      stage: anchor ? 2 : 1,
      anchorX: anchor?.x,
      anchorY: anchor?.y,
      anchorGridX: anchor?.gridX,
      anchorGridY: anchor?.gridY,
      sourceSlot: 'ultimate',
    };
  }

  canPlaceSingleCell(gx: number, gy: number): boolean {
    return this.canPlaceCells([{ dx: 0, dy: 0 }], gx, gy);
  }

  canMaterializeCells(
    footprint: readonly { readonly dx: number; readonly dy: number }[],
    gridX: number,
    gridY: number,
  ): boolean {
    return this.canPlaceCells(footprint, gridX, gridY, false);
  }

  getClampedTargetCell(
    originX: number,
    originY: number,
    pointerX: number,
    pointerY: number,
    range: number,
  ): { gridX: number; gridY: number; x: number; y: number } | null {
    const targetCell = this.resolveTargetCell(originX, originY, pointerX, pointerY, range);
    if (!targetCell) return null;
    const world = this.gridToWorld(targetCell.gridX, targetCell.gridY);
    return { ...targetCell, x: world.x, y: world.y };
  }

  getWorldPointForCell(gridX: number, gridY: number): { x: number; y: number } {
    return this.gridToWorld(gridX, gridY);
  }

  private resolveTargetCell(originX: number, originY: number, pointerX: number, pointerY: number, range: number): { gridX: number; gridY: number } | null {
    const dx = pointerX - originX;
    const dy = pointerY - originY;
    const distance = Math.hypot(dx, dy);
    const dirX = distance > 0.0001 ? dx / distance : 1;
    const dirY = distance > 0.0001 ? dy / distance : 0;
    const pointerInside = isPointInsideArena(pointerX, pointerY) && distance <= range;

    if (pointerInside) {
      const snapped = this.snapWorldToGrid(pointerX, pointerY);
      const snappedWorld = this.gridToWorld(snapped.gridX, snapped.gridY);
      const withinRange = Phaser.Math.Distance.Between(originX, originY, snappedWorld.x, snappedWorld.y) <= range;
      if (withinRange && isPointInsideArena(snappedWorld.x, snappedWorld.y)) {
        return snapped;
      }
    }

    const clipped = clipPointToArenaRay(originX, originY, originX + dirX * range, originY + dirY * range);
    const maxProjection = Phaser.Math.Distance.Between(originX, originY, clipped.x, clipped.y);
    let best: { gridX: number; gridY: number; projection: number } | null = null;
    const radiusCells = Math.ceil(range / CELL_SIZE) + 1;
    const originCell = this.snapWorldToGrid(originX, originY);

    for (let gy = Math.max(0, originCell.gridY - radiusCells); gy <= Math.min(GRID_ROWS - 1, originCell.gridY + radiusCells); gy += 1) {
      for (let gx = Math.max(0, originCell.gridX - radiusCells); gx <= Math.min(GRID_COLS - 1, originCell.gridX + radiusCells); gx += 1) {
        const world = this.gridToWorld(gx, gy);
        const offsetX = world.x - originX;
        const offsetY = world.y - originY;
        const projection = offsetX * dirX + offsetY * dirY;
        if (projection < -0.01 || projection > maxProjection + 0.01) continue;
        if (Phaser.Math.Distance.Between(originX, originY, world.x, world.y) > range) continue;
        if (!isPointInsideArena(world.x, world.y)) continue;
        if (!best || projection > best.projection) {
          best = { gridX: gx, gridY: gy, projection };
        }
      }
    }

    return best ? { gridX: best.gridX, gridY: best.gridY } : null;
  }

  private canPlaceAt(gx: number, gy: number, cfg: PlaceableUtilityConfig): boolean {
    return this.canPlaceCells(cfg.placeable.footprint, gx, gy);
  }

  private canPlaceCells(
    footprint: readonly { dx: number; dy: number }[],
    gx: number,
    gy: number,
    checkPlayers = true,
  ): boolean {
    for (const cell of footprint) {
      const tx = gx + cell.dx;
      const ty = gy + cell.dy;
      if (tx < 0 || tx >= GRID_COLS || ty < 0 || ty >= GRID_ROWS) return false;
      if (isCoopDefenseBaseCell(tx, ty, this.coopDefenseBases)) return false;
      if (this.rockGrid.isOccupied(tx, ty)) return false;
      if (this.treeCells.has(this.key(tx, ty))) return false;
      if (this.trackCells.has(this.key(tx, ty))) return false;
      if (this.pedestalCells.has(this.key(tx, ty))) return false;
      if (this.isHazardCellLocked(this.key(tx, ty))) return false;
      if (this.isClosedBarrierCell(tx, ty)) return false;
      if (checkPlayers && this.isPlayerOccupyingCell(tx, ty)) return false;
    }

    return true;
  }

  private isPlayerOccupyingCell(gx: number, gy: number): boolean {
    for (const player of this.playerManager.getAllPlayers()) {
      if (!player.sprite.active) continue;
      const cell = this.worldToGrid(player.sprite.x, player.sprite.y);
      if (cell.gridX === gx && cell.gridY === gy) return true;
    }
    return false;
  }

  private snapWorldToGrid(x: number, y: number): { gridX: number; gridY: number } {
    const gridX = Phaser.Math.Clamp(
      Math.round((x - ARENA_OFFSET_X - CELL_SIZE * 0.5) / CELL_SIZE),
      0,
      GRID_COLS - 1,
    );
    const gridY = Phaser.Math.Clamp(
      Math.round((y - ARENA_OFFSET_Y - CELL_SIZE * 0.5) / CELL_SIZE),
      0,
      GRID_ROWS - 1,
    );
    return { gridX, gridY };
  }

  private worldToGrid(x: number, y: number): { gridX: number; gridY: number } {
    const gridX = Phaser.Math.Clamp(Math.floor((x - ARENA_OFFSET_X) / CELL_SIZE), 0, GRID_COLS - 1);
    const gridY = Phaser.Math.Clamp(Math.floor((y - ARENA_OFFSET_Y) / CELL_SIZE), 0, GRID_ROWS - 1);
    return { gridX, gridY };
  }

  private gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: ARENA_OFFSET_X + gridX * CELL_SIZE + CELL_SIZE * 0.5,
      y: ARENA_OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE * 0.5,
    };
  }

  private key(gx: number, gy: number): string {
    return `${gx}_${gy}`;
  }

  private setRockFootprint(rock: SyncedPlaceableRock): void {
    for (const cell of rock.footprint ?? [{ dx: 0, dy: 0 }]) {
      this.rockGrid.set(rock.gridX + cell.dx, rock.gridY + cell.dy, rock.id);
    }
  }

  private removeRockFootprint(rock: SyncedPlaceableRock): void {
    for (const cell of rock.footprint ?? [{ dx: 0, dy: 0 }]) {
      const gridX = rock.gridX + cell.dx;
      const gridY = rock.gridY + cell.dy;
      if (this.rockGrid.getIndex(gridX, gridY) === rock.id) this.rockGrid.remove(gridX, gridY);
    }
  }
}

function segmentIntersectsGridCell(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  gridX: number,
  gridY: number,
): boolean {
  const dx = endX - startX;
  const dy = endY - startY;
  let minT = 0;
  let maxT = 1;
  for (const [origin, delta, min, max] of [
    [startX, dx, gridX, gridX + 1],
    [startY, dy, gridY, gridY + 1],
  ] as const) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < min || origin > max) return false;
      continue;
    }
    const first = (min - origin) / delta;
    const second = (max - origin) / delta;
    minT = Math.max(minT, Math.min(first, second));
    maxT = Math.min(maxT, Math.max(first, second));
    if (minT > maxT) return false;
  }
  return true;
}

function normalizeRockSnapshot(rock: SyncedPlaceableRock): SyncedPlaceableRock {
  const constructionId = normalizeConstructionId(rock.constructionId)
    ?? normalizeConstructionId(rock.toolRef?.id);
  if (!constructionId) return { ...rock };
  return {
    ...rock,
    constructionId,
    expiresAt: 0,
    warningStartsAt: 0,
    ownership: rock.ownership ?? 'host-persistent',
    toolRef: { kind: 'construction', id: constructionId },
  };
}
