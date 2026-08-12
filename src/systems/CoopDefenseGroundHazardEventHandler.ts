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

/**
 * Abstand zwischen zwei Nachzuendeversuchen fuer Zellen, die beim Aktivieren von einem Bauwerk
 * belegt waren. Bewusst grob: Ein Bauwerk faellt selten, und der Versuch kostet je Zelle nur
 * einen Rasterzugriff.
 */
const BLOCKED_CELL_RETRY_INTERVAL_MS = 500;

interface PendingHazardCell {
  readonly centerX: number;
  readonly centerY: number;
}

interface ScheduledGroundHazardOccurrence {
  readonly event: CoopDefenseMapGroundHazardEventConfig;
  readonly occurrence: number;
  readonly actionAtMs: number;
  readonly sourceKey: string;
  activatedAtRoundMs: number | null;
  /** Beim Aktivieren blockierte Zellen; sie zuenden nach, sobald der Platz wieder frei ist. */
  pendingCells: PendingHazardCell[];
  nextRetryAtRoundMs: number;
}

export interface CoopDefenseGroundHazardEventHandlerDeps {
  readonly fireSystem: Pick<FireSystem, 'hostRefreshGroundCell' | 'hostRemoveGroundSourcesBySourceKey'>;
  readonly prebuiltZones: readonly ArenaGroundHazardZone[];
  /** Nur fuer die eigene, relative Brenndauer des FireSystems -- nie fuer Trigger oder Lifecycle. */
  readonly getNowMs: () => number;
}

/**
 * Fachadapter fuer authored Ground Hazards. Geometrie und Trigger bleiben ausserhalb: Der
 * Handler aktiviert nur die beim Arena-Aufbau aufgeloesten 32px-Zellen im bestehenden 16px-
 * FireSystem und meldet dessen fachliche Dauer als generische Event-Completion zurueck.
 *
 * Zellen, auf denen beim Aktivieren ein Bauwerk steht, bleiben vorgemerkt und zuenden nach,
 * sobald der Platz frei wird. So entsteht kein dauerhaftes Loch in der Gefahrenflaeche, und ein
 * vor der Ankuendigung errichtetes Bauwerk haelt die Flammen genau so lange zurueck, wie es steht.
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
      activatedAtRoundMs: null,
      pendingCells: [],
      nextRetryAtRoundMs: 0,
    });
    this.ownedSourceKeys.add(sourceKey);
    return true;
  }

  hostUpdate(_deltaMs: number, countdownActive: boolean, roundTimeMs: number): void {
    if (countdownActive) return;
    for (const occurrence of [...this.occurrences.values()]) {
      if (occurrence.activatedAtRoundMs === null) {
        if (roundTimeMs < occurrence.actionAtMs) continue;
        this.activate(occurrence, roundTimeMs);
      }

      const activatedAtRoundMs = occurrence.activatedAtRoundMs;
      if (activatedAtRoundMs === null) continue;

      if (occurrence.pendingCells.length > 0 && roundTimeMs >= occurrence.nextRetryAtRoundMs) {
        occurrence.nextRetryAtRoundMs = roundTimeMs + BLOCKED_CELL_RETRY_INTERVAL_MS;
        occurrence.pendingCells = occurrence.pendingCells.filter(
          (cell) => !this.igniteCell(occurrence, cell, activatedAtRoundMs, roundTimeMs),
        );
      }

      if (occurrence.event.durationMs === undefined) continue;
      if (roundTimeMs < activatedAtRoundMs + occurrence.event.durationMs) continue;

      this.deps.fireSystem.hostRemoveGroundSourcesBySourceKey(occurrence.sourceKey);
      this.occurrences.delete(getOccurrenceKey(occurrence.event.id, occurrence.occurrence));
      this.onCycleFinished?.({
        eventId: occurrence.event.id,
        occurrence: occurrence.occurrence,
        completedAtMs: Math.max(0, Math.floor(roundTimeMs)),
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

  private activate(occurrence: ScheduledGroundHazardOccurrence, roundTimeMs: number): void {
    const zones = this.getZonesForEvent(occurrence.event.id);
    if (zones.length === 0) return;

    occurrence.activatedAtRoundMs = roundTimeMs;
    occurrence.nextRetryAtRoundMs = roundTimeMs + BLOCKED_CELL_RETRY_INTERVAL_MS;
    for (const zone of zones) {
      for (const cell of zone.cells) {
        const cellLeft = ARENA_OFFSET_X + cell.gridX * CELL_SIZE;
        const cellTop = ARENA_OFFSET_Y + cell.gridY * CELL_SIZE;
        for (let subY = 0; subY < CELL_SIZE; subY += GROUND_FIRE_CELL_SIZE) {
          for (let subX = 0; subX < CELL_SIZE; subX += GROUND_FIRE_CELL_SIZE) {
            const pending: PendingHazardCell = {
              centerX: cellLeft + subX + GROUND_FIRE_CELL_SIZE * 0.5,
              centerY: cellTop + subY + GROUND_FIRE_CELL_SIZE * 0.5,
            };
            if (!this.igniteCell(occurrence, pending, roundTimeMs, roundTimeMs)) {
              occurrence.pendingCells.push(pending);
            }
          }
        }
      }
    }
  }

  /**
   * Zuendet genau eine Rasterzelle. Eine endliche Gefahrenflaeche gibt dabei nur ihre
   * Restlaufzeit weiter, damit eine spaet nachgezuendete Zelle das Event nicht ueberlebt.
   */
  private igniteCell(
    occurrence: ScheduledGroundHazardOccurrence,
    cell: PendingHazardCell,
    activatedAtRoundMs: number,
    roundTimeMs: number,
  ): boolean {
    const event = occurrence.event;
    const permanent = event.durationMs === undefined;
    const remainingMs = permanent
      ? 1
      : activatedAtRoundMs + event.durationMs - roundTimeMs;
    if (remainingMs <= 0) return true;

    return this.deps.fireSystem.hostRefreshGroundCell(
      cell.centerX,
      cell.centerY,
      {
        sourceKey: occurrence.sourceKey,
        ownerId: `map-hazard:${event.id}`,
        durationMs: remainingMs,
        permanent,
        damagePerTick: 0,
        burn: {
          durationMs: event.effect.burnDurationMs,
          damagePerTick: event.effect.burnDamagePerTick,
        },
        weaponName: event.effect.weaponName,
        visualStyle: event.effect.visualStyle,
        damageTarget: 'players',
      },
      this.deps.getNowMs(),
    );
  }

  private getZonesForEvent(eventId: string): readonly ArenaGroundHazardZone[] {
    return this.deps.prebuiltZones.filter((zone) => zone.eventId === eventId);
  }
}

function getOccurrenceKey(eventId: string, occurrence: number): string {
  return `${eventId}:${occurrence}`;
}
