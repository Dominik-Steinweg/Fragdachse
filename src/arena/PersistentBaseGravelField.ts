import { CELL_SIZE } from '../config';
import type { PersistentBaseAnchor } from '../persistentBase/PersistentBaseTypes';
import {
  getPersistentBaseBuildAreaExtentCells,
  type PersistentBaseBuildArea,
} from '../persistentBase/PersistentBaseCore';
import { isCellInsidePersistentBaseZone } from '../persistentBase/PersistentBaseZone';
import { hashSeededCell01 } from './CellHash';
import {
  getPersistentBaseGravelTextureKey,
  PERSISTENT_BASE_GRAVEL_DECORATION_CONFIG,
  type PersistentBaseGravelDecorationConfig,
} from './PersistentBaseGravelConfig';
import type { GroundCoverStampPlacement } from './GroundCoverField';

export interface PersistentBaseGravelCell {
  readonly gridX: number;
  readonly gridY: number;
}

export interface PersistentBaseGravelDecoration extends GroundCoverStampPlacement {
  readonly gridX: number;
  readonly gridY: number;
}

export interface PersistentBaseGravelFrame {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

export interface PersistentBaseGravelFieldOptions {
  readonly seed: number;
  readonly anchor: PersistentBaseAnchor;
  readonly buildArea: PersistentBaseBuildArea;
  readonly frame: PersistentBaseGravelFrame;
  readonly config?: PersistentBaseGravelDecorationConfig;
}

export interface PersistentBaseGravelState {
  readonly key: string;
  readonly seed: number;
  readonly anchor: PersistentBaseAnchor;
  readonly buildArea: PersistentBaseBuildArea;
  readonly cells: readonly PersistentBaseGravelCell[];
  readonly cellKeys: ReadonlySet<string>;
  readonly decorations: readonly PersistentBaseGravelDecoration[];
}

const DECORATION_SALTS = {
  coverage: 0x1f01,
  variant: 0x1f02,
  offsetX: 0x1f03,
  offsetY: 0x1f04,
  size: 0x1f05,
  rotation: 0x1f06,
  alpha: 0x1f07,
  mirrorX: 0x1f08,
  mirrorY: 0x1f09,
} as const;

/** Stable key shared by the renderer and the scene's change detector. */
export function getPersistentBaseGravelStateKey(
  seed: number,
  anchor: PersistentBaseAnchor,
  buildArea: PersistentBaseBuildArea,
): string {
  const areaKey = buildArea.kind === 'square'
    ? `square:${buildArea.sizeCells}`
    : `radius:${buildArea.radiusCells}`;
  return `${seed >>> 0}:${anchor.gridX}:${anchor.gridY}:${areaKey}`;
}

/**
 * Builds the complete current gravel cell set from the same build-area predicate used by
 * placement and persistence. The active area is intentionally the only extent input;
 * MAX_RADIUS is only a generator reservation and must never leak into this presentation field.
 */
export function getPersistentBaseGravelCells(
  anchor: PersistentBaseAnchor,
  buildArea: PersistentBaseBuildArea,
  gridCols: number,
  gridRows: number,
): PersistentBaseGravelCell[] {
  const extent = getPersistentBaseBuildAreaExtentCells(buildArea);
  if (!Number.isFinite(extent) || extent < 0 || gridCols <= 0 || gridRows <= 0) return [];

  const cells: PersistentBaseGravelCell[] = [];
  for (
    let gridY = Math.max(0, anchor.gridY - extent);
    gridY <= Math.min(gridRows - 1, anchor.gridY + extent);
    gridY += 1
  ) {
    for (
      let gridX = Math.max(0, anchor.gridX - extent);
      gridX <= Math.min(gridCols - 1, anchor.gridX + extent);
      gridX += 1
    ) {
      if (!isCellInsidePersistentBaseZone(gridX - anchor.gridX, gridY - anchor.gridY, buildArea)) continue;
      cells.push({ gridX, gridY });
    }
  }
  return cells;
}

export function createPersistentBaseGravelState(
  options: PersistentBaseGravelFieldOptions,
): PersistentBaseGravelState {
  const gridCols = Math.max(0, Math.ceil(options.frame.width / CELL_SIZE));
  const gridRows = Math.max(0, Math.ceil(options.frame.height / CELL_SIZE));
  const cells = getPersistentBaseGravelCells(options.anchor, options.buildArea, gridCols, gridRows);
  const cellKeys = new Set(cells.map((cell) => persistentBaseGravelCellKey(cell.gridX, cell.gridY)));
  const decorations = createPersistentBaseGravelDecorations(
    options.seed,
    options.anchor,
    cells,
    options.buildArea,
    options.frame,
    options.config ?? PERSISTENT_BASE_GRAVEL_DECORATION_CONFIG,
  );

  return {
    key: getPersistentBaseGravelStateKey(options.seed, options.anchor, options.buildArea),
    seed: options.seed,
    anchor: { ...options.anchor },
    buildArea: { ...options.buildArea },
    cells,
    cellKeys,
    decorations,
  };
}

export function persistentBaseGravelCellKey(gridX: number, gridY: number): string {
  return `${gridX}:${gridY}`;
}

export function getPersistentBaseGravelDecorationReachPx(
  config: PersistentBaseGravelDecorationConfig = PERSISTENT_BASE_GRAVEL_DECORATION_CONFIG,
): number {
  return CELL_SIZE * config.maxSizeCells * Math.SQRT2 * 0.5;
}

function createPersistentBaseGravelDecorations(
  seed: number,
  anchor: PersistentBaseAnchor,
  cells: readonly PersistentBaseGravelCell[],
  buildArea: PersistentBaseBuildArea,
  frame: PersistentBaseGravelFrame,
  config: PersistentBaseGravelDecorationConfig,
): PersistentBaseGravelDecoration[] {
  const variants = config.variants.filter((variant) => variant.frequencyPercent > 0);
  if (variants.length === 0 || config.coveragePercent <= 0) return [];

  const decorations: PersistentBaseGravelDecoration[] = [];
  for (const cell of cells) {
    if (hashSeededCell01(seed, cell.gridX, cell.gridY, DECORATION_SALTS.coverage)
      >= config.coveragePercent / 100) continue;

    const picked = pickWeightedVariant(
      variants,
      hashSeededCell01(seed, cell.gridX, cell.gridY, DECORATION_SALTS.variant),
    );
    const offsetX = (hashSeededCell01(seed, cell.gridX, cell.gridY, DECORATION_SALTS.offsetX) - 0.5)
      * 2 * config.maxOffsetCells;
    const offsetY = (hashSeededCell01(seed, cell.gridX, cell.gridY, DECORATION_SALTS.offsetY) - 0.5)
      * 2 * config.maxOffsetCells;
    const sizeRoll = hashSeededCell01(seed, cell.gridX, cell.gridY, DECORATION_SALTS.size) ** config.sizeBias;
    const sizeCells = config.minSizeCells + (config.maxSizeCells - config.minSizeCells) * sizeRoll;
    const rotatedStampRadius = sizeCells * Math.SQRT2 * 0.5;
    if (buildArea.kind === 'radius') {
      const centerDistance = Math.hypot(
        cell.gridX + offsetX - anchor.gridX,
        cell.gridY + offsetY - anchor.gridY,
      );
      if (centerDistance + rotatedStampRadius > buildArea.radiusCells + config.maxOverhangCells) continue;
    } else if (!isCellInsidePersistentBaseZone(
      cell.gridX + offsetX - anchor.gridX,
      cell.gridY + offsetY - anchor.gridY,
      buildArea,
    )) {
      // Square areas keep their exact cell set; only the authored stamp itself may overhang
      // that edge slightly. No circular fallback is allowed for the current 3x3 courtyard.
      continue;
    }
    const alphaRoll = hashSeededCell01(seed, cell.gridX, cell.gridY, DECORATION_SALTS.alpha);
    decorations.push({
      gridX: cell.gridX,
      gridY: cell.gridY,
      textureKey: getPersistentBaseGravelTextureKey(picked.fileName),
      worldX: frame.offsetX + (cell.gridX + 0.5 + offsetX) * CELL_SIZE,
      worldY: frame.offsetY + (cell.gridY + 0.5 + offsetY) * CELL_SIZE,
      sizePx: CELL_SIZE * sizeCells,
      rotation: hashSeededCell01(seed, cell.gridX, cell.gridY, DECORATION_SALTS.rotation) * Math.PI * 2,
      alpha: config.minAlpha + (config.maxAlpha - config.minAlpha) * alphaRoll,
      mirrorX: hashSeededCell01(seed, cell.gridX, cell.gridY, DECORATION_SALTS.mirrorX) < 0.5,
      mirrorY: hashSeededCell01(seed, cell.gridX, cell.gridY, DECORATION_SALTS.mirrorY) < 0.5,
    });
  }
  return decorations;
}

function pickWeightedVariant<T extends { readonly frequencyPercent: number }>(
  variants: readonly T[],
  normalizedRoll: number,
): T {
  let totalWeight = 0;
  for (const variant of variants) totalWeight += variant.frequencyPercent;
  let roll = normalizedRoll * totalWeight;
  for (const variant of variants) {
    roll -= variant.frequencyPercent;
    if (roll <= 0) return variant;
  }
  return variants[variants.length - 1];
}
