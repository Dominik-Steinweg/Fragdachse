import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
} from '../config';
import { getCoopDefenseTutorialRockRegion } from '../config/coopDefenseTutorial';
import { ULTIMATE_CONFIGS, type AirstrikeUltimateConfig } from '../loadout/LoadoutConfig';

/** Synthetische Angreifer-ID der Zombie-Luftangriffe (kein Spieler, kein Gegner-Entity). */
export const COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID = 'coop-zombie-bomber';

const PLAYER_AIRSTRIKE = ULTIMATE_CONFIGS.AIRSTRIKE as AirstrikeUltimateConfig;

/**
 * Eröffnungs-Bombardement auf den Felsbereich unter dem Tutorial-Fenster:
 * hoher Felsschaden, damit der gesamte Bereich sicher freigeräumt wird.
 */
const OPENING_BARRAGE_STRIKE_CONFIG: AirstrikeUltimateConfig = {
  ...PLAYER_AIRSTRIKE,
  radius: 200,
  maxDamage: 400,
  minDamage: 150,
  rockDamageMult: 3,
  trainDamageMult: 0,
  baseDamageMult: 1,
  skipEnemyDamage: true,
};

/** Wiederkehrende Einzelschläge in Spielernähe. */
const PLAYER_HUNT_STRIKE_CONFIG: AirstrikeUltimateConfig = {
  ...PLAYER_AIRSTRIKE,
  baseDamageMult: 1,
  skipEnemyDamage: true,
};

// Das Tutorial-Fenster (10 s) verschwindet, kurz danach schlagen die ersten Bomben ein.
const OPENING_BARRAGE_FIRST_LAUNCH_MS = 8200;
const OPENING_BARRAGE_MIN_STRIKES = 7;
const OPENING_BARRAGE_MAX_STRIKES = 9;
const OPENING_BARRAGE_MIN_GAP_MS = 280;
const OPENING_BARRAGE_MAX_GAP_MS = 540;

const PLAYER_HUNT_START_MS = 20_000;
const PLAYER_HUNT_INTERVAL_MS = 10_000;
const PLAYER_HUNT_MIN_OFFSET_PX = 60;
const PLAYER_HUNT_MAX_OFFSET_PX = 220;
const PLAYER_HUNT_BASE_AVOID_ATTEMPTS = 12;
const BASE_AVOID_MARGIN_PX = CELL_SIZE;
const ARENA_EDGE_MARGIN_PX = 40;

interface ScheduledBarrageStrike {
  readonly dueAtMs: number;
  readonly x: number;
  readonly y: number;
}

export interface CoopDefenseAirstrikeDirectorDeps {
  scheduleStrike(x: number, y: number, config: AirstrikeUltimateConfig): void;
  getAlivePlayerPositions(): readonly { x: number; y: number }[];
  /** True wenn der Punkt in/nahe einer Coop-Basis liegt (soll gemieden werden). */
  isProtectedBasePoint(x: number, y: number): boolean;
  playStrikeAudio(x: number, y: number): void;
}

/**
 * CoopDefenseAirstrikeDirector – Host-autoritär.
 *
 * Steuert die Luftangriffe der Zombie-Fraktion auf Maps mit `enemyAirstrikes`:
 *   1. Eröffnungs-Bombardement: Ein "Bomberflug" über den Felsbereich des
 *      Tutorial-Fensters – leicht chaotisch gestreute Einschläge von links nach
 *      rechts mit kurzen, unregelmäßigen Abständen.
 *   2. Danach alle 10 s ein Einschlag in der Nähe eines zufälligen Spielers;
 *      Basisbereiche werden nach Möglichkeit gemieden.
 *
 * Die eigentlichen Strikes laufen über das reguläre AirstrikeSystem und werden
 * damit automatisch an alle Clients synchronisiert (Warnkreis + Explosion).
 */
export class CoopDefenseAirstrikeDirector {
  private elapsedMs = 0;
  private readonly pendingBarrageStrikes: ScheduledBarrageStrike[];
  private barrageAudioPlayed = false;
  private nextHuntStrikeAtMs = PLAYER_HUNT_START_MS;

  constructor(private readonly deps: CoopDefenseAirstrikeDirectorDeps) {
    this.pendingBarrageStrikes = this.buildOpeningBarrage();
  }

  hostUpdate(deltaMs: number, countdownActive: boolean): void {
    if (countdownActive) return;
    this.elapsedMs += deltaMs;

    while (this.pendingBarrageStrikes.length > 0 && this.elapsedMs >= this.pendingBarrageStrikes[0].dueAtMs) {
      const strike = this.pendingBarrageStrikes.shift()!;
      this.deps.scheduleStrike(strike.x, strike.y, OPENING_BARRAGE_STRIKE_CONFIG);
      if (!this.barrageAudioPlayed) {
        this.barrageAudioPlayed = true;
        this.deps.playStrikeAudio(strike.x, strike.y);
      }
    }

    while (this.elapsedMs >= this.nextHuntStrikeAtMs) {
      this.nextHuntStrikeAtMs += PLAYER_HUNT_INTERVAL_MS;
      const target = this.pickHuntTarget();
      if (!target) continue;
      this.deps.scheduleStrike(target.x, target.y, PLAYER_HUNT_STRIKE_CONFIG);
      this.deps.playStrikeAudio(target.x, target.y);
    }
  }

