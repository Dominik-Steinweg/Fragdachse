import {
  ADRENALINE_MAX,
  ADRENALINE_START,
  ADRENALINE_REGEN_PER_SEC,
  ADRENALINE_REGEN_PAUSE_MS,
  RAGE_MAX,
} from '../config';
import { resolveEffectiveAdrenalineCost } from './AdrenalineCost';

type PowerUpSystemType = { getRegenMultiplier(id: string): number };

/**
 * Host-only: Verwaltet Adrenalin und Wut aller Spieler.
 * Regen-Logik wird per Frame über regenTick() aufgerufen.
 * Drain (Burrow) erfolgt über drainAdrenaline().
 */
export class ResourceSystem {
  private adrenaline:        Map<string, number> = new Map();
  private adrenalineRevision: Map<string, number> = new Map();
  private rage:              Map<string, number> = new Map();
  private regenPausedUntil:  Map<string, number> = new Map(); // ms-Timestamp
  private powerUpSystem:     PowerUpSystemType | null = null;
  private adrenalineMaxResolver: ((id: string) => number) | null = null;
  private adrenalineRegenRateResolver: ((id: string) => number) | null = null;
  private rageMaxResolver: ((id: string) => number) | null = null;
  private rageGainMultiplierResolver: ((id: string) => number) | null = null;
  private adrenalineGainMultiplierResolver: ((id: string) => number) | null = null;
  private adrenalineCostMultiplierResolver: ((id: string) => number) | null = null;
  private adrenalineSpawnFullResolver: ((id: string) => boolean) | null = null;
  private readonly adrenalineDrainObservers = new Set<(
    playerId: string,
    requestedAmount: number,
    drainedAmount: number,
  ) => void>();
  private readonly adrenalineGainObservers = new Set<(
    playerId: string,
    requestedAmount: number,
    gainedAmount: number,
  ) => void>();

  setPowerUpSystem(ps: PowerUpSystemType | null): void { this.powerUpSystem = ps; }
  setAdrenalineMaxResolver(resolver: ((id: string) => number) | null): void { this.adrenalineMaxResolver = resolver; }
  setAdrenalineRegenRateResolver(resolver: ((id: string) => number) | null): void { this.adrenalineRegenRateResolver = resolver; }
  setRageMaxResolver(resolver: ((id: string) => number) | null): void { this.rageMaxResolver = resolver; }
  setRageGainMultiplierResolver(resolver: ((id: string) => number) | null): void { this.rageGainMultiplierResolver = resolver; }
  setAdrenalineGainMultiplierResolver(resolver: ((id: string) => number) | null): void { this.adrenalineGainMultiplierResolver = resolver; }
  setAdrenalineCostMultiplierResolver(resolver: ((id: string) => number) | null): void { this.adrenalineCostMultiplierResolver = resolver; }
  setAdrenalineSpawnFullResolver(resolver: ((id: string) => boolean) | null): void { this.adrenalineSpawnFullResolver = resolver; }
  addAdrenalineDrainObserver(observer: (
    playerId: string,
    requestedAmount: number,
    drainedAmount: number,
  ) => void): () => void {
    this.adrenalineDrainObservers.add(observer);
    return () => { this.adrenalineDrainObservers.delete(observer); };
  }
  addAdrenalineGainObserver(observer: (
    playerId: string,
    requestedAmount: number,
    gainedAmount: number,
  ) => void): () => void {
    this.adrenalineGainObservers.add(observer);
    return () => { this.adrenalineGainObservers.delete(observer); };
  }

  /** Adrenalin-Wert fuer (Wieder-)Belebung: Maximum bei aktivem "Adrenalinschub"-Upgrade, sonst ADRENALINE_START. */
  private getSpawnAdrenaline(id: string): number {
    const max = this.getMaxAdrenaline(id);
    return this.adrenalineSpawnFullResolver?.(id) ? max : Math.min(max, ADRENALINE_START);
  }

  initPlayer(id: string): void {
    this.adrenaline.set(id, this.getSpawnAdrenaline(id));
    this.adrenalineRevision.set(id, 0);
    this.rage.set(id, 0);
    this.regenPausedUntil.set(id, 0);
  }

  /** Setzt Adrenalin auf den Spawn-Wert zurueck (fuer Respawn). */
  resetAdrenalineForSpawn(id: string): void {
    this.writeAdrenaline(id, this.getSpawnAdrenaline(id));
  }

  removePlayer(id: string): void {
    this.adrenaline.delete(id);
    this.adrenalineRevision.delete(id);
    this.rage.delete(id);
    this.regenPausedUntil.delete(id);
  }

  getAdrenaline(id: string): number {
    return this.adrenaline.get(id) ?? 0;
  }

  getAdrenalineRevision(id: string): number {
    return this.adrenalineRevision.get(id) ?? 0;
  }

  getMaxAdrenaline(id: string): number {
    return Math.max(0, this.adrenalineMaxResolver?.(id) ?? ADRENALINE_MAX);
  }

  getRage(id: string): number {
    return this.rage.get(id) ?? 0;
  }

  getMaxRage(id: string): number {
    return Math.max(0, this.rageMaxResolver?.(id) ?? RAGE_MAX);
  }

