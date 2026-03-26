import { ROCK_HP_MAX } from '../config';
import type { ArenaLayout, RockNetState } from '../types';

/**
 * RockRegistry – Host-seitiger HP-Zustand aller Felsen.
 * Nur auf dem Host instanziiert; Clients empfangen Snapshots via GameState.
 */
export class RockRegistry {
  /** rockIndex → aktueller HP-Wert + max HP */
  private hpMap = new Map<number, { hp: number; maxHp: number }>();

  constructor(layout: ArenaLayout) {
    this.reset(layout);
  }

  /** Initialisiert alle Felsen mit vollem HP. */
  reset(layout: ArenaLayout): void {
    this.hpMap.clear();
    for (let i = 0; i < layout.rocks.length; i++) {
      this.hpMap.set(i, { hp: ROCK_HP_MAX, maxHp: ROCK_HP_MAX });
    }
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

  /**
   * Zieht Schaden vom Felsen ab.
   * Gibt den neuen HP-Wert zurück (mindestens 0).
   */
  applyDamage(id: number, damage: number): number {
    const current = this.hpMap.get(id);
    if (current === undefined) return 0; // Bereits zerstört
    const newHp = Math.max(0, current.hp - damage);
    this.hpMap.set(id, { hp: newHp, maxHp: current.maxHp });
    return newHp;
  }

  /** Gibt true zurück wenn der Felsen 0 HP hat. */
  isDestroyed(id: number): boolean {
    const hp = this.hpMap.get(id);
    return hp !== undefined && hp.hp <= 0;
  }

  /** Entfernt den Felsen aus der Registry (nach Zerstörung). */
  remove(id: number): void {
    this.hpMap.delete(id);
  }

  /**
   * Delta-Snapshot für Netzwerk-Sync: Nur Felsen mit HP < ROCK_HP_MAX enthalten.
   * Abwesende IDs gelten beim Client als vollständig (ROCK_HP_MAX).
   */
  getNetSnapshot(): RockNetState[] {
    const result: RockNetState[] = [];
    for (const [id, state] of this.hpMap) {
      if (state.hp < state.maxHp) {
        result.push({ id, hp: state.hp });
      }
    }
    return result;
  }
}
