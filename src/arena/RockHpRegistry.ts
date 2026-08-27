import { ROCK_HP_MAX } from '../config';
import type { ArenaLayout } from '../types';

/**
 * Reiner HP-Zustand eines Felsbestands – ohne Netzwerk, Runde oder Autorität.
 *
 * Der Gameplay-Bestand ({@link RockRegistry}) erweitert diese Klasse um die Snapshot-Schicht;
 * die lokale Lobby-Inszenierung benutzt sie direkt. Es gibt dadurch nur **eine**
 * Fels-HP-Implementierung: `applyDamage`, `getHP`, `getMaxHP`, `setHP`, `isDestroyed`,
 * `remove` und `register` verhalten sich in Arena und Lobby identisch.
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

  /**
   * Zieht Schaden vom Felsen ab.
   * Gibt den neuen HP-Wert zurück (mindestens 0).
   */
  applyDamage(id: number, damage: number): number {
    const current = this.hpMap.get(id);
    if (current === undefined) return 0; // Bereits zerstört
    // Geschützte Struktur bleibt unversehrt und meldet ihren vollen Stand zurück; der Treffer
    // selbst (Aufprall, Effekt, Sound) bleibt davon unberührt.
    if (this.indestructibleIds.has(id)) return current.hp;
    const newHp = Math.max(0, current.hp - damage);
    this.hpMap.set(id, { hp: newHp, maxHp: current.maxHp });
    return newHp;
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