  /** Klemmt laufende Ressourcen an neue live aus Build/Modus aufgeloeste Maxima. */
  reconcilePlayerLimits(id: string): void {
    if (this.adrenaline.has(id)) {
      this.writeAdrenaline(id, Math.min(this.getMaxAdrenaline(id), Math.max(0, this.adrenaline.get(id) ?? 0)));
    }
    if (this.rage.has(id)) {
      this.rage.set(id, Math.min(this.getMaxRage(id), Math.max(0, this.rage.get(id) ?? 0)));
    }
  }

  setRage(id: string, value: number): void {
    this.rage.set(id, Math.max(0, Math.min(this.getMaxRage(id), value)));
  }

  /**
   * Fügt Adrenalin hinzu (gedeckelt auf ADRENALINE_MAX).
   * Pausiert die Regeneration NICHT – wird als Belohnung für Treffer genutzt.
   */
  addAdrenaline(id: string, amount: number): void {
    const adjustedAmount = amount > 0 ? amount * Math.max(0, this.adrenalineGainMultiplierResolver?.(id) ?? 1) : amount;
    const previous = this.adrenaline.get(id) ?? 0;
    const cur = Math.min(this.getMaxAdrenaline(id), previous + adjustedAmount);
    this.writeAdrenaline(id, cur);
    const gainedAmount = cur - previous;
    for (const observer of this.adrenalineGainObservers) {
      observer(id, amount, gainedAmount);
    }
  }

  /** Berechnet die tatsaechlichen Kosten inklusive spielerweiter Verbrauchsmodifikatoren. */
  resolveAdrenalineCost(id: string, amount: number): number {
    return resolveEffectiveAdrenalineCost(amount, this.adrenalineCostMultiplierResolver?.(id) ?? 1);
  }

  /** Exakte Erstattung bereits bezahlter Kosten; Gewinnmodifikatoren werden bewusst nicht erneut angewendet. */
  refundAdrenaline(id: string, amount: number): void {
    if (amount <= 0) return;
    const cur = Math.min(this.getMaxAdrenaline(id), (this.adrenaline.get(id) ?? 0) + amount);
    this.writeAdrenaline(id, cur);
  }

  /**
   * Zieht Adrenalin ab und pausiert die passive Regeneration für
   * ADRENALINE_REGEN_PAUSE_MS Millisekunden.
   */
  drainAdrenaline(id: string, amount: number, nowMs: number): void {
    const adjustedAmount = this.resolveAdrenalineCost(id, amount);
    const previous = this.adrenaline.get(id) ?? 0;
    const cur = Math.max(0, previous - adjustedAmount);
    this.writeAdrenaline(id, cur);
    const drainedAmount = previous - cur;
    for (const observer of this.adrenalineDrainObservers) {
      observer(id, amount, drainedAmount);
    }
    // Regen-Pause nicht setzen, wenn Adrenalinspritze aktiv ist
    if ((this.powerUpSystem?.getRegenMultiplier(id) ?? 1) === 1) {
      this.regenPausedUntil.set(id, nowMs + ADRENALINE_REGEN_PAUSE_MS);
    }
  }

  /**
   * Liefert den Zeitstempel bis zu dem die passive Regeneration pausiert ist.
   */
  getRegenPausedUntil(id: string): number {
    return this.regenPausedUntil.get(id) ?? 0;
  }

  /**
   * Fügt Wut hinzu (gedeckelt auf RAGE_MAX).
   * Wird aufgerufen wenn der Spieler Schaden erleidet.
   */
  addRage(id: string, amount: number): void {
    const adjustedAmount = amount > 0
      ? amount * Math.max(0, this.rageGainMultiplierResolver?.(id) ?? 1)
      : amount;
    const cur = Math.min(this.getMaxRage(id), (this.rage.get(id) ?? 0) + adjustedAmount);
    this.rage.set(id, cur);
  }

  /**
   * Passiver Adrenalin-Regen – nur für nicht-grabende Spieler aufrufen.
   * @param delta Frame-Delta in Millisekunden
   * @param nowMs Aktueller Host-Zeitstempel in Millisekunden
   */
  regenTick(id: string, delta: number, nowMs: number): void {
    if (nowMs < (this.regenPausedUntil.get(id) ?? 0)) return;
    const regenMult = this.powerUpSystem?.getRegenMultiplier(id) ?? 1;
    const regenRate = this.adrenalineRegenRateResolver?.(id) ?? ADRENALINE_REGEN_PER_SEC;
    const cur = Math.min(
      this.getMaxAdrenaline(id),
      (this.adrenaline.get(id) ?? 0) + regenRate * regenMult * delta / 1000,
    );
    this.writeAdrenaline(id, cur);
  }

  /** Setzt Adrenalin direkt (z. B. bei Respawn). */
  setAdrenaline(id: string, val: number): void {
    this.writeAdrenaline(id, Math.max(0, Math.min(this.getMaxAdrenaline(id), val)));
  }

  private writeAdrenaline(id: string, value: number): void {
    const previous = this.adrenaline.get(id);
    this.adrenaline.set(id, value);
    if (previous !== undefined && previous !== value) {
      this.adrenalineRevision.set(id, (this.adrenalineRevision.get(id) ?? 0) + 1);
    } else if (!this.adrenalineRevision.has(id)) {
      this.adrenalineRevision.set(id, 0);
    }
  }
}
