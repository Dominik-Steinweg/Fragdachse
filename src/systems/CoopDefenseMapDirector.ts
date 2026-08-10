import type {
  ResolvedCoopDefenseMapEncounterConfig,
  ResolvedCoopDefenseMapEncounterGroupConfig,
} from '../config/coopDefenseMaps';
import type { CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';

/** Ausführungsschnitt des Directors zur bestehenden normalen Spawnlogik. */
export type CoopDefenseEncounterSpawnHandler = (
  enemyKind: CoopDefenseEnemyKind,
  count: number,
) => void;

interface EncounterExecutionState {
  started: boolean;
  readonly groupsExecuted: boolean[];
}

/**
 * Host-autoritärer Zeitplan für endliche Map-Encounter.
 *
 * Der Director kennt weder Spawnpositionen noch Phaser. Er verfolgt ausschließlich die aktive
 * Rundenzeit (also erst nach dem Countdown) und reicht fällige Gruppen einmalig an den
 * bestehenden Spawnpfad weiter.
 */
export class CoopDefenseMapDirector {
  private elapsedMs = 0;
  private readonly executionStates: EncounterExecutionState[];

  constructor(
    private readonly encounters: readonly ResolvedCoopDefenseMapEncounterConfig[],
    private readonly spawnGroup: CoopDefenseEncounterSpawnHandler,
  ) {
    this.executionStates = encounters.map((encounter) => ({
      started: false,
      groupsExecuted: encounter.groups.map(() => false),
    }));
  }

  /**
   * Fortschritt der aktiven Map-Zeit. Große Delta-Werte werden bewusst nicht in einzelne Timer
   * zerlegt: alle Gruppen, deren Fälligkeit im neuen Zeitpunkt liegt, werden in diesem Aufruf
   * genau einmal ausgeführt.
   */
  hostUpdate(deltaMs: number, countdownActive: boolean): number {
    if (countdownActive) return 0;

    this.elapsedMs += Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
    let executedGroupCount = 0;

    for (let encounterIndex = 0; encounterIndex < this.encounters.length; encounterIndex += 1) {
      const encounter = this.encounters[encounterIndex];
      const state = this.executionStates[encounterIndex];
      const encounterStartAtMs = Math.max(0, Math.floor(encounter.startAtMs));

      if (!state.started && this.elapsedMs >= encounterStartAtMs) {
        state.started = true;
      }
      if (!state.started) continue;

      for (let groupIndex = 0; groupIndex < encounter.groups.length; groupIndex += 1) {
        if (state.groupsExecuted[groupIndex]) continue;
        const group = encounter.groups[groupIndex];
        const groupStartAtMs = encounterStartAtMs + Math.max(0, Math.floor(group.delayMs));
        if (this.elapsedMs < groupStartAtMs) continue;

        // Vor dem Callback markieren: Auch ein re-entrantes Host-Update oder ein Callback-Fehler
        // kann diese Gruppe nicht versehentlich zu einer periodischen Welle machen.
        state.groupsExecuted[groupIndex] = true;
        this.spawnGroup(group.enemyKind, group.count);
        executedGroupCount += 1;
      }
    }

    return executedGroupCount;
  }

  reset(): void {
    this.elapsedMs = 0;
    for (const state of this.executionStates) {
      state.started = false;
      state.groupsExecuted.fill(false);
    }
  }

  getElapsedMs(): number {
    return this.elapsedMs;
  }

  hasStartedEncounter(encounterId: string): boolean {
    const index = this.encounters.findIndex((encounter) => encounter.id === encounterId);
    return index >= 0 ? this.executionStates[index].started : false;
  }

  isEncounterComplete(encounterId: string): boolean {
    const index = this.encounters.findIndex((encounter) => encounter.id === encounterId);
    if (index < 0) return false;
    const state = this.executionStates[index];
    return state.started && state.groupsExecuted.every(Boolean);
  }
}

export type CoopDefenseMapDirectorGroup = ResolvedCoopDefenseMapEncounterGroupConfig;
