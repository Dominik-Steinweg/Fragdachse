import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
} from '../config';
import type {
  CoopDefenseMapConfig,
  CoopDefenseMapGroundHazardEventConfig,
  ResolvedCoopDefenseMapEventConfig,
} from '../config/coopDefenseMaps';
import type {
  ArenaLayout,
  ArenaGroundHazardZone,
  SyncedBurningGroundCell,
  SyncedBurningGroundSnapshot,
} from '../types';

const PREVIEW_CELL_ID_BASE = 1_000_000_000;
// FireSystem's persistent ground-fire grid is one half of the authored 32px arena cell.
// Keep this helper Phaser-free so the deterministic preview can be unit-tested in Node.
const GROUND_FIRE_CELL_SIZE = CELL_SIZE / 2;

/**
 * Builds the visual-only fire state that is shown during the synchronized 3-2-1 countdown.
 *
 * The layout still owns only the generated geometry and the map event remains the source of
 * truth for its visual family. No FireSystem source is created here, so this preview cannot deal
 * damage, apply burns, or change the event director's lifecycle.
 */
export function buildCountdownGroundFirePreview(
  layout: ArenaLayout | null,
  mapConfig: CoopDefenseMapConfig | null,
  previewExpiresAt = Number.MAX_SAFE_INTEGER,
): SyncedBurningGroundSnapshot {
  if (!layout || !mapConfig?.mapEvents || mapConfig.mapEvents.length === 0) {
    return { cells: [] };
  }

  const zonesByEventId = new Map<string, ArenaGroundHazardZone[]>();
  for (const zone of layout.groundHazardZones ?? []) {
    const zones = zonesByEventId.get(zone.eventId) ?? [];
    zones.push(zone);
    zonesByEventId.set(zone.eventId, zones);
  }

  const cellsByKey = new Map<string, SyncedBurningGroundCell>();
  for (const event of mapConfig.mapEvents) {
    if (!isCountdownGroundHazard(event)) continue;
    for (const zone of zonesByEventId.get(event.id) ?? []) {
      for (const cell of zone.cells) {
        const cellLeft = ARENA_OFFSET_X + cell.gridX * CELL_SIZE;
        const cellTop = ARENA_OFFSET_Y + cell.gridY * CELL_SIZE;
        for (let subY = 0; subY < CELL_SIZE; subY += GROUND_FIRE_CELL_SIZE) {
          for (let subX = 0; subX < CELL_SIZE; subX += GROUND_FIRE_CELL_SIZE) {
            const gridX = Math.floor(
              (cellLeft + subX + GROUND_FIRE_CELL_SIZE * 0.5) / GROUND_FIRE_CELL_SIZE,
            );
            const gridY = Math.floor(
              (cellTop + subY + GROUND_FIRE_CELL_SIZE * 0.5) / GROUND_FIRE_CELL_SIZE,
            );
            const key = `${gridX}:${gridY}`;
            if (cellsByKey.has(key)) continue;
            cellsByKey.set(key, {
              id: previewCellId(gridX, gridY),
              gridX,
              gridY,
              // The preview is replaced by the authoritative FireSystem snapshot on "Go".
              expiresAt: previewExpiresAt,
              intensity: 1,
              visualStyle: 'void',
            });
          }
        }
      }
    }
  }

  const cells = [...cellsByKey.values()];
  cells.sort((left, right) => left.gridY - right.gridY || left.gridX - right.gridX);
  return { cells };
}

function isCountdownGroundHazard(
  event: ResolvedCoopDefenseMapEventConfig,
): event is CoopDefenseMapGroundHazardEventConfig {
  return event.type === 'ground-hazard'
    && event.effect.visualStyle === 'void'
    && event.start.type === 'time'
    && event.start.atMs <= 0
    && (event.delayMs ?? 0) <= 0;
}

function previewCellId(gridX: number, gridY: number): number {
  return PREVIEW_CELL_ID_BASE + (gridY + 512) * 2048 + (gridX + 512);
}
