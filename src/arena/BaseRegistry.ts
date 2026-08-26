import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  isCaptureTheBeerBaseCell,
  isCaptureTheBeerBaseModeActive,
  isCoopDefenseBasesActive,
  isGridCellInArenaRegion,
  type ArenaGridRegion,
} from '../config';
import { bridge } from '../network/bridge';
import {
  getCoopDefenseMapConfig,
  type CoopBaseAnchor,
  type CoopBaseCellOffset,
  type CoopBaseConfig,
  type CoopBaseFaction,
  type CoopBasePowerUpPedestalConfig,
  type CoopBaseShape,
  type CoopBaseTurretConfig,
  type CoopBaseRole,
  type CoopBaseTurretWeaponId,
  type CoopDefenseMapConfig,
  type ResolvedCoopDefenseMapPersistentBaseConfig,
  DEFAULT_COOP_DEFENSE_STRUCTURE_HP_FACTOR_PER_ADDITIONAL_PLAYER,
} from '../config/coopDefenseMaps';
import { resolveCoopDefensePositiveInteger } from '../config/coopDefenseScaling';
import { MAX_PERSISTENT_BASE_RADIUS_CELLS, PERSISTENT_BASE_CLEARANCE_CELLS } from '../config/persistentBase';
import { isCellInsidePersistentBaseReservation } from '../persistentBase/PersistentBaseZone';
import { createPersistentBaseCoreConfig } from '../persistentBase/PersistentBaseSite';
import type { PersistentBaseAnchor } from '../persistentBase/PersistentBaseTypes';

export interface BaseTurretSpec {
  readonly id: string;
  readonly baseId: string;
  readonly x: number;
  readonly y: number;
  readonly initialAngle: number;
  readonly weaponId: CoopBaseTurretWeaponId;
}

export interface BasePowerUpPedestalSpec {
  readonly id: string;
  readonly baseId: string;
  readonly gridX: number;
  readonly gridY: number;
  readonly defId: string;
  readonly respawnMs: number;
  readonly spawnOnArenaStart: boolean;
}

/**
 * Beschreibt eine einzelne Basis: Identität + Grid-Footprint + HP-Soll.
 *
 *  - `cells`  ist die maßgebliche Quelle für alle räumlichen Lookups
 *             (Flow-Field, Autotile, Per-Zell-Collider, Mitgliedschafts-Checks).
 *             Erlaubt beliebige (auch konkave) Formen.
 *  - `region` ist die abgeleitete achsenparallele Bounding-Box. Wird für
 *             HP-Bar-Positionierung, Pixel-Bounds und die konservativen
 *             Clearance-/Border-Tests des Generators verwendet.
 *  - `hpMax`  ist der aus dem Ein-Spieler-Basiswert und der beim Rundenstart festgelegten
 *             menschlichen Spielerzahl aufgeloeste Wert.
 */
export interface BaseSpec {
  readonly id: string;
  readonly cells: readonly { gridX: number; gridY: number }[];
  readonly region: ArenaGridRegion;
  /** Stable geometric anchor used by map-relative persistent constructions. */
  readonly anchorGridX?: number;
  readonly anchorGridY?: number;
  /** Set only on the authored persistent friendly main base. */
  readonly persistentReservationRadiusCells?: number;
  readonly hpMax: number;
  /**
   * Authored Start-HP (Standard: `hpMax`). Beide Peers loesen ihn deterministisch aus der Map auf,
   * damit ein bewusst beschaedigtes Missionsziel keinen eigenen Netzwerkpfad braucht.
   */
  readonly startHp?: number;
  /**
   * Bestimmt, wer die Basis angreift, wer sie repariert und ob ihr Fall die Runde gewinnt oder
   * verliert. Host und Client leiten sie identisch aus der replizierten Map-ID ab; sie ist
   * deshalb kein Teil des Netzwerk-Snapshots.
   */
  readonly faction: CoopBaseFaction;
  readonly role: CoopBaseRole;
  /** True while the linked secondary objective is still dormant. */
  readonly dormant?: boolean;
  /** Stable objective id used to derive activation from the B1 presentation snapshot. */
  readonly dormantObjectiveId?: string;
  readonly turrets: readonly BaseTurretSpec[];
  readonly powerUpPedestals: readonly BasePowerUpPedestalSpec[];
  readonly spawnCenter?: {
    readonly gridX: number;
    readonly gridY: number;
    readonly x: number;
    readonly y: number;
  };
}

