import { ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, ARENA_HEIGHT, CELL_SIZE } from '../config';
import type { ArmageddonMeteorConfig } from '../loadout/LoadoutConfig';
import type { RockGridIndex } from '../arena/RockGridIndex';
import type { FireChunkBurstConfig, RadialDamageFalloffConfig, SyncedMeteorStrike } from '../types';

// ── Typen ────────────────────────────────────────────────────────────────────

export interface MeteorImpactEvent {
  id:             number;
  x:              number;
  y:              number;
  radius:         number;
  damage:         number;
  damageFalloff?: RadialDamageFalloffConfig;
  ownerId:        string;
  selfDamageMult: number;
  rockDamageMult: number;
  trainDamageMult: number;
  fireChunkBurst: FireChunkBurstConfig;
}

interface ActiveMeteor {
  id:        number;
  x:         number;
  y:         number;
  radius:    number;
  spawnedAt: number;
  impactAt:  number;
  ownerId:   string;
  damage:    number;
  damageFalloff?: RadialDamageFalloffConfig;
  selfDamageMult: number;
  rockDamageMult: number;
  trainDamageMult: number;
  fireChunkBurst: FireChunkBurstConfig;
}

interface ArmageddonSession {
  config:            ArmageddonMeteorConfig;
  getPlayerPos:      () => { x: number; y: number } | null;
  ownerId:           string;
  spawnAccumulator:  number;   // ms seit letztem Spawn
  nextSpawnInterval: number;   // ms bis zum nächsten Spawn (mit Jitter)
  spawning:          boolean;  // false wenn duration abgelaufen, nur noch In-Flight-Meteore
  spawnedCount:      number;
}

// ── System ───────────────────────────────────────────────────────────────────

/**
 * ArmageddonSystem – Host-autoritär.
 * Verwaltet aktive Armageddon-Sessionen (Meteor-Spawning) pro Spieler
 * und liefert Impact-Events + Netzwerk-Snapshots.
 */
export class ArmageddonSystem {
  private sessions = new Map<string, ArmageddonSession>();
  private meteors: ActiveMeteor[] = [];
  private nextMeteorId = 0;
  private rockGrid: RockGridIndex | null = null;

