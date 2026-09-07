import { ROCK_HP_MAX } from '../config';
import type { ArenaLayout } from '../types';
import {
  integrityState,
  type WorldIntegrityMutationResult,
  type WorldIntegrityState,
} from '../world/WorldIntegrityMutation';

/**
 * Reiner HP-Zustand eines Felsbestands – ohne Netzwerk, World-/Activity-Lifecycle oder Autorität.
 *
 * Der Gameplay-Bestand ({@link RockRegistry}) erweitert diese Klasse um die Snapshot-Schicht;
 * Ein lokaler oder Headless-Kontext benutzt sie direkt. Es gibt dadurch nur **eine**
 * Fels-HP-Implementierung: `applyDamage`, `getHP`, `getMaxHP`, `setHP`, `isDestroyed`,
 * `remove` und `register` verhalten sich in allen World-Kontexten identisch.
 */
export class RockHpRegistry {
  /** rockIndex → aktueller HP-Wert + max HP */
  protected hpMap = new Map<number, { hp: number; maxHp: number }>();
  /**
   * Authored unzerstörbare Felsen dieses Bestands.
   *
   * Die Regel steht hier und nicht an den Schadensquellen: Projektil, Explosion, Melee und
   * Umgebungsschaden laufen alle über `applyDamage`, und nur so gilt „geschützte Struktur"
   * für jede von ihnen gleich – ohne dass eine neue Quelle sie erneut kennen muss.
   */
  private readonly indestructibleIds = new Set<number>();

  constructor(layout: ArenaLayout) {
    // Bewusst nicht über die überschreibbare `reset()`: Unterklassen-Felder existieren
    // während des Basiskonstruktors noch nicht.
    this.resetHpState(layout);
  }

  /** Initialisiert alle Felsen mit vollem HP. */
  reset(layout: ArenaLayout): void {
    this.resetHpState(layout);
  }

  protected resetHpState(layout: ArenaLayout): void {
    this.hpMap.clear();
    this.indestructibleIds.clear();
    for (let i = 0; i < layout.rocks.length; i++) {
      this.hpMap.set(i, { hp: ROCK_HP_MAX, maxHp: ROCK_HP_MAX });
      if (layout.rocks[i].indestructible === true) this.indestructibleIds.add(i);
    }
  }

  /** True, wenn dieser Fels authored Struktur ist und deshalb keinen Schaden nimmt. */
  isIndestructible(id: number): boolean {
    return this.indestructibleIds.has(id);
  }

  register(id: number, maxHp: number): void {
    this.hpMap.set(id, { hp: maxHp, maxHp });
  }

  /** Gibt den aktuellen HP-Wert für Felsen id zurück. */
  getHP(id: number): number {
    return this.hpMap.get(id)?.hp ?? ROCK_HP_MAX;
  }

  getMaxHP(id: number): number {
    return this.hpMap.get(id)?.maxHp ?? ROCK_HP_MAX;
  }

  /** Missing IDs stay distinguishable from full-health rocks at mutation boundaries. */
  readIntegrity(id: number): WorldIntegrityState | null {
    const current = this.hpMap.get(id);
    return current ? integrityState(current.hp, current.maxHp) : null;
  }

  commitDamage(id: number, damage: number): WorldIntegrityMutationResult {
    const current = this.hpMap.get(id);
    if (!current) return { kind: 'missing' };
    const before = integrityState(current.hp, current.maxHp);
    if (current.hp <= 0) return { kind: 'inert', state: before };
    if (this.indestructibleIds.has(id)) return { kind: 'immune', state: before };
    if (!Number.isFinite(damage) || damage <= 0) {
      return { kind: 'applied', actualAmount: 0, state: before, transition: 'none' };
    }
    const nextHp = Math.max(0, current.hp - damage);
    this.hpMap.set(id, { hp: nextHp, maxHp: current.maxHp });
    return {
      kind: 'applied',
      actualAmount: current.hp - nextHp,
      state: integrityState(nextHp, current.maxHp),
      transition: nextHp <= 0 ? 'destroyed' : 'none',
    };
  }

  commitRepair(id: number, amount: number): WorldIntegrityMutationResult {
    const current = this.hpMap.get(id);
    if (!current) return { kind: 'missing' };
    const before = integrityState(current.hp, current.maxHp);
    if (current.hp <= 0) return { kind: 'inert', state: before };
    if (!Number.isFinite(amount) || amount <= 0) {
      return { kind: 'applied', actualAmount: 0, state: before, transition: 'none' };
    }
    const nextHp = Math.min(current.maxHp, current.hp + amount);
    this.hpMap.set(id, { hp: nextHp, maxHp: current.maxHp });
    return {
      kind: 'applied',
      actualAmount: nextHp - current.hp,
      state: integrityState(nextHp, current.maxHp),
      transition: 'none',
    };
  }

  /**
   * Zieht Schaden vom Felsen ab.
   * Gibt den neuen HP-Wert zurück (mindestens 0).
   */
  applyDamage(id: number, damage: number): number {
    const outcome = this.commitDamage(id, damage);
    return outcome.kind === 'missing' ? 0 : outcome.state.integrity;
  }

  /**
   * Setzt den HP-Wert direkt. Gedacht fuer Reparaturen; zerstoerte Felsen (Tombstone mit
   * HP 0) bleiben unangetastet, weil ihr Visual und ihr Grid-Eintrag bereits entfernt sind.
   *
   * Damit ist auch die Lobby-Regel abgedeckt: ein zerstoerter Fels laesst sich nicht per
   * Reparaturstrahl wiederbeleben, er braucht einen echten Neubau ueber `register`.
   */
  setHP(id: number, hp: number): void {
    const current = this.hpMap.get(id);
    if (!current || current.hp <= 0) return;
    this.hpMap.set(id, { hp: Math.max(0, Math.min(current.maxHp, hp)), maxHp: current.maxHp });
  }

  /** Gibt true zurück wenn der Felsen 0 HP hat. */
  isDestroyed(id: number): boolean {
    const hp = this.hpMap.get(id);
    return hp !== undefined && hp.hp <= 0;
  }

  /**
   * Behält nach der Zerstörung einen HP-0-Tombstone.
   * Gibt `false` zurück, wenn der Felsen gar nicht im Bestand war.
   */
  remove(id: number): boolean {
    const current = this.hpMap.get(id);
    if (!current) return false;
    this.hpMap.set(id, { hp: 0, maxHp: current.maxHp });
    return true;
  }
}