// ── Anker- & Shape-Auflösung ───────────────────────────────────────────────

function resolveShape(shape: CoopBaseShape): {
  cells: readonly CoopBaseCellOffset[];
  width: number;
  height: number;
} {
  if (shape.kind === 'rectangle') {
    const w = Math.max(1, shape.widthCells);
    const h = Math.max(1, shape.heightCells);
    const cells: CoopBaseCellOffset[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) cells.push({ gridX: x, gridY: y });
    }
    return { cells, width: w, height: h };
  }
  let maxX = 0;
  let maxY = 0;
  for (const cell of shape.cells) {
    if (cell.gridX > maxX) maxX = cell.gridX;
    if (cell.gridY > maxY) maxY = cell.gridY;
  }
  return { cells: shape.cells, width: maxX + 1, height: maxY + 1 };
}

function resolveAnchorOrigin(anchor: CoopBaseAnchor, width: number, height: number): {
  minGridX: number;
  minGridY: number;
} {
  switch (anchor.kind) {
    case 'right-center': {
      const inset = Math.max(0, anchor.edgeInsetCells);
      const minGridX = GRID_COLS - width - inset;
      const minGridY = Math.floor((GRID_ROWS - height) / 2);
      return { minGridX, minGridY };
    }
    case 'left-center': {
      const inset = Math.max(0, anchor.edgeInsetCells);
      const minGridX = inset;
      const minGridY = Math.floor((GRID_ROWS - height) / 2);
      return { minGridX, minGridY };
    }
    case 'center-offset': {
      const minGridX = Math.floor((GRID_COLS - width) / 2) + anchor.dxCells;
      const minGridY = Math.floor((GRID_ROWS - height) / 2) + anchor.dyCells;
      return { minGridX, minGridY };
    }
    case 'grid':
      return { minGridX: anchor.gridX, minGridY: anchor.gridY };
  }
}

function clampOriginToGrid(originX: number, originY: number, width: number, height: number): {
  minGridX: number;
  minGridY: number;
} {
  const minGridX = Math.max(0, Math.min(originX, GRID_COLS - width));
  const minGridY = Math.max(0, Math.min(originY, GRID_ROWS - height));
  return { minGridX, minGridY };
}

