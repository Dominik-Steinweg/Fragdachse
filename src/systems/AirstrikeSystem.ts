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
  metadata?:  AirstrikeStrikeMetadata;
}

/** Optionale Herkunft eines authored Map-Airstrike-Zyklus. Player-Ultimates setzen sie nicht. */
export interface AirstrikeStrikeMetadata {
  readonly eventId: string;
  readonly occurrence: number;
}

export interface AirstrikeStrikeResolution {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly triggeredBy: string;
  readonly config: AirstrikeUltimateConfig;
  readonly metadata?: AirstrikeStrikeMetadata;
}

export type AirstrikeExplodedCallback = (
  x:           number,
  y:           number,
  radius:      number,
  triggeredBy: string,
  config:      AirstrikeUltimateConfig,
  metadata?:  AirstrikeStrikeMetadata,
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
  private onResolved: ((strike: AirstrikeStrikeResolution) => void) | null = null;

  setExplodedCallback(cb: AirstrikeExplodedCallback): void {
    this.onExploded = cb;
  }

  /** Meldet nach der bestehenden Explosions-/Schadensverarbeitung den echten Strike-Abschluss. */
  setResolvedCallback(cb: ((strike: AirstrikeStrikeResolution) => void) | null): void {
    this.onResolved = cb;
  }

  /**
   * Plant einen neuen Luftangriff-Strike ein.
   * Die Spieler-/Readiness-Prüfung erfolgt im jeweiligen Aktivierungs-Owner; dieses System
   * besitzt ausschließlich die deferred Strike-Lifetime.
   */
  scheduleStrike(
    playerId: string,
    targetX:  number,
    targetY:  number,
    config:   AirstrikeUltimateConfig,
    armedAt: number,
    metadata?: AirstrikeStrikeMetadata,
  ): boolean {
    const count = Math.max(1, Math.floor(config.carpetStrikeCount ?? 1));
    const radiusFactor = count > 1 ? (config.carpetRadiusFactor ?? 1) : 1;
    const damageFactor = count > 1 ? (config.carpetDamageFactor ?? 1) : 1;
    for (let index = 0; index < count; index += 1) {
      const offsetIndex = index - (count - 1) / 2;
      const strikeConfig = count > 1 ? {
        ...config,
        radius: config.radius * radiusFactor,
        maxDamage: config.maxDamage * damageFactor,
        minDamage: config.minDamage * damageFactor,
      } : config;
      const strike: ActiveAirstrikeStrike = {
        id: this.nextId++,
        x: targetX + offsetIndex * (config.carpetOffset ?? 0),
        y: targetY,
        radius: strikeConfig.radius,
        armedAt,
        explodeAt: armedAt + config.delayMs + index * (config.carpetIntervalMs ?? 0),
        triggeredBy: playerId,
        config: strikeConfig,
        metadata,
      };
      this.strikes.set(strike.id, strike);
    }
    return true;
  }

  /** Jeden Frame aufrufen: feuert Strikes, deren Zeit abgelaufen ist. */
  update(now: number): void {
    for (const [id, strike] of this.strikes) {
      if (now >= strike.explodeAt) {
        const resolution: AirstrikeStrikeResolution = {
          id: strike.id,
          x: strike.x,
          y: strike.y,
          radius: strike.radius,
          triggeredBy: strike.triggeredBy,
          config: strike.config,
          ...(strike.metadata === undefined ? {} : { metadata: strike.metadata }),
        };
        if (strike.metadata === undefined) {
          this.onExploded?.(
            strike.x,
            strike.y,
            strike.radius,
            strike.triggeredBy,
            strike.config,
          );
        } else {
          this.onExploded?.(
            strike.x,
            strike.y,
            strike.radius,
            strike.triggeredBy,
            strike.config,
            strike.metadata,
          );
        }
        this.onResolved?.(resolution);
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

  /** Removes only authored map strikes; player-triggered strikes remain untouched. */
  clearAuthoredActivityStrikes(eventIds?: ReadonlySet<string>): void {
    for (const [id, strike] of this.strikes) {
      const eventId = strike.metadata?.eventId;
      if (eventId === undefined) continue;
      if (eventIds !== undefined && !eventIds.has(eventId)) continue;
      this.strikes.delete(id);
    }
  }

  clear(): void {
    this.strikes.clear();
  }
}
