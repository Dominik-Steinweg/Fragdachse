import type { AirstrikeUltimateConfig } from '../loadout/LoadoutConfig';
import type { SyncedAirstrikeStrike }   from '../types';

interface ActiveAirstrikeStrike {
  id:          number;
  x:           number;
  y:           number;
  radius:      number;
  armedAt:     number;
  explodeAt:   number;
  triggeredBy: string;
  config:      AirstrikeUltimateConfig;
}

export type AirstrikeExplodedCallback = (
  x:           number,
  y:           number,
  radius:      number,
  triggeredBy: string,
  config:      AirstrikeUltimateConfig,
) => void;

/**
 * AirstrikeSystem – Host-autoritär.
 *
 * Verwaltet aktive Luftangriff-Strikes. Jeder Strike hat eine Verzögerung
 * (delayMs) bevor er explodiert. Das System ruft bei Ablauf eine Callback
 * auf, über die Host-seitig Schaden angewendet und ein visueller Effekt
 * ausgelöst wird.
 */
export class AirstrikeSystem {
  private strikes    = new Map<number, ActiveAirstrikeStrike>();
  private nextId     = 0;
  private onExploded: AirstrikeExplodedCallback | null = null;

  setExplodedCallback(cb: AirstrikeExplodedCallback): void {
    this.onExploded = cb;
  }

  /**
   * Plant einen neuen Luftangriff-Strike ein.
   * Gibt false zurück wenn der auslösende Spieler nicht existiert / tot ist
   * (Prüfung erfolgt im rufenden Code in ArenaLifecycleCoordinator).
   */
  scheduleStrike(
    playerId: string,
    targetX:  number,
    targetY:  number,
    config:   AirstrikeUltimateConfig,
  ): boolean {
    const armedAt = Date.now();
    const strike: ActiveAirstrikeStrike = {
      id:          this.nextId++,
      x:           targetX,
      y:           targetY,
      radius:      config.radius,
      armedAt,
      explodeAt:   armedAt + config.delayMs,
      triggeredBy: playerId,
      config,
    };
    this.strikes.set(strike.id, strike);
    return true;
  }

  /** Jeden Frame aufrufen: feuert Strikes, deren Zeit abgelaufen ist. */
  update(now: number): void {
    for (const [id, strike] of this.strikes) {
      if (now >= strike.explodeAt) {
        this.onExploded?.(
          strike.x,
          strike.y,
          strike.radius,
          strike.triggeredBy,
          strike.config,
        );
        this.strikes.delete(id);
      }
    }
  }

  /** Netzwerk-Snapshot für broadcasteten GameState. */
  getSnapshot(): SyncedAirstrikeStrike[] {
    const result: SyncedAirstrikeStrike[] = [];
    for (const s of this.strikes.values()) {
      result.push({
        id:          s.id,
        x:           s.x,
        y:           s.y,
        radius:      s.radius,
        armedAt:     s.armedAt,
        explodeAt:   s.explodeAt,
        triggeredBy: s.triggeredBy,
      });
    }
    return result;
  }

  clear(): void {
    this.strikes.clear();
  }
}
