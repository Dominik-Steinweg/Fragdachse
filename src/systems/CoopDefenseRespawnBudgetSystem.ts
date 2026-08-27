import type { CoopDefenseRespawnBudgetPlayerState, CoopDefenseRespawnBudgetState } from '../types';

export interface CoopDefenseRespawnBudgetSystemOptions {
  readonly respawnsPerPlayer: number;
  readonly participantIds: readonly string[];
}

/**
 * Host-only Lebensverwaltung fuer jede Map, die ein Respawn-Budget authoriert (`survive`,
 * `advance`). Das Ziel der Map entscheidet nur, was aus dem Team-Wipe folgt - nicht, wie das
 * Budget gefuehrt wird.
 *
 * `remainingRespawns === 0` beschreibt dabei weiterhin ein aktives letztes Leben. Erst ein
 * danach eintretender Tod setzt `eliminated` auf true. Der Respawn-Gate bleibt rein lesend;
 * der Verbrauch passiert ausschliesslich in `consumeRespawn`, also beim tatsaechlich ausgefuehrten
 * Respawn.
 */
export class CoopDefenseRespawnBudgetSystem {
  private readonly respawnsPerPlayer: number;
  private readonly players = new Map<string, CoopDefenseRespawnBudgetPlayerState>();

  constructor(options: CoopDefenseRespawnBudgetSystemOptions) {
    this.respawnsPerPlayer = normalizeRespawnCount(options.respawnsPerPlayer);
    for (const playerId of new Set(options.participantIds)) {
      if (typeof playerId !== 'string' || playerId.length === 0) continue;
      this.players.set(playerId, {
        remainingRespawns: this.respawnsPerPlayer,
        // Die Runde startet mit einem Initialspawn; dieser Zustand verbraucht kein Budget.
        alive: true,
        eliminated: false,
      });
    }
  }

  getSnapshot(): CoopDefenseRespawnBudgetState {
    const players: Record<string, CoopDefenseRespawnBudgetPlayerState> = {};
    for (const [playerId, state] of this.players) players[playerId] = { ...state };
    return {
      respawnsPerPlayer: this.respawnsPerPlayer,
      players,
    };
  }

  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId);
  }

  getPlayerState(playerId: string): CoopDefenseRespawnBudgetPlayerState | null {
    const state = this.players.get(playerId);
    return state ? { ...state } : null;
  }

  isPlayerAlive(playerId: string): boolean {
    return this.players.get(playerId)?.alive === true;
  }

  isPlayerEliminated(playerId: string): boolean {
    return this.players.get(playerId)?.eliminated === true;
  }

  /** Initialspawn oder Reconnect eines noch lebenden Spielers; verbraucht kein Budget. */
  registerInitialSpawn(playerId: string): boolean {
    const state = this.players.get(playerId);
    if (!state || state.eliminated || !state.alive) return false;
    state.alive = true;
    return true;
  }

  /** Wird genau einmal beim echten Tod des Spielers aufgerufen. */
  handlePlayerDeath(playerId: string): boolean {
    const state = this.players.get(playerId);
    if (!state || !state.alive) return false;
    state.alive = false;
    if (state.remainingRespawns === 0) state.eliminated = true;
    return true;
  }

  /** Reiner Gate-Check: darf keinen Zustand veraendern. */
  canPlayerRespawn(playerId: string): boolean {
    const state = this.players.get(playerId);
    return state !== undefined
      && !state.eliminated
      && !state.alive
      && state.remainingRespawns > 0;
  }

  /** Verbraucht genau ein Budget, wenn ein echter Respawn ausgefuehrt wird. */
  consumeRespawn(playerId: string): boolean {
    if (!this.canPlayerRespawn(playerId)) return false;
    const state = this.players.get(playerId)!;
    state.remainingRespawns -= 1;
    state.alive = true;
    return true;
  }

  /**
   * Connected-/Participation-Listen bleiben die Quelle fuer die Relevanz. Damit kann ein
   * dauerhaft verlassener Teilnehmer mit Restbudget den Team-Wipe nicht blockieren; freiwillige
   * Spectatoren werden ebenfalls explizit ausgeschlossen.
   */
  isTeamWiped(connectedPlayerIds: readonly string[], spectatorIds: readonly string[] = []): boolean {
    const connected = new Set(connectedPlayerIds);
    const spectators = new Set(spectatorIds);
    const relevant = [...this.players.entries()]
      .filter(([playerId]) => connected.has(playerId) && !spectators.has(playerId));

    return relevant.every(([, state]) => (
      !state.alive
      && (state.eliminated || state.remainingRespawns <= 0)
    ));
  }
}

function normalizeRespawnCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`[CoopDefenseRespawnBudgetSystem] Invalid respawn count: ${value}`);
  }
  return Math.floor(value);
}
