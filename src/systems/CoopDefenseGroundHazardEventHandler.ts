import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
} from '../config';
import type {
  ResolvedCoopDefenseMapEventConfig,
  CoopDefenseMapGroundHazardEventConfig,
} from '../config/coopDefenseMaps';
import type { ArenaGroundHazardZone } from '../types';
import {
  GROUND_FIRE_CELL_SIZE,
  type FireSystem,
} from '../effects/FireSystem';
import type {
  CoopDefenseMapEventCycleFinished,
  CoopDefenseMapEventHandler,
} from './CoopDefenseMapEventDirector';

interface ScheduledGroundHazardOccurrence {
  readonly event: CoopDefenseMapGroundHazardEventConfig;
  readonly occurrence: number;
  readonly actionAtMs: number;
  readonly sourceKey: string;
  activatedAtMs: number | null;
}

export interface CoopDefenseGroundHazardEventHandlerDeps {
  readonly fireSystem: Pick<FireSystem, 'hostRefreshGroundCell' | 'hostRemoveGroundSourcesBySourceKey'>;
  readonly prebuiltZones: readonly ArenaGroundHazardZone[];
  readonly getNowMs: () => number;
  readonly getActiveRoundTimeMs: () => number;
}

/**
 * Fachadapter fuer authored Ground Hazards. Geometrie und Trigger bleiben ausserhalb: Der
 * Handler aktiviert nur die beim Arena-Aufbau aufgeloesten 32px-Zellen im bestehenden 16px-
 * FireSystem und meldet dessen fachliche Dauer als generische Event-Completion zurueck.
 */
export class CoopDefenseGroundHazardEventHandler implements CoopDefenseMapEventHandler {
  readonly type = 'ground-hazard' as const;

  private readonly occurrences = new Map<string, ScheduledGroundHazardOccurrence>();
  private readonly ownedSourceKeys = new Set<string>();
  private onCycleFinished: ((completion: CoopDefenseMapEventCycleFinished) => void) | null = null;

  constructor(private readonly deps: CoopDefenseGroundHazardEventHandlerDeps) {}

  schedule(event: ResolvedCoopDefenseMapEventConfig, occurrence: number, actionAtMs: number): boolean {
    if (event.type !== 'ground-hazard') return false;
    const zones = this.getZonesForEvent(event.id);
    // Fail-closed: Ein Event ohne konkret vorbereitete Zellen bleibt dormant und wird nicht als
    // scheinbar gestartetes No-op an den Director gemeldet.
    if (zones.length === 0 || zones.every((zone) => zone.cells.length === 0)) return false;

    const key = getOccurrenceKey(event.id, occurrence);
    if (this.occurrences.has(key)) return true;
    const sourceKey = `map-event:${event.id}:${occurrence}`;
    this.occurrences.set(key, {
      event,
      occurrence,
      actionAtMs: Math.max(0, Math.floor(actionAtMs)),
      sourceKey,
      activatedAtMs: null,
    });
    this.ownedSourceKeys.add(sourceKey);
    return true;
  }

  hostUpdate(_deltaMs: number, countdownActive: boolean): void {
    if (countdownActive) return;
    const now = this.deps.getNowMs();
    const roundNow = this.deps.getActiveRoundTimeMs();
    for (const occurrence of [...this.occurrences.values()]) {
      if (occurrence.activatedAtMs === null) {
        if (roundNow < occurrence.actionAtMs) continue;
        this.activate(occurrence, now);
      }

      if (occurrence.event.durationMs === undefined || occurrence.activatedAtMs === null) continue;
      if (now < occurrence.activatedAtMs + occurrence.event.durationMs) continue;

      this.deps.fireSystem.hostRemoveGroundSourcesBySourceKey(occurrence.sourceKey);
      this.occurrences.delete(getOccurrenceKey(occurrence.event.id, occurrence.occurrence));
      this.onCycleFinished?.({
        eventId: occurrence.event.id,
        occurrence: occurrence.occurrence,
        completedAtMs: Math.max(0, Math.floor(roundNow)),
      });
    }
  }

  reset(): void {
    for (const sourceKey of this.ownedSourceKeys) {
      this.deps.fireSystem.hostRemoveGroundSourcesBySourceKey(sourceKey);
    }
    this.ownedSourceKeys.clear();
    this.occurrences.clear();
  }

  setCycleFinishedCallback(
    callback: ((completion: CoopDefenseMapEventCycleFinished) => void) | null,
  ): void {
    this.onCycleFinished = callback;
  }

  private activate(occurrence: ScheduledGroundHazardOccurrence, now: number): void {
    const zones = this.getZonesForEvent(occurrence.event.id);
    if (zones.length === 0) return;

    for (const zone of zones) {
      for (const cell of zone.cells) {
        const cellLeft = ARENA_OFFSET_X + cell.gridX * CELL_SIZE;
        const cellTop = ARENA_OFFSET_Y + cell.gridY * CELL_SIZE;
        for (let subY = 0; subY < CELL_SIZE; subY += GROUND_FIRE_CELL_SIZE) {
          for (let subX = 0; subX < CELL_SIZE; subX += GROUND_FIRE_CELL_SIZE) {
            this.deps.fireSystem.hostRefreshGroundCell(
              cellLeft + subX + GROUND_FIRE_CELL_SIZE * 0.5,
              cellTop + subY + GROUND_FIRE_CELL_SIZE * 0.5,
              {
                sourceKey: occurrence.sourceKey,
                ownerId: `map-hazard:${occurrence.event.id}`,
                durationMs: occurrence.event.durationMs ?? 1,
                permanent: occurrence.event.durationMs === undefined,
                damagePerTick: 0,
                burn: {
                  durationMs: occurrence.event.effect.burnDurationMs,
                  damagePerTick: occurrence.event.effect.burnDamagePerTick,
                },
                weaponName: occurrence.event.effect.weaponName,
                visualStyle: occurrence.event.effect.visualStyle,
                damageTarget: 'players',
              },
              now,
            );
          }
        }
      }
    }
    occurrence.activatedAtMs = now;
  }

  private getZonesForEvent(eventId: string): readonly ArenaGroundHazardZone[] {
    return this.deps.prebuiltZones.filter((zone) => zone.eventId === eventId);
  }
}

function getOccurrenceKey(eventId: string, occurrence: number): string {
  return `${eventId}:${occurrence}`;
}