  setRockGrid(grid: RockGridIndex): void {
    this.rockGrid = grid;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  activate(
    playerId: string,
    config: ArmageddonMeteorConfig,
    getPlayerPos: () => { x: number; y: number } | null,
  ): void {
    this.sessions.set(playerId, {
      config,
      getPlayerPos,
      ownerId: playerId,
      spawnAccumulator: 0,
      nextSpawnInterval: this.jitteredInterval(config),
      spawning: true,
      spawnedCount: 0,
    });
  }

  deactivate(playerId: string): void {
    const session = this.sessions.get(playerId);
    if (session) session.spawning = false;
    // Session wird erst entfernt wenn alle Meteore eingeschlagen sind (s.u.)
  }

  // ── Frame-Update ──────────────────────────────────────────────────────────

  update(now: number, delta: number): MeteorImpactEvent[] {
    const impacts: MeteorImpactEvent[] = [];

    // 1. Meteor-Spawning für aktive Sessions
    for (const [playerId, session] of this.sessions) {
      if (!session.spawning) continue;

      session.spawnAccumulator += delta;
      while (session.spawnAccumulator >= session.nextSpawnInterval) {
        session.spawnAccumulator -= session.nextSpawnInterval;
        session.nextSpawnInterval = this.jitteredInterval(session.config);
        this.trySpawnMeteor(session, now);
      }
    }

    // 2. Impact-Check: abgelaufene Meteore → Event + entfernen
    const remaining: ActiveMeteor[] = [];
    for (const m of this.meteors) {
      if (now >= m.impactAt) {
        impacts.push({
          id:              m.id,
          x:               m.x,
          y:               m.y,
          radius:          m.radius,
          damage:          m.damage,
          damageFalloff:   m.damageFalloff,
          ownerId:         m.ownerId,
          selfDamageMult:  m.selfDamageMult,
          rockDamageMult:  m.rockDamageMult,
          trainDamageMult: m.trainDamageMult,
          fireChunkBurst:  m.fireChunkBurst,
        });
      } else {
        remaining.push(m);
      }
    }
    this.meteors = remaining;

    // 3. Leere Sessions aufräumen (Spawning beendet + keine Meteore mehr)
    for (const [playerId, session] of this.sessions) {
      if (!session.spawning && !this.meteors.some(m => m.ownerId === playerId)) {
        this.sessions.delete(playerId);
      }
    }

    return impacts;
  }

  // ── Netzwerk-Snapshot ──────────────────────────────────────────────────────

  getSnapshot(): SyncedMeteorStrike[] {
    return this.meteors.map(m => ({
      id:        m.id,
      x:         m.x,
      y:         m.y,
      radius:    m.radius,
      spawnedAt: m.spawnedAt,
      impactAt:  m.impactAt,
      ownerId:   m.ownerId,
    }));
  }

  // ── Aufräumen ──────────────────────────────────────────────────────────────

  destroyAll(): void {
    this.sessions.clear();
    this.meteors = [];
  }

  // ── Internes ──────────────────────────────────────────────────────────────

  /** Normale Meteore variieren um ±20%; Kometenhagel verwendet ein festes Intervall. */
  private jitteredInterval(config: ArmageddonMeteorConfig): number {
    const cometStorm = config.cometStormEnabled > 0;
    const rateDivisor = cometStorm ? Math.max(1, config.cometSpawnRateDivisor) : 1;
    const base = 1000 / Math.max(0.0001, config.meteorsPerSecond / rateDivisor);
    if (cometStorm) return base;
    return base * (0.8 + Math.random() * 0.4);
  }

  /** Versucht einen Meteor auf einem freien Feld zu spawnen (bis zu 5 Versuche). */
  private trySpawnMeteor(session: ArmageddonSession, now: number): void {
    const pos = session.getPlayerPos();
    if (!pos) return;

    const cfg = session.config;
    const minX = ARENA_OFFSET_X;
    const minY = ARENA_OFFSET_Y;
    const maxX = ARENA_OFFSET_X + ARENA_WIDTH;
    const maxY = ARENA_OFFSET_Y + ARENA_HEIGHT;

    if (cfg.cometStormEnabled > 0) {
      this.spawnMeteor(
        session,
        now,
        Math.min(maxX, Math.max(minX, pos.x)),
        Math.min(maxY, Math.max(minY, pos.y)),
      );
      return;
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      // Zufällige Position im Spawn-Radius
      const angle = Math.random() * Math.PI * 2;
      const dist  = Math.random() * cfg.meteorSpawnRadius;
      const wx = pos.x + Math.cos(angle) * dist;
      const wy = pos.y + Math.sin(angle) * dist;

      // Arena-Bounds prüfen
      if (wx < minX || wx > maxX || wy < minY || wy > maxY) continue;

      // Grid-Belegung prüfen (Felsen)
      const gx = Math.floor((wx - ARENA_OFFSET_X) / CELL_SIZE);
      const gy = Math.floor((wy - ARENA_OFFSET_Y) / CELL_SIZE);
      if (this.rockGrid?.isOccupied(gx, gy)) continue;

      this.spawnMeteor(session, now, wx, wy);
      return;
    }
    // Alle 5 Versuche blockiert → dieser Spawn wird übersprungen
  }

  private spawnMeteor(session: ArmageddonSession, now: number, x: number, y: number): void {
    const cfg = session.config;
    const cometStorm = cfg.cometStormEnabled > 0;
    const radiusJitter = 1 + (Math.random() * 2 - 1) * cfg.meteorRadiusJitter;
    const radiusFactor = cometStorm ? Math.max(0, cfg.cometRadiusFactor) : 1;
    const damageFactor = cometStorm ? Math.max(0, cfg.cometDamageFactor) : 1;
    const fallDurationFactor = cometStorm ? Math.max(0, cfg.cometFallDurationFactor) : 1;
    const chunkCountFactor = cometStorm ? Math.max(0, cfg.cometChunkCountFactor) : 1;
    const damageFalloff = cfg.meteorDamageFalloff
      ? { minDamage: cfg.meteorDamageFalloff.minDamage * damageFactor }
      : undefined;

    session.spawnedCount += 1;
    this.meteors.push({
      id:              this.nextMeteorId++,
      x:               Math.round(x),
      y:               Math.round(y),
      radius:          Math.round(cfg.meteorDamageRadius * radiusJitter * radiusFactor),
      spawnedAt:       now,
      impactAt:        now + Math.max(1, Math.round(cfg.meteorFallDuration * fallDurationFactor)),
      ownerId:         session.ownerId,
      damage:          cfg.meteorDamage * damageFactor,
      damageFalloff,
      selfDamageMult:  cfg.selfDamageMult,
      rockDamageMult:  cfg.rockDamageMult ?? 1,
      trainDamageMult: cfg.trainDamageMult ?? 1,
      fireChunkBurst: {
        ...cfg.fireChunkBurst,
        count: Math.max(0, Math.floor(cfg.fireChunkBurst.count * chunkCountFactor)),
      },
    });
  }
}