function resolveBaseSpec(
  config: CoopBaseConfig,
  humanPlayerCount: number,
  dormantObjectiveId?: string,
): BaseSpec {
  const { cells: relativeCells, width, height } = resolveShape(config.shape);
  const origin = resolveAnchorOrigin(config.anchor, width, height);
  const { minGridX, minGridY } = clampOriginToGrid(origin.minGridX, origin.minGridY, width, height);

  const absoluteCells = relativeCells
    .map((cell) => ({ gridX: minGridX + cell.gridX, gridY: minGridY + cell.gridY }))
    .filter((cell) => cell.gridX >= 0 && cell.gridX < GRID_COLS && cell.gridY >= 0 && cell.gridY < GRID_ROWS);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const cell of absoluteCells) {
    if (cell.gridX < minX) minX = cell.gridX;
    if (cell.gridY < minY) minY = cell.gridY;
    if (cell.gridX > maxX) maxX = cell.gridX;
    if (cell.gridY > maxY) maxY = cell.gridY;
  }
  const region: ArenaGridRegion = absoluteCells.length > 0
    ? { minGridX: minX, maxGridX: maxX, minGridY: minY, maxGridY: maxY }
    : { minGridX: 0, maxGridX: 0, minGridY: 0, maxGridY: 0 };

  let spawnCenter: BaseSpec['spawnCenter'];
  if (config.role === 'spawn-point') {
    const relativeCenter = config.spawnCenter;
    if (!relativeCenter) {
      throw new Error(`[BaseRegistry] Spawn point ${config.id} has no spawnCenter`);
    }
    if (
      relativeCenter.gridX < 0
      || relativeCenter.gridX >= width
      || relativeCenter.gridY < 0
      || relativeCenter.gridY >= height
    ) {
      throw new Error(`[BaseRegistry] Spawn point ${config.id} has a spawnCenter outside its shape bounds`);
    }
    const centerGridX = minGridX + relativeCenter.gridX;
    const centerGridY = minGridY + relativeCenter.gridY;
    if (absoluteCells.some((cell) => cell.gridX === centerGridX && cell.gridY === centerGridY)) {
      throw new Error(`[BaseRegistry] Spawn point ${config.id} needs a free spawnCenter cell`);
    }
    spawnCenter = {
      gridX: centerGridX,
      gridY: centerGridY,
      x: ARENA_OFFSET_X + centerGridX * CELL_SIZE + CELL_SIZE / 2,
      y: ARENA_OFFSET_Y + centerGridY * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  const turrets = (config.turrets ?? []).map((turret) => resolveBaseTurretSpec(
    config.id,
    turret,
    minGridX,
    minGridY,
  ));
  const powerUpPedestals = (config.powerUpPedestals ?? []).map((pedestal) => resolveBasePowerUpPedestalSpec(
    config.id,
    pedestal,
    minGridX,
    minGridY,
    absoluteCells,
  ));
  const faction = config.faction ?? 'friendly';
  const hpFactor = config.playerScaling?.maxHpFactorPerAdditionalPlayer
    ?? (faction === 'hostile' ? DEFAULT_COOP_DEFENSE_STRUCTURE_HP_FACTOR_PER_ADDITIONAL_PLAYER : 0);
  const hpMax = resolveCoopDefensePositiveInteger(config.hpMax, hpFactor, humanPlayerCount);
  // Untergrenze 1: Bei 0 waere die Struktur von Rundenbeginn an zerstoert und koennte nie mehr
  // aktiviert werden (BaseEntity.activate() lehnt zerstoerte Basen ab).
  const startHp = config.startHpFactor === undefined
    ? hpMax
    : Math.max(1, Math.min(hpMax, Math.round(hpMax * config.startHpFactor)));

  return {
    id: config.id,
    cells: absoluteCells,
    region,
    hpMax,
    startHp,
    faction,
    role: config.role ?? 'main',
    dormant: config.dormant === true,
    ...(dormantObjectiveId === undefined ? {} : { dormantObjectiveId }),
    turrets,
    powerUpPedestals,
    spawnCenter,
  };
}

function resolveBasePowerUpPedestalSpec(
  baseId: string,
  config: CoopBasePowerUpPedestalConfig,
  baseMinGridX: number,
  baseMinGridY: number,
  baseCells: readonly { gridX: number; gridY: number }[],
): BasePowerUpPedestalSpec {
  const gridX = baseMinGridX + config.cellOffset.gridX;
  const gridY = baseMinGridY + config.cellOffset.gridY;
  if (gridX < 0 || gridX >= GRID_COLS || gridY < 0 || gridY >= GRID_ROWS) {
    throw new Error(`[BaseRegistry] Power-up pedestal ${baseId}:${config.id} is outside the arena grid`);
  }
  if (baseCells.some((cell) => cell.gridX === gridX && cell.gridY === gridY)) {
    throw new Error(`[BaseRegistry] Power-up pedestal ${baseId}:${config.id} overlaps its base`);
  }

  return {
    id: `${baseId}:${config.id}`,
    baseId,
    gridX,
    gridY,
    defId: config.defId,
    respawnMs: config.respawnMs,
    spawnOnArenaStart: config.spawnOnArenaStart ?? false,
  };
}

function resolveBaseTurretSpec(
  baseId: string,
  config: CoopBaseTurretConfig,
  baseMinGridX: number,
  baseMinGridY: number,
): BaseTurretSpec {
  const cellCenterX = ARENA_OFFSET_X + (baseMinGridX + config.cellOffset.gridX) * CELL_SIZE + CELL_SIZE / 2;
  const cellCenterY = ARENA_OFFSET_Y + (baseMinGridY + config.cellOffset.gridY) * CELL_SIZE + CELL_SIZE / 2;
  // Der Turm sitzt optisch exakt auf der konfigurierten Basiszelle. Sichtlinie und
  // Projektil beginnen erst an seiner Mündung (siehe TurretSystem), damit der
  // darunterliegende Basis-Collider den Turm nicht selbst blockiert.

  switch (config.mountSide) {
    case 'front':
      return { id: `${baseId}:${config.id}`, baseId, x: cellCenterX, y: cellCenterY, initialAngle: Math.PI, weaponId: config.weaponId };
    case 'rear':
      return { id: `${baseId}:${config.id}`, baseId, x: cellCenterX, y: cellCenterY, initialAngle: 0, weaponId: config.weaponId };
    case 'top':
      return { id: `${baseId}:${config.id}`, baseId, x: cellCenterX, y: cellCenterY, initialAngle: -Math.PI / 2, weaponId: config.weaponId };
    case 'bottom':
      return { id: `${baseId}:${config.id}`, baseId, x: cellCenterX, y: cellCenterY, initialAngle: Math.PI / 2, weaponId: config.weaponId };
  }
}

// ── Öffentliche API ────────────────────────────────────────────────────────

/**
 * Basen der aktuell aufgebauten Welt.
 *
 * `buildArena()` hinterlegt sie hier, `tearDownArena()` löscht sie wieder. Ohne diese Bindung
 * lösten Aufrufer ohne Argumente die *ausgewählte Kampagnenkarte* neu auf – auf einer anderen
 * Welt (Basis-Editor) oder mit einer anderen Spielerzahl ergab das andere Basen als die, die
 * tatsächlich stehen.
 */
let activeCoopDefenseBases: readonly BaseSpec[] | null = null;

export function setActiveCoopDefenseBases(bases: readonly BaseSpec[] | null): void {
  activeCoopDefenseBases = bases;
}

/** Aktive Coop-Basen für die laufende Welt. Leeres Array außerhalb des Coop-Modus. */
export function getCoopDefenseBases(
  mapConfig?: CoopDefenseMapConfig,
  humanPlayerCount = 1,
): readonly BaseSpec[] {
  if (!isCoopDefenseBasesActive()) return [];
  if (mapConfig === undefined) {
    return activeCoopDefenseBases
      ?? resolveCoopDefenseBases(resolveActiveCoopDefenseMapConfig(), humanPlayerCount);
  }
  return resolveCoopDefenseBases(mapConfig, humanPlayerCount);
}

/** Löst eine Map-Konfiguration unabhängig vom derzeit aktiven Spielmodus auf. */
export function resolveCoopDefenseBases(
  mapConfig: CoopDefenseMapConfig,
  humanPlayerCount = 1,
): readonly BaseSpec[] {
  const objectiveByBaseId = new Map<string, string>();
  for (const objective of mapConfig.secondaryObjectives ?? []) {
    if (objective.type === 'carry' && objective.carry !== undefined) continue;
    for (const baseId of objective.targets) objectiveByBaseId.set(baseId, objective.id);
  }
  const resolved = mapConfig.bases.map((baseConfig) => resolveBaseSpec(
    baseConfig,
    humanPlayerCount,
    baseConfig.dormant === true ? objectiveByBaseId.get(baseConfig.id) : undefined,
  ));
  const site = resolvePersistentBaseSiteAnchor(mapConfig);
  if (!site) return resolved;
  // Der Kern wird ergänzt, nicht aus den authored Basen ausgewählt: Er ist kampagnenweit
  // dieselbe Struktur und läuft trotzdem durch denselben resolveBaseSpec-Pfad.
  return [
    ...resolved,
    {
      ...resolveBaseSpec(createPersistentBaseCoreConfig(site), humanPlayerCount),
      anchorGridX: site.gridX,
      anchorGridY: site.gridY,
      persistentReservationRadiusCells: MAX_PERSISTENT_BASE_RADIUS_CELLS + PERSISTENT_BASE_CLEARANCE_CELLS,
    },
  ];
}

/** Zonenmittelpunkt der Karte, oder `null`, wenn sie keinen persistenten Bereich trägt. */
export function resolvePersistentBaseSiteAnchor(
  mapConfig: CoopDefenseMapConfig,
): PersistentBaseAnchor | null {
  const config = mapConfig.persistentBase as ResolvedCoopDefenseMapPersistentBaseConfig | undefined;
  if (!config || !Number.isInteger(config.anchorGridX) || !Number.isInteger(config.anchorGridY)) return null;
  return { gridX: config.anchorGridX, gridY: config.anchorGridY };
}

function resolveActiveCoopDefenseMapConfig(): CoopDefenseMapConfig {
  return getCoopDefenseMapConfig(bridge.getCoopDefenseMapId());
}

/** Pixel-Bounds einer Basis-Region (Bounding-Box) anhand der aktiven Arena-Metriken. */
export function getBaseWorldBounds(region: ArenaGridRegion): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: ARENA_OFFSET_X + region.minGridX * CELL_SIZE,
    y: ARENA_OFFSET_Y + region.minGridY * CELL_SIZE,
    width: (region.maxGridX - region.minGridX + 1) * CELL_SIZE,
    height: (region.maxGridY - region.minGridY + 1) * CELL_SIZE,
  };
}

