import authored from '../config/shootingRange.json';
import { CELL_SIZE } from '../config';
import type { WorldMetrics } from '../world/WorldMetrics';
import { worldCellCenter } from '../world/WorldMetrics';
import type { ShootingRangeControl } from './ShootingRangeContracts';

export const SHOOTING_RANGE = authored;
export const SHOOTING_RANGE_CONTROLS: readonly ShootingRangeControl[] = ['power', 'minus', 'plus', 'supply'];
export interface ShootingRangeRect { minX: number; maxX: number; minY: number; maxY: number }
export function insideRangeRect(x: number, y: number, rect: ShootingRangeRect): boolean {
  return x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY;
}
export function isShootingRangeBuildReserved(x: number, y: number): boolean {
  return insideRangeRect(x, y, authored.board) || authored.access.some(rect => insideRangeRect(x, y, rect))
    || authored.targets.some(([tx, ty]) => x === tx && y === ty);
}
export function shootingRangeControlPosition(metrics: WorldMetrics, control: ShootingRangeControl): { x: number; y: number } {
  const [x, y] = authored.controls[control];
  return worldCellCenter(metrics, x, y);
}
export function isInsideShootingRange(metrics: WorldMetrics, x: number, y: number): boolean {
  const min = worldCellCenter(metrics, authored.supplyArea.minX, authored.supplyArea.minY);
  const max = worldCellCenter(metrics, authored.supplyArea.maxX, authored.supplyArea.maxY);
  return x >= min.x - CELL_SIZE / 2 && x < max.x + CELL_SIZE / 2
    && y >= min.y - CELL_SIZE / 2 && y < max.y + CELL_SIZE / 2;
}
