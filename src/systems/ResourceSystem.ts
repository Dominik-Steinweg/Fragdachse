import {
  ADRENALINE_MAX,
  ADRENALINE_START,
  ADRENALINE_REGEN_PER_SEC,
  ADRENALINE_REGEN_PAUSE_MS,
  RAGE_MAX,
} from '../config';

type PowerUpSystemType = { getRegenMultiplier(id: string): number };

/**
 * Host-only: Verwaltet Adrenalin und Wut aller Spieler.
 * Regen-Logik wird per Frame über regenTick() aufgerufen.
 * Drain (Burrow) erfolgt über drainAdrenaline().
 */
export class ResourceSystem {
  private adrenaline:        Map<string, number> = new Map();
  private rage:              Map<string, number> = new Map();
  private regenPausedUntil:  Map<string, number> = new Map(); // ms-Timestamp
  private powerUpSystem:     PowerUpSystemType | null = null;

  setPowerUpSystem(ps: PowerUpSystemType | null): void { this.powerUpSystem = ps; }

  initPlayer(id: string): void {
    this.adrenaline.set(id, ADRENALINE_START);
    this.rage.set(id, 0);
    this.regenPausedUntil.set(id, 0);
  }

  removePlayer(id: string): void {
    this.adrenaline.delete(id);
    this.rage.delete(id);
    this.regenPausedUntil.delete(id);
  }

  getAdrenaline(id: string): number {
    return this.adrenaline.get(id) ?? 0;
  }

  getRage(id: string): number {
    return this.rage.get(id) ?? 0;
  }

  /**
   * Fügt Adrenalin hinzu (gedeckelt auf ADRENALINE_MAX).
   * Pausiert die Regeneration NICHT – wird als Belohnung für Treffer genutzt.
   */
  addAdrenaline(id: string, amount: number): void {
    const cur = Math.min(ADRENALINE_MAX, (this.adrenaline.get(id) ?? 0) + amount);
    this.adrenaline.set(id, cur);
  }

  /**
   * Zieht Adrenalin ab und pausiert die passive Regeneration für
   * ADRENALINE_REGEN_PAUSE_MS Millisekunden.
   */
  drainAdrenaline(id: string, amount: number): void {
    const cur = Math.max(0, (this.adrenaline.get(id) ?? 0) - amount);
    this.adrenaline.set(id, cur);
    this.regenPausedUntil.set(id, Date.now() + ADRENALINE_REGEN_PAUSE_MS);
  }

  /**
   * Fügt Wut hinzu (gedeckelt auf RAGE_MAX).
   * Wird aufgerufen wenn der Spieler Schaden erleidet.
   */
  addRage(id: string, amount: number): void {
    const cur = Math.min(RAGE_MAX, (this.rage.get(id) ?? 0) + amount);
    this.rage.set(id, cur);
  }

  /**
   * Passiver Adrenalin-Regen – nur für nicht-grabende Spieler aufrufen.
   * @param delta Frame-Delta in Millisekunden
   */
  regenTick(id: string, delta: number): void {
    if (Date.now() < (this.regenPausedUntil.get(id) ?? 0)) return;
    const regenMult = this.powerUpSystem?.getRegenMultiplier(id) ?? 1;
    const cur = Math.min(
      ADRENALINE_MAX,
      (this.adrenaline.get(id) ?? 0) + ADRENALINE_REGEN_PER_SEC * regenMult * delta / 1000,
    );
    this.adrenaline.set(id, cur);
  }

  /** Setzt Adrenalin direkt (z. B. bei Respawn). */
  setAdrenaline(id: string, val: number): void {
    this.adrenaline.set(id, Math.max(0, Math.min(ADRENALINE_MAX, val)));
  }
}
