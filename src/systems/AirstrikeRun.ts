import { CELL_SIZE } from '../config';
import type {
  CoopDefenseMapAirstrikeArea,
  CoopDefenseMapAirstrikeRun,
  ResolvedCoopDefenseMapEventConfig,
} from '../config/coopDefenseMaps';
import type { WorldMetrics } from '../world/WorldMetrics';

/** Bombs leave the formation this long before impact; the lead shadow passes a target just before it hits. */
export const AIRSTRIKE_RUN_FALL_MS = 400;
/** Same inset as a scattered zone barrage, so a run never bombs the zone edge. */
const ZONE_INSET = 0.08;

/** One straight bomber run across a zone: the chord carries every bomb, the formation flies along +dir. */
export interface AirstrikeRunGeometry {
  readonly startX: number;
  readonly startY: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly lengthPx: number;
  readonly speedPxPerSec: number;
}

/** A run whose launch time every peer knows from the Activity definition (time trigger). */
export interface ScheduledAirstrikeRun {
  readonly eventId: string;
  readonly launchAtMs: number;
  readonly strikeCount: number;
  readonly geometry: AirstrikeRunGeometry;
}

export function resolveAirstrikeRunGeometry(
  area: CoopDefenseMapAirstrikeArea,
  run: CoopDefenseMapAirstrikeRun,
  metrics: Pick<WorldMetrics, 'offsetX' | 'offsetY'>,
): AirstrikeRunGeometry {
  const left = metrics.offsetX + (area.gridX + ZONE_INSET * area.widthCells) * CELL_SIZE;
  const right = metrics.offsetX + (area.gridX + (1 - ZONE_INSET) * area.widthCells) * CELL_SIZE;
  const top = metrics.offsetY + (area.gridY + ZONE_INSET * area.heightCells) * CELL_SIZE;
  const bottom = metrics.offsetY + (area.gridY + (1 - ZONE_INSET) * area.heightCells) * CELL_SIZE;
  const angle = run.headingDeg * Math.PI / 180;
  const dirX = Math.cos(angle), dirY = Math.sin(angle);
  const normalX = -dirY, normalY = dirX;
  const halfWidth = (right - left) / 2, halfHeight = (bottom - top) / 2;
  // Support of the zone across the heading: |offsetRatio| < 1 always crosses the zone.
  const lateral = run.offsetRatio * (halfWidth * Math.abs(normalX) + halfHeight * Math.abs(normalY));
  const pointX = (left + right) / 2 + normalX * lateral, pointY = (top + bottom) / 2 + normalY * lateral;
  let enter = -Infinity, exit = Infinity;
  for (const [origin, direction, min, max] of [[pointX, dirX, left, right], [pointY, dirY, top, bottom]] as const) {
    if (Math.abs(direction) < 1e-9) continue;
    const a = (min - origin) / direction, b = (max - origin) / direction;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  return {
    startX: pointX + dirX * enter, startY: pointY + dirY * enter, dirX, dirY,
    lengthPx: Math.max(0, exit - enter), speedPxPerSec: run.speedPxPerSec,
  };
}

/** Along-chord distance of strike `index`; one strike sits in the middle of the chord. */
function strikeAlongPx(geometry: AirstrikeRunGeometry, strikeCount: number, index: number): number {
  return geometry.lengthPx * (strikeCount > 1 ? index / (strikeCount - 1) : 0.5);
}

/** Host plan: bombs on the chord, launched as the formation reaches them, so each hits as it passes. */
export function planAirstrikeRun(
  geometry: AirstrikeRunGeometry,
  strikeCount: number,
): { x: number; y: number; launchOffsetMs: number }[] {
  const first = strikeAlongPx(geometry, strikeCount, 0);
  return Array.from({ length: strikeCount }, (_, index) => {
    const along = strikeAlongPx(geometry, strikeCount, index);
    return {
      x: geometry.startX + geometry.dirX * along,
      y: geometry.startY + geometry.dirY * along,
      launchOffsetMs: Math.round((along - first) / geometry.speedPxPerSec * 1000),
    };
  });
}

/**
 * Along-chord position (px from the chord start) of the formation lead at round time `nowMs`.
 * It crosses strike `i` at `launchAtMs + launchOffset_i + strikeDelayMs - AIRSTRIKE_RUN_FALL_MS`.
 */
export function resolveAirstrikeRunLeadPx(run: ScheduledAirstrikeRun, strikeDelayMs: number, nowMs: number): number {
  const passFirstAtMs = run.launchAtMs + strikeDelayMs - AIRSTRIKE_RUN_FALL_MS;
  return strikeAlongPx(run.geometry, run.strikeCount, 0) + (nowMs - passFirstAtMs) * run.geometry.speedPxPerSec / 1000;
}

/** Runs with a time trigger; other triggers have no launch time a peer could know in advance. */
export function resolveScheduledAirstrikeRuns(
  events: readonly ResolvedCoopDefenseMapEventConfig[] | undefined,
  metrics: Pick<WorldMetrics, 'offsetX' | 'offsetY'>,
): ScheduledAirstrikeRun[] {
  const runs: ScheduledAirstrikeRun[] = [];
  for (const event of events ?? []) {
    if (event.type !== 'airstrike' || event.pattern !== 'zone-barrage' || !event.run || !event.area
      || event.start.type !== 'time') continue;
    runs.push({ eventId: event.id, launchAtMs: event.start.atMs + (event.delayMs ?? 0),
      strikeCount: event.strikeCount ?? 1, geometry: resolveAirstrikeRunGeometry(event.area, event.run, metrics) });
  }
  return runs;
}