  /**
   * Streut die Eröffnungs-Einschläge über die Pixel-Bounds des Tutorial-Felsbereichs
   * (bis zum oberen Arenarand aufgefüllt, plus 1 Zelle Halo). Links → rechts wie ein
   * überfliegender Bomber, mit zufälligem Jitter statt Schachbrett-Muster.
   */
  private buildOpeningBarrage(): ScheduledBarrageStrike[] {
    const region = getCoopDefenseTutorialRockRegion();
    const left = ARENA_OFFSET_X + (region.minGridX - 1) * CELL_SIZE;
    const right = ARENA_OFFSET_X + (region.maxGridX + 2) * CELL_SIZE;
    const top = ARENA_OFFSET_Y;
    const bottom = ARENA_OFFSET_Y + (region.maxGridY + 2) * CELL_SIZE;

    const strikeCount = OPENING_BARRAGE_MIN_STRIKES
      + Math.floor(Math.random() * (OPENING_BARRAGE_MAX_STRIKES - OPENING_BARRAGE_MIN_STRIKES + 1));

    const strikes: ScheduledBarrageStrike[] = [];
    let dueAtMs = OPENING_BARRAGE_FIRST_LAUNCH_MS;
    for (let index = 0; index < strikeCount; index++) {
      const sweep = strikeCount > 1 ? index / (strikeCount - 1) : 0.5;
      const x = left + sweep * (right - left) + (Math.random() - 0.5) * CELL_SIZE * 2.5;
      const y = top + (0.2 + Math.random() * 0.6) * (bottom - top);
      strikes.push({ dueAtMs, x, y });
      dueAtMs += OPENING_BARRAGE_MIN_GAP_MS
        + Math.random() * (OPENING_BARRAGE_MAX_GAP_MS - OPENING_BARRAGE_MIN_GAP_MS);
    }
    return strikes;
  }

  /**
   * Zielt auf einen Punkt nahe eines zufälligen lebenden Spielers. Punkte in
   * Basisnähe werden mehrfach neu gewürfelt; schlägt das fehl, bleibt der letzte
   * Kandidat bestehen (die Basis erhält dann regulär Schaden).
   */
  private pickHuntTarget(): { x: number; y: number } | null {
    const players = this.deps.getAlivePlayerPositions();
    if (players.length === 0) return null;
    const anchor = players[Math.floor(Math.random() * players.length)];

    let candidate = { x: anchor.x, y: anchor.y };
    for (let attempt = 0; attempt < PLAYER_HUNT_BASE_AVOID_ATTEMPTS; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = PLAYER_HUNT_MIN_OFFSET_PX
        + Math.random() * (PLAYER_HUNT_MAX_OFFSET_PX - PLAYER_HUNT_MIN_OFFSET_PX);
      candidate = this.clampToArena(
        anchor.x + Math.cos(angle) * distance,
        anchor.y + Math.sin(angle) * distance,
      );
      if (!this.isNearBase(candidate.x, candidate.y)) return candidate;
    }
    return candidate;
  }

  private isNearBase(x: number, y: number): boolean {
    return this.deps.isProtectedBasePoint(x, y);
  }

  private clampToArena(x: number, y: number): { x: number; y: number } {
    const minX = ARENA_OFFSET_X + ARENA_EDGE_MARGIN_PX;
    const maxX = ARENA_OFFSET_X + GRID_COLS * CELL_SIZE - ARENA_EDGE_MARGIN_PX;
    const minY = ARENA_OFFSET_Y + ARENA_EDGE_MARGIN_PX;
    const maxY = ARENA_OFFSET_Y + GRID_ROWS * CELL_SIZE - ARENA_EDGE_MARGIN_PX;
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y)),
    };
  }
}

/** Abstand-Check für die Basis-Meidung: Bounding-Box + 1 Zelle Rand. */
export function isPointNearBaseRegion(
  x: number,
  y: number,
  baseBounds: readonly { x: number; y: number; width: number; height: number }[],
): boolean {
  for (const bounds of baseBounds) {
    if (
      x >= bounds.x - BASE_AVOID_MARGIN_PX
      && x <= bounds.x + bounds.width + BASE_AVOID_MARGIN_PX
      && y >= bounds.y - BASE_AVOID_MARGIN_PX
      && y <= bounds.y + bounds.height + BASE_AVOID_MARGIN_PX
    ) return true;
  }
  return false;
}
