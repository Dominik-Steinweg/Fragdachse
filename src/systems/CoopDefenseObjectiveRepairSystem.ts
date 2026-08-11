import { COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG } from '../config/coopDefenseObjectiveRepair';

export interface CoopDefenseObjectiveRepairDeps {
  /** Host-autoritatives Heilen einer lebenden Basis (BaseManager.heal). */
  readonly healBase: (baseId: string, amount: number) => void;
  readonly getBaseHp: (baseId: string) => number | null;
  readonly getBaseMaxHp: (baseId: string) => number | null;
}

interface ObjectiveRepairRuntime {
  elapsedMs: number;
  /** Aus dem Zustand beim Start abgeleitet, damit die Heilung genau mit `repairMs` endet. */
  readonly hpPerMs: number;
}

/**
 * Missionsgebundene Wiederherstellung eines gehaltenen Ziels.
 *
 * Host-only und bewusst winzig: Das Objective-System fordert den Reward an, dieses System führt ihn
 * über die vorhandene Basisheilung aus. Die geheilten HP fließen über den normalen Basis-Delta-
 * Snapshot zu den Clients; einen eigenen Netzwerkpfad gibt es nicht. Die Zeitachse teilt es sich mit
 * der Drohnen-Darstellung, damit HP-Balken und Reparaturstrahl zusammenpassen.
 */
export class CoopDefenseObjectiveRepairSystem {
  private readonly repairs = new Map<string, ObjectiveRepairRuntime>();

  constructor(private readonly deps: CoopDefenseObjectiveRepairDeps) {}

  /** Idempotent: Eine bereits laufende Reparatur wird nicht neu gestartet oder beschleunigt. */
  start(baseId: string): void {
    if (this.repairs.has(baseId)) return;
    const hp = this.deps.getBaseHp(baseId);
    const maxHp = this.deps.getBaseMaxHp(baseId);
    if (hp === null || maxHp === null || hp <= 0 || hp >= maxHp) return;
    this.repairs.set(baseId, {
      elapsedMs: 0,
      hpPerMs: (maxHp - hp) / COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG.repairMs,
    });
  }

  /** Countdown-Zeit gehört wie beim MapDirector nicht zur authored Rundenzeit. */
  hostUpdate(deltaMs: number, countdownActive: boolean): void {
    if (countdownActive || this.repairs.size === 0) return;
    const delta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
    const { approachMs, repairMs } = COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG;

    for (const [baseId, repair] of [...this.repairs]) {
      const hp = this.deps.getBaseHp(baseId);
      const maxHp = this.deps.getBaseMaxHp(baseId);
      // Ziel während der Reparatur verloren: Die Drohnen brechen ab, es bleibt kein halber Heilstrom.
      if (hp === null || maxHp === null || hp <= 0) {
        this.repairs.delete(baseId);
        continue;
      }

      const previousMs = repair.elapsedMs;
      repair.elapsedMs += delta;
      // Vor dem Ende des Anflugs passiert nichts; danach zählt nur der Anteil innerhalb `repairMs`.
      const healedFromMs = Math.max(previousMs, approachMs);
      const healedToMs = Math.min(repair.elapsedMs, approachMs + repairMs);
      if (healedToMs > healedFromMs) {
        this.deps.healBase(baseId, repair.hpPerMs * (healedToMs - healedFromMs));
      }
      if (repair.elapsedMs >= approachMs + repairMs) this.repairs.delete(baseId);
    }
  }

  isRepairing(baseId: string): boolean {
    return this.repairs.has(baseId);
  }

  reset(): void {
    this.repairs.clear();
  }
}