/**
 * Deterministic pickup location for a mission reward. The pickup sits on the first available
 * cell around the base bounds, never inside a colliding cell of this or another base.
 */
export function getBaseRewardPickupWorldPosition(
  base: Pick<BaseSpec, 'cells' | 'region'>,
  bases: readonly Pick<BaseSpec, 'cells' | 'region'>[] = [base],
): { x: number; y: number } | null {
  if (base.cells.length === 0) return null;

  const occupied = new Set(
    bases.flatMap((entry) => entry.cells.map((cell) => `${cell.gridX}:${cell.gridY}`)),
  );
  const minGridX = base.region.minGridX;
  const maxGridX = base.region.maxGridX;
  const minGridY = base.region.minGridY;
  const maxGridY = base.region.maxGridY;

  const candidates: Array<{ gridX: number; gridY: number }> = [];
  const addRing = (distance: number): void => {
    const left = minGridX - distance;
    const right = maxGridX + distance;
    const top = minGridY - distance;
    const bottom = maxGridY + distance;
    for (let gridX = left; gridX <= right; gridX += 1) candidates.push({ gridX, gridY: top });
    for (let gridY = top + 1; gridY <= bottom; gridY += 1) candidates.push({ gridX: right, gridY });
    for (let gridX = right - 1; gridX >= left; gridX -= 1) candidates.push({ gridX, gridY: bottom });
    for (let gridY = bottom - 1; gridY > top; gridY -= 1) candidates.push({ gridX: left, gridY });
  };

  // The immediate ring is the authored "at the base" position. Larger rings only handle maps
  // where another structure occupies part of the first ring or the base touches the arena edge.
  for (let distance = 1; distance <= Math.max(GRID_COLS, GRID_ROWS); distance += 1) {
    addRing(distance);
    for (const candidate of candidates) {
      if (
        candidate.gridX < 0 || candidate.gridX >= GRID_COLS
        || candidate.gridY < 0 || candidate.gridY >= GRID_ROWS
        || occupied.has(`${candidate.gridX}:${candidate.gridY}`)
      ) continue;
      return {
        x: ARENA_OFFSET_X + candidate.gridX * CELL_SIZE + CELL_SIZE / 2,
        y: ARENA_OFFSET_Y + candidate.gridY * CELL_SIZE + CELL_SIZE / 2,
      };
    }
    candidates.length = 0;
  }

  return null;
}

