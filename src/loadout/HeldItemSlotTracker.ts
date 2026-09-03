import type { WeaponSlot } from '../types';

/** Slots, die etwas in den Pfoten der Figur sichtbar machen. Das Ultimate ist keine Handwaffe. */
export type HeldItemSlot = WeaponSlot | 'utility';

/**
 * Wie lange die Utility nach ihrem Einsatz in den Pfoten bleibt, bevor die zuletzt benutzte Waffe
 * zurueckkehrt. Der Wurf selbst wird nicht repliziert – erst das Loslassen erreicht den Host –,
 * das Fenster steht deshalb fuer die Wurfbewegung und nicht fuer eine Haltephase davor. Kurz
 * genug, dass niemand mit einer bereits geworfenen Granate herumlaeuft.
 */
export const HELD_UTILITY_DISPLAY_MS = 450;

/**
 * Verfolgt je Spieler, welches Loadout-Item die Figur als Use-/Animationsfallback gerade traegt.
 * Eine lokale Radial-Auswahl allein ist keine sichtbare Quelle; fuer entfernte Spieler bleibt
 * dieser host-autoritativ replizierte Tracker die sichtbare Quelle.
 *
 * Reine Zustandslogik ohne Phaser- oder Netzwerkbezug: der Host fuettert sie aus tatsaechlich
 * erfolgreichen Einsaetzen, das Ergebnis wird als Slot repliziert und fuer Spieler ohne lokale
 * Radial-Projektion in dieselbe Darstellung uebersetzt. Waffenslots sind klebrig, die Utility ist
 * ein kurzes Fenster – sonst liefe ein Spieler nach einem einzigen Granatenwurf dauerhaft mit der
 * Granate herum.
 */
export class HeldItemSlotTracker {
  private readonly lastWeaponSlot = new Map<string, WeaponSlot>();
  private readonly utilityUsedAt = new Map<string, number>();

  noteWeaponUsed(playerId: string, slot: WeaponSlot, now: number): void {
    this.lastWeaponSlot.set(playerId, slot);
    // Ein Schuss beendet das Utility-Fenster sofort: die Waffe ist nachweislich wieder in der Hand.
    this.utilityUsedAt.delete(playerId);
    void now;
  }

  noteUtilityUsed(playerId: string, now: number): void {
    this.utilityUsedAt.set(playerId, now);
  }

  resolve(playerId: string, now: number): HeldItemSlot {
    const usedAt = this.utilityUsedAt.get(playerId);
    if (usedAt !== undefined) {
      if (now - usedAt < HELD_UTILITY_DISPLAY_MS) return 'utility';
      this.utilityUsedAt.delete(playerId);
    }
    return this.lastWeaponSlot.get(playerId) ?? 'weapon1';
  }

  removePlayer(playerId: string): void {
    this.lastWeaponSlot.delete(playerId);
    this.utilityUsedAt.delete(playerId);
  }

  /** Beim Rundenwechsel: jeder Spieler beginnt wieder mit Waffe 1 in den Pfoten. */
  reset(): void {
    this.lastWeaponSlot.clear();
    this.utilityUsedAt.clear();
  }
}
