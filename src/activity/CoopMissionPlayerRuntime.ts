import type { CoopDefenseRespawnBudgetSystem } from '../systems/CoopDefenseRespawnBudgetSystem';
import type { CoopDefenseRespawnBudgetState } from '../types';

export interface CoopMissionPlayerRuntimeOptions {
  /**
   * Authored Lebensbudget dieser Mission; `null`, wenn die Karte keines fuehrt.
   *
   * Es gehoert der Mission und nicht der World: Eine neue Activity in derselben World beginnt mit
   * einem neuen Budget, und mit dem Ende der Mission ist es vollstaendig weg.
   */
  readonly respawnBudget: CoopDefenseRespawnBudgetSystem | null;
  /** Der Spieler steht der Mission nicht mehr zur Verfuegung: Ziele, Traglasten, Reservierungen. */
  readonly releaseMissionObjectives: (playerId: string) => void;
  /** Repliziert den Budgetstand. Nur der Host publiziert; der Aufrufer kennt die Regel. */
  readonly publishRespawnBudget: (state: CoopDefenseRespawnBudgetState | null) => void;
}

/**
 * Activity-spezifischer Spielerzustand genau einer Coop-Mission.
 *
 * Sie ist bewusst konkret und klein: Was hier liegt, soll einen Activity-Wechsel in derselben
 * World **nicht** ueberleben – Lebensbudget, Missionsziele und die Zugehoerigkeit zu dieser
 * Mission. Figur, Kampfzustand und Loadout bleiben dagegen bei der `PlayerWorldRuntime`.
 *
 * Der Owner fuehrt sein eigenes Materialisierungs-Ledger: Der Detach loest genau die Spieler,
 * die diese Mission tatsaechlich aufgenommen hat.
 */
export class CoopMissionPlayerRuntime {
  private readonly attachedPlayers = new Set<string>();
  private destroyed = false;

  constructor(private readonly options: CoopMissionPlayerRuntimeOptions) {}

  /** True, wenn diese Mission ein authored Lebensbudget fuehrt. */
  get hasRespawnBudget(): boolean {
    return this.options.respawnBudget !== null;
  }

  isAttached(playerId: string): boolean {
    return this.attachedPlayers.has(playerId);
  }

  attachedPlayerIds(): readonly string[] {
    return [...this.attachedPlayers];
  }

  /**
   * Nimmt einen Spieler in diese Mission auf.
   *
   * `reconnectAfterDeath` unterscheidet den Wiedereintritt in dieselbe Runde vom Erstspawn: Nur
   * der Erstspawn eroeffnet ein Lebensbudget.
   */
  attach(playerId: string, reconnectAfterDeath = false): void {
    if (this.destroyed || this.attachedPlayers.has(playerId)) return;
    this.attachedPlayers.add(playerId);
    if (!reconnectAfterDeath) this.options.respawnBudget?.registerInitialSpawn(playerId);
  }

  /** Loest genau einen Spieler aus dieser Mission. Wiederholtes Leave ist ein No-op. */
  detach(playerId: string): void {
    if (!this.attachedPlayers.delete(playerId)) return;
    this.options.releaseMissionObjectives(playerId);
  }

  detachAll(): void {
    for (const playerId of this.attachedPlayerIds()) this.detach(playerId);
  }

  /** Repliziert den aktuellen Budgetstand dieser Mission; ohne Budget den leeren Stand. */
  publishRespawnBudget(): void {
    this.options.publishRespawnBudget(this.options.respawnBudget?.getSnapshot() ?? null);
  }

  /** Der Tod eines Spielers verbraucht kein Budget, beendet aber sein laufendes Leben. */
  handlePlayerDeath(playerId: string): void {
    const budget = this.options.respawnBudget;
    if (!budget) return;
    budget.handlePlayerDeath(playerId);
    this.options.publishRespawnBudget(budget.getSnapshot());
  }

  /** Der tatsaechlich ausgefuehrte Respawn; ohne Budget ist er immer erlaubt. */
  consumeRespawn(playerId: string): boolean {
    const budget = this.options.respawnBudget;
    if (!budget) return true;
    const consumed = budget.consumeRespawn(playerId);
    if (consumed) this.options.publishRespawnBudget(budget.getSnapshot());
    return consumed;
  }

  /** Endgueltiger Team-Wipe dieser Mission; ohne Budget gibt es ihn nicht. */
  isTeamWiped(connectedPlayerIds: readonly string[], spectatorIds: readonly string[]): boolean {
    return this.options.respawnBudget?.isTeamWiped(connectedPlayerIds, spectatorIds) ?? false;
  }

  /**
   * Beendet den Missionsanteil aller Spieler. Idempotent; die Spieler selbst bleiben in ihrer
   * World stehen, ihr Missionszustand nicht.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.detachAll();
    this.destroyed = true;
  }
}
