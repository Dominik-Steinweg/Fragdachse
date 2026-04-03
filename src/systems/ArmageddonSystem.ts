import { ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, ARENA_HEIGHT, CELL_SIZE } from '../config';
import type { ArmageddonMeteorConfig } from '../loadout/LoadoutConfig';
import type { RockGridIndex } from '../arena/RockGridIndex';
import type { RadialDamageFalloffConfig, SyncedMeteorStrike } from '../types';

// ── Typen ────────────────────────────────────────────────────────────────────

export interface MeteorImpactEvent {
  x:              number;
  y:              number;
  radius:         number;
  damage:         number;
  damageFalloff?: RadialDamageFalloffConfig;
  ownerId:        string;
  selfDamageMult: number;
  rockDamageMult: number;
  trainDamageMult: number;
}

interface ActiveMeteor {
  id:        number;
  x:         number;
  y:         number;
  radius:    number;
  spawnedAt: number;
  impactAt:  number;
  ownerId:   string;
}

interface ArmageddonSession {
  config:            ArmageddonMeteorConfig;
  getPlayerPos:      () => { x: number; y: number } | null;
  ownerId:           string;
  spawnAccumulator:  number;   // ms seit letztem Spawn
  nextSpawnInterval: number;   // ms bis zum nächsten Spawn (mit Jitter)
  spawning:          boolean;  // false wenn duration abgelaufen, nur noch In-Flight-Meteore
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
        // Session-Config für Schadens-Multiplikatoren holen
        const session = this.sessions.get(m.ownerId);
        const cfg = session?.config;
        impacts.push({
          x:               m.x,
          y:               m.y,
          radius:          m.radius,
          damage:          cfg?.meteorDamage ?? 35,
          damageFalloff:   cfg?.meteorDamageFalloff,
          ownerId:         m.ownerId,
          selfDamageMult:  cfg?.selfDamageMult ?? 0,
          rockDamageMult:  cfg?.rockDamageMult ?? 1,
          trainDamageMult: cfg?.trainDamageMult ?? 1,
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

  /** Spawn-Intervall mit ±20% Jitter */
  private jitteredInterval(config: ArmageddonMeteorConfig): number {
    const base = 1000 / config.meteorsPerSecond;
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

      // Freies Feld gefunden → Meteor spawnen
      // Radius mit konfigurierbarem Jitter (z.B. ±10%)
      const jitter = cfg.meteorRadiusJitter;
      const radiusMult = 1 + (Math.random() * 2 - 1) * jitter;
      const radius = Math.round(cfg.meteorDamageRadius * radiusMult);

      this.meteors.push({
        id:        this.nextMeteorId++,
        x:         Math.round(wx),
        y:         Math.round(wy),
        radius,
        spawnedAt: now,
        impactAt:  now + cfg.meteorFallDuration,
        ownerId:   session.ownerId,
      });
      return;
    }
    // Alle 5 Versuche blockiert → dieser Spawn wird übersprungen
  }
}