/**
 * Räumlicher Schutz-Radius um eine Coop-Basis (Chebyshev-Distanz in Zellen
 * relativ zur Bounding-Box), innerhalb dessen KEINE bewegungs-blockierenden
 * Elemente platziert werden (Felsen, Bäume, Power-Up-Podeste).
 *
 * Dirt und Decals sind rein visuell und blockieren die Bewegung nicht; sie
 * dürfen weiterhin im Schutz-Radius erscheinen (siehe `isReservedBaseSurfaceCell`).
 */
export const COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS = 5;
/** Zwischen einer Coop-Basis und dem zweizelligen Gleis-Fußabdruck bleibt eine freie Zelle. */
export const COOP_DEFENSE_BASE_TRACK_CLEARANCE_CELLS = 1;

function isCoopDefenseBaseWithinBoundingBoxDistance(
  gx: number,
  gy: number,
  distance: number,
  bases?: readonly BaseSpec[],
): boolean {
  if (!bases && !isCoopDefenseBasesActive()) return false;
  const resolvedBases = bases ?? getCoopDefenseBases();
  if (resolvedBases.length === 0) return false;
  for (const base of resolvedBases) {
    if (
      gx >= base.region.minGridX - distance
      && gx <= base.region.maxGridX + distance
      && gy >= base.region.minGridY - distance
      && gy <= base.region.maxGridY + distance
    ) return true;
  }
  return false;
}

