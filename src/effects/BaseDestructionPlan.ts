import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
} from '../config';
import type { BaseSpec } from '../arena/BaseRegistry';
import type { FireChunkTarget } from '../types';

const MIN_CELL_STAGGER_MS = 48;
const MAX_CELL_STAGGER_MS = 96;
const CHUNKS_PER_CELL = 4;
const BLAST_PADDING = CELL_SIZE * 2.5;
const BLAST_FORCE = 320;
const BLAST_DURATION_MS = 240;
const TWO_PI = Math.PI * 2;

export const BASE_DESTRUCTION_GROUND_FIRE_DURATION_MS = 3000;
export const BASE_DESTRUCTION_GROUND_BURN_DURATION_MS = 2000;
export const BASE_DESTRUCTION_GROUND_BURN_DAMAGE_PER_TICK = 0.5;

export interface BaseDestructionStep {
  readonly cellIndex: number;
  readonly x: number;
  readonly y: number;
  readonly delayMs: number;
  readonly chunkTargets: readonly FireChunkTarget[];
}

export interface BaseDestructionBlast {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly force: number;
  readonly durationMs: number;
}

/**
 * Baut eine reproduzierbare, nach außen laufende Kettenreaktion. Jede Zelle erhält
 * ihren eigenen Zeitpunkt und exakt vier Brocken; dadurch bleibt der Ablauf auf
 * Host und Clients trotz lokalem Snapshot-Zeitpunkt visuell gleich aufgebaut.
 */
export function buildBaseDestructionPlan(spec: BaseSpec): readonly BaseDestructionStep[] {
  const bounds = getWorldBounds(spec);
  const centerX = bounds.x + bounds.width * 0.5;
  const centerY = bounds.y + bounds.height * 0.5;
  const baseSeed = hashString(spec.id);

  const orderedCells = spec.cells
    .map((cell, cellIndex) => {
      const x = ARENA_OFFSET_X + cell.gridX * CELL_SIZE + CELL_SIZE * 0.5;
      const y = ARENA_OFFSET_Y + cell.gridY * CELL_SIZE + CELL_SIZE * 0.5;
      const dx = x - centerX;
      const dy = y - centerY;
      const cellSeed = mixSeed(baseSeed, cell.gridX, cell.gridY);
      return {
        cellIndex,
        x,
        y,
        cellSeed,
        // Kleine deterministische Abweichung löst gleich weit entfernte Zellen auf,
        // ohne die lesbare Ausbreitung vom Zentrum nach außen zu verlieren.
        order: dx * dx + dy * dy + seededUnit(cellSeed, 11) * CELL_SIZE * CELL_SIZE * 0.35,
      };
    })
    .sort((left, right) => left.order - right.order || left.cellIndex - right.cellIndex);

  let delayMs = 0;
  return orderedCells.map((cell, orderIndex) => {
    const step: BaseDestructionStep = {
      cellIndex: cell.cellIndex,
      x: cell.x,
      y: cell.y,
      delayMs,
      chunkTargets: buildChunkTargets(cell.x, cell.y, cell.cellSeed),
    };
    if (orderIndex < orderedCells.length - 1) {
      delayMs += randomIntInclusive(
        cell.cellSeed,
        101 + orderIndex,
        MIN_CELL_STAGGER_MS,
        MAX_CELL_STAGGER_MS,
      );
    }
    return step;
  });
}

/** Ein einmaliger, leichter Impuls um die gesamte Basisfläche; verursacht keinen Schaden. */
export function getBaseDestructionBlast(spec: BaseSpec): BaseDestructionBlast {
  const bounds = getWorldBounds(spec);
  return {
    x: bounds.x + bounds.width * 0.5,
    y: bounds.y + bounds.height * 0.5,
    radius: Math.hypot(bounds.width * 0.5, bounds.height * 0.5) + BLAST_PADDING,
    force: BLAST_FORCE,
    durationMs: BLAST_DURATION_MS,
  };
}

function getWorldBounds(spec: BaseSpec): { x: number; y: number; width: number; height: number } {
  return {
    x: ARENA_OFFSET_X + spec.region.minGridX * CELL_SIZE,
    y: ARENA_OFFSET_Y + spec.region.minGridY * CELL_SIZE,
    width: (spec.region.maxGridX - spec.region.minGridX + 1) * CELL_SIZE,
    height: (spec.region.maxGridY - spec.region.minGridY + 1) * CELL_SIZE,
  };
}

function buildChunkTargets(x: number, y: number, seed: number): FireChunkTarget[] {
  const targets: FireChunkTarget[] = [];
  const phase = seededUnit(seed, 23) * TWO_PI;
  const minX = ARENA_OFFSET_X + 4;
  const minY = ARENA_OFFSET_Y + 4;
  const maxX = ARENA_OFFSET_X + GRID_COLS * CELL_SIZE - 4;
  const maxY = ARENA_OFFSET_Y + GRID_ROWS * CELL_SIZE - 4;

  for (let index = 0; index < CHUNKS_PER_CELL; index += 1) {
    const angleJitter = (seededUnit(seed, 41 + index) - 0.5) * 0.44;
    const angle = phase + index * (TWO_PI / CHUNKS_PER_CELL) + angleJitter;
    const distance = CELL_SIZE * (0.9 + seededUnit(seed, 71 + index) * 0.75);
    targets.push({
      x: clamp(x + Math.cos(angle) * distance, minX, maxX),
      y: clamp(y + Math.sin(angle) * distance, minY, maxY),
    });
  }

  return targets;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomIntInclusive(seed: number, salt: number, min: number, max: number): number {
  return min + Math.floor(seededUnit(seed, salt) * (max - min + 1));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mixSeed(seed: number, x: number, y: number): number {
  let mixed = seed ^ Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663);
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  return mixed >>> 0;
}

function seededUnit(seed: number, salt: number): number {
  let value = seed ^ Math.imul(salt + 1, 0x9e3779b1);
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  value = Math.imul(value, 0x735a2d97);
  value ^= value >>> 15;
  return (value >>> 0) / 0x100000000;
}