/** True wenn (gx, gy) **exakt** auf einer Zelle einer Coop-Basis liegt (konkavitätsbewusst). */
export function isCoopDefenseBaseCell(
  gx: number,
  gy: number,
  bases?: readonly BaseSpec[],
): boolean {
  if (!bases && !isCoopDefenseBasesActive()) return false;
  for (const base of bases ?? getCoopDefenseBases()) {
    for (const cell of base.cells) {
      if (cell.gridX === gx && cell.gridY === gy) return true;
    }
  }
  return false;
}

/**
 * True wenn (gx, gy) in der Bounding-Box einer Coop-Basis ODER im 1-Zellen-Rand
 * drumherum liegt. Wird vom Spawn-System genutzt (Spieler sollen weder auf
 * noch direkt neben der Basis spawnen).
 */
export function isCoopDefenseBaseOrBorderCell(gx: number, gy: number): boolean {
  return isCoopDefenseBaseWithinBoundingBoxDistance(gx, gy, 1);
}

/**
 * True wenn (gx, gy) innerhalb des Hindernis-Schutz-Radius einer Coop-Basis
 * liegt (= Bounding-Box + 5 Zellen). Bewusst Bounding-Box-basiert, damit
 * konkave Innenflächen (z. B. die Lücke einer C-Form) frei von Felsen/Bäumen
 * bleiben.
 */
export function isCoopDefenseBaseObstacleClearanceCell(
  gx: number,
  gy: number,
  bases?: readonly BaseSpec[],
): boolean {
  return isCoopDefenseBaseWithinBoundingBoxDistance(
    gx,
    gy,
    COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS,
    bases,
  );
}

/**
 * Aggregator: vom Generator zu reservierende Zelle für **bewegungs-blockierende**
 * Elemente (Felsen, Bäume, Power-Up-Podeste).
 * - CTB: exakte Basis-Zelle.
 * - Coop: Bounding-Box + 5-Zellen-Schutz-Radius.
 */
export function isReservedBaseObstacleCell(
  gx: number,
  gy: number,
  bases?: readonly BaseSpec[],
): boolean {
  if (isCaptureTheBeerBaseCell(gx, gy)) return true;
  if (isCoopDefenseBaseObstacleClearanceCell(gx, gy, bases)) return true;
  return isPersistentBaseReservationCell(gx, gy, bases);
}

export function isPersistentBaseReservationCell(
  gx: number,
  gy: number,
  bases?: readonly BaseSpec[],
): boolean {
  return bases?.some((base) => base.persistentReservationRadiusCells !== undefined && (
    isCellInsidePersistentBaseReservation(
      gx,
      gy,
      {
        gridX: base.anchorGridX ?? Math.floor((base.region.minGridX + base.region.maxGridX) / 2),
        gridY: base.anchorGridY ?? Math.floor((base.region.minGridY + base.region.maxGridY) / 2),
      },
    )
  )) ?? false;
}

/**
 * Aggregator: vom Generator zu reservierende Zelle für **rein visuelle**
 * Oberflächen-Elemente (Dirt, Decals).
 * - CTB: exakte Basis-Zelle.
 * - Coop: exakte Basis-Zelle (konkavitätsbewusst – Lücken bleiben begehbar
 *   und dürfen Dirt/Decals tragen).
 */
export function isReservedBaseSurfaceCell(
  gx: number,
  gy: number,
  bases?: readonly BaseSpec[],
): boolean {
  if (isCaptureTheBeerBaseCell(gx, gy)) return true;
  if (isCoopDefenseBaseCell(gx, gy, bases)) return true;
  return false;
}

/**
 * Hilfsfunktion: Region (Bounding-Box) → True wenn (gx,gy) drinliegt.
 * Wird vom Generator-Pfad weiterhin als Sanity-Check verwendet.
 */
export function isCellInBaseRegion(spec: BaseSpec, gx: number, gy: number): boolean {
  return isGridCellInArenaRegion(spec.region, gx, gy);
}

/**
 * True wenn der aktive Modus den Zug-Gleis-Spawn zentriert (CTB & Coop).
 */
export function usesCenteredTrackSpawn(): boolean {
  return isCoopDefenseBasesActive() || isCaptureTheBeerBaseModeActive();
}
