import Phaser from 'phaser';
import {
  CELL_SIZE, GRID_COLS, GRID_ROWS,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH, ARENA_HEIGHT,
} from '../config';
import type { ArenaLayout, SyncedNukeStrike, SyncedPowerUp } from '../types';
import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatSystem }  from '../systems/CombatSystem';
import {
  POWERUP_DEFS, DROP_TABLES, SCHEDULED_SPAWNS,
  PICKUP_RADIUS, NUKE_CONFIG,
  type PowerUpDef, type DropTable,
} from './PowerUpConfig';

// ── Internes Tracking eines aktiven Buffs ──────────────────────────────────

interface ActiveBuff {
  defId:      string;
  multiplier: number;
  expiresAt:  number; // Date.now()-Timestamp
}

// ── Internes Tracking eines World-Items ────────────────────────────────────

interface WorldItem {
  uid:  number;
  def:  PowerUpDef;
  x:    number; // Welt-Koordinate
  y:    number;
}

interface ActiveNukeStrike {
  id:          number;
  x:           number;
  y:           number;
  radius:      number;
  armedAt:     number;
  explodeAt:   number;
  triggeredBy: string;
}

interface PowerUpSystemOptions {
  onNukeExploded?: (x: number, y: number, radius: number, triggeredBy: string) => void;
  onHolyHandGrenadePickup?: (playerId: string) => void;
  onBfgPickup?: (playerId: string) => void;
}

// ── Helper: Gewichtungsbasierte Zufallsauswahl ─────────────────────────────

function weightedRandom(weights: Record<string, number>): string | null {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [id, w] of entries) {
    roll -= w;
    if (roll <= 0) return id;
  }
  return entries[entries.length - 1][0]; // Sicherheits-Fallback
}

// ── PowerUpSystem ──────────────────────────────────────────────────────────

type PowerUpSystemDeps = Pick<CombatSystem, 'healToFull' | 'isAlive' | 'applyDamage'>;

/**
 * Host-autoritäres System für Power-Ups auf dem Boden und aktive Buffs.
 *
 * Clients rendern nur: {@link getNetSnapshot} liefert SyncedPowerUp[].
 * Pickup-Validierung, Buff-Vergabe und -Ablauf laufen ausschließlich auf dem Host.
 */
export class PowerUpSystem {
  private worldItems  = new Map<number, WorldItem>();
  private activeBuffs = new Map<string, ActiveBuff[]>(); // playerId → Buffs
  private activeNukes = new Map<number, ActiveNukeStrike>();
  private nextUid     = 1;
  private nextNukeId  = 1;

  // Scheduled-Spawn-Tracking
  private arenaStartTime         = 0;
  private scheduledSpawnsFired   = new Set<number>(); // Indices bereits ausgelöster Einträge

  constructor(
    private playerManager: PlayerManager,
    private combat:        PowerUpSystemDeps,
    private layout:        ArenaLayout,
    private options:       PowerUpSystemOptions = {},
  ) {}

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Aufrufen bei Rundenstart, um den Timer für Scheduled Spawns zu starten. */
  setArenaStartTime(ts: number): void {
    this.arenaStartTime = ts;
  }

  /** Komplett zurücksetzen (Rundenende / Teardown). */
  reset(): void {
    this.worldItems.clear();
    this.activeBuffs.clear();
    this.activeNukes.clear();
    this.nextUid = 1;
    this.nextNukeId = 1;
    this.arenaStartTime = 0;
    this.scheduledSpawnsFired.clear();
  }

  /** Buffs eines abgehenden Spielers aufräumen. */
  removePlayer(id: string): void {
    this.activeBuffs.delete(id);
  }

  // ── Host-Update (jeden Frame) ───────────────────────────────────────────

  update(_delta: number): void {
    const now = Date.now();

    // 1) Abgelaufene Buffs entfernen
    for (const [pid, buffs] of this.activeBuffs) {
      const filtered = buffs.filter(b => b.expiresAt > now);
      if (filtered.length === 0) {
        this.activeBuffs.delete(pid);
      } else {
        this.activeBuffs.set(pid, filtered);
      }
    }

    // 2) Scheduled Spawns prüfen
    if (this.arenaStartTime > 0) {
      const elapsed = (now - this.arenaStartTime) / 1000;
      for (let i = 0; i < SCHEDULED_SPAWNS.length; i++) {
        if (this.scheduledSpawnsFired.has(i)) continue;
        if (elapsed >= SCHEDULED_SPAWNS[i].timeSeconds) {
          this.scheduledSpawnsFired.add(i);
          for (let n = 0; n < SCHEDULED_SPAWNS[i].amount; n++) {
            this.spawnFromTable('SCHEDULED_EVENT');
          }
        }
      }
    }

    // 3) Fällige Nukes detonieren lassen
    for (const [id, strike] of this.activeNukes) {
      if (now < strike.explodeAt) continue;
      this.explodeNuke(strike);
      this.activeNukes.delete(id);
    }
  }

  // ── Spawning ────────────────────────────────────────────────────────────

  /**
   * Würfelt anhand der Drop-Table und erzeugt ggf. ein World-Item.
   * `fixedX / fixedY` = Welt-Koordinaten (z.B. Todesposition, Fels-Mitte).
   * Wenn nicht angegeben, wird eine zufällige freie Zelle gewählt.
   */
  spawnFromTable(tableName: string, fixedX?: number, fixedY?: number): void {
    const table: DropTable | undefined = DROP_TABLES[tableName];
    if (!table) return;

    // Chance prüfen
    const chance = table.chanceToDrop ?? 1.0;
    if (Math.random() > chance) return;

    const defId = weightedRandom(table.items);
    if (!defId) return;
    const def = POWERUP_DEFS[defId];
    if (!def) return;

    let x: number;
    let y: number;
    if (fixedX !== undefined && fixedY !== undefined) {
      x = fixedX;
      y = fixedY;
    } else {
      const cell = this.getRandomFreeCell();
      x = ARENA_OFFSET_X + cell.gx * CELL_SIZE + CELL_SIZE / 2;
      y = ARENA_OFFSET_Y + cell.gy * CELL_SIZE + CELL_SIZE / 2;
    }

    const uid = this.nextUid++;
    this.worldItems.set(uid, { uid, def, x, y });
  }

  /** Callback: Ein Spieler wurde getötet → Drop an Todesposition. */
  onPlayerKilled(x: number, y: number): void {
    this.spawnFromTable('ENEMY_KILL', x, y);
  }

  /** Callback: Ein Fels wurde zerstört → Drop an Fels-Mitte. */
  onRockDestroyed(rockId: number): void {
    const rock = this.layout.rocks[rockId];
    if (!rock) return;
    const wx = ARENA_OFFSET_X + rock.gridX * CELL_SIZE + CELL_SIZE / 2;
    const wy = ARENA_OFFSET_Y + rock.gridY * CELL_SIZE + CELL_SIZE / 2;
    this.spawnFromTable('ROCK_DESTROY', wx, wy);
  }

  // ── Pickup ──────────────────────────────────────────────────────────────

  /**
   * Vom Host aufgerufen, wenn ein Client `pickup_powerup` sendet.
   * Validiert Existenz + Nähe, entfernt das Item und wendet den Effekt an.
   */
  tryPickup(playerId: string, uid: number, playerX: number, playerY: number): void {
    const item = this.worldItems.get(uid);
    if (!item) return; // Existiert nicht (mehr)
    if (!this.combat.isAlive(playerId)) return; // Toter Spieler darf nicht aufheben

    const dist = Phaser.Math.Distance.Between(playerX, playerY, item.x, item.y);
    if (dist > PICKUP_RADIUS * 2) return; // Zu weit weg → ignorieren (großzügiger Check)

    this.worldItems.delete(uid);
    this.applyEffect(playerId, item.def);
  }

  // ── Effekt-Anwendung ────────────────────────────────────────────────────

  private applyEffect(playerId: string, def: PowerUpDef): void {
    switch (def.type) {
      case 'instant_heal':
        this.combat.healToFull(playerId);
        break;
      case 'buff_regen':
      case 'buff_damage': {
        const buffs = this.activeBuffs.get(playerId) ?? [];
        // Gleichen Buff-Typ auffrischen statt stacken
        const existing = buffs.find(b => b.defId === def.id);
        if (existing) {
          existing.expiresAt = Date.now() + (def.durationMs ?? 0);
          existing.multiplier = def.multiplier ?? 1;
        } else {
          buffs.push({
            defId:      def.id,
            multiplier: def.multiplier ?? 1,
            expiresAt:  Date.now() + (def.durationMs ?? 0),
          });
        }
        this.activeBuffs.set(playerId, buffs);
        break;
      }
      case 'global_nuke':
        this.armNukeStrike(playerId);
        break;
      case 'holy_hand_grenade':
        this.options.onHolyHandGrenadePickup?.(playerId);
        break;
      case 'bfg':
        this.options.onBfgPickup?.(playerId);
        break;
    }
  }

  private armNukeStrike(playerId: string): void {
    const owner = this.playerManager.getPlayer(playerId);
    if (!owner) return;

    const spawn = this.findNukeSpawnPoint(owner.sprite.x, owner.sprite.y);
    const armedAt = Date.now();
    const strike: ActiveNukeStrike = {
      id:          this.nextNukeId++,
      x:           spawn.x,
      y:           spawn.y,
      radius:      NUKE_CONFIG.radius,
      armedAt,
      explodeAt:   armedAt + NUKE_CONFIG.countdownMs,
      triggeredBy: playerId,
    };

    this.activeNukes.set(strike.id, strike);
  }

  private explodeNuke(strike: ActiveNukeStrike): void {
    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.combat.isAlive(player.id)) continue;

      const dist = Phaser.Math.Distance.Between(strike.x, strike.y, player.sprite.x, player.sprite.y);
      if (dist > strike.radius) continue;

      const clampedT = Phaser.Math.Clamp(dist / strike.radius, 0, 1);
      const damage = Phaser.Math.Linear(NUKE_CONFIG.maxDamage, NUKE_CONFIG.minDamage, clampedT);
      this.combat.applyDamage(player.id, Math.round(damage), false, strike.triggeredBy, 'Atombombe');
    }

    this.options.onNukeExploded?.(strike.x, strike.y, strike.radius, strike.triggeredBy);
  }

  // ── Buff-Abfragen (von anderen Systemen aufgerufen) ─────────────────────

  /** Multiplikator für Adrenalin-Regeneration (1 = kein Buff). */
  getRegenMultiplier(playerId: string): number {
    return this.getMultiplierForType(playerId, 'buff_regen');
  }

  /** Multiplikator für Waffen-Schaden (1 = kein Buff). */
  getDamageMultiplier(playerId: string): number {
    return this.getMultiplierForType(playerId, 'buff_damage');
  }

  /** Aktive Buffs mit Restdauer-Anteil für die HUD-Anzeige. */
  getActiveBuffsForHUD(playerId: string): { defId: string; remainingFrac: number }[] {
    const buffs = this.activeBuffs.get(playerId);
    if (!buffs) return [];
    const now = Date.now();
    const result: { defId: string; remainingFrac: number }[] = [];
    for (const b of buffs) {
      if (b.expiresAt <= now) continue;
      const def = POWERUP_DEFS[b.defId];
      if (!def?.durationMs) continue;
      const remaining = b.expiresAt - now;
      result.push({ defId: b.defId, remainingFrac: Math.min(1, remaining / def.durationMs) });
    }
    return result;
  }

  private getMultiplierForType(playerId: string, type: string): number {
    const buffs = this.activeBuffs.get(playerId);
    if (!buffs) return 1;
    const now = Date.now();
    for (const b of buffs) {
      if (b.expiresAt <= now) continue;
      const def = POWERUP_DEFS[b.defId];
      if (def?.type === type) return b.multiplier;
    }
    return 1;
  }

  // ── Netzwerk-Snapshot ───────────────────────────────────────────────────

  getNetSnapshot(): SyncedPowerUp[] {
    const result: SyncedPowerUp[] = [];
    for (const item of this.worldItems.values()) {
      result.push({ uid: item.uid, defId: item.def.id, x: item.x, y: item.y });
    }
    return result;
  }

  getNukeSnapshot(): SyncedNukeStrike[] {
    const result: SyncedNukeStrike[] = [];
    for (const strike of this.activeNukes.values()) {
      result.push({
        id:          strike.id,
        x:           strike.x,
        y:           strike.y,
        radius:      strike.radius,
        armedAt:     strike.armedAt,
        explodeAt:   strike.explodeAt,
        triggeredBy: strike.triggeredBy,
      });
    }
    return result;
  }

  // ── Freie Zelle finden (analog PlayerManager.getSpawnPoint) ─────────────

  private getRandomFreeCell(): { gx: number; gy: number } {
    const free = this.collectFreeCells(0);
    if (free.length === 0) return { gx: 0, gy: 0 };
    return free[Math.floor(Math.random() * free.length)];
  }

  private findNukeSpawnPoint(triggerX: number, triggerY: number): { x: number; y: number } {
    const preferred = this.collectFreeCells(NUKE_CONFIG.edgePaddingPx)
      .map(cell => ({
        ...cell,
        dist: Phaser.Math.Distance.Between(triggerX, triggerY, this.cellToWorldX(cell.gx), this.cellToWorldY(cell.gy)),
      }));

    const outsideBlast = preferred.filter(cell => cell.dist > NUKE_CONFIG.radius);
    const primaryPool = outsideBlast.length > 0 ? outsideBlast : preferred;

    if (primaryPool.length > 0) {
      const sorted = [...primaryPool].sort((left, right) => right.dist - left.dist);
      const topCount = Math.max(1, Math.ceil(sorted.length * NUKE_CONFIG.farSpawnTopFraction));
      const pick = sorted[Math.floor(Math.random() * topCount)];
      return { x: this.cellToWorldX(pick.gx), y: this.cellToWorldY(pick.gy) };
    }

    const fallback = this.getRandomFreeCell();
    return { x: this.cellToWorldX(fallback.gx), y: this.cellToWorldY(fallback.gy) };
  }

  private collectFreeCells(edgePaddingPx: number): Array<{ gx: number; gy: number }> {
    const blocked = new Set<string>();

    for (const r of this.layout.rocks) blocked.add(`${r.gridX}_${r.gridY}`);
    for (const t of this.layout.trees) blocked.add(`${t.gridX}_${t.gridY}`);

    for (const p of this.playerManager.getAllPlayers()) {
      if (!p.sprite.active) continue;
      const gx = Math.floor((p.sprite.x - ARENA_OFFSET_X) / CELL_SIZE);
      const gy = Math.floor((p.sprite.y - ARENA_OFFSET_Y) / CELL_SIZE);
      blocked.add(`${gx}_${gy}`);
    }

    for (const item of this.worldItems.values()) {
      const gx = Math.floor((item.x - ARENA_OFFSET_X) / CELL_SIZE);
      const gy = Math.floor((item.y - ARENA_OFFSET_Y) / CELL_SIZE);
      blocked.add(`${gx}_${gy}`);
    }

    for (const strike of this.activeNukes.values()) {
      const gx = Math.floor((strike.x - ARENA_OFFSET_X) / CELL_SIZE);
      const gy = Math.floor((strike.y - ARENA_OFFSET_Y) / CELL_SIZE);
      blocked.add(`${gx}_${gy}`);
    }

    const minX = ARENA_OFFSET_X + edgePaddingPx;
    const maxX = ARENA_OFFSET_X + ARENA_WIDTH - edgePaddingPx;
    const minY = ARENA_OFFSET_Y + edgePaddingPx;
    const maxY = ARENA_OFFSET_Y + ARENA_HEIGHT - edgePaddingPx;

    const free: Array<{ gx: number; gy: number }> = [];
    for (let gy = 0; gy < GRID_ROWS; gy++) {
      for (let gx = 0; gx < GRID_COLS; gx++) {
        if (blocked.has(`${gx}_${gy}`)) continue;

        const wx = this.cellToWorldX(gx);
        const wy = this.cellToWorldY(gy);
        if (wx < minX || wx > maxX || wy < minY || wy > maxY) continue;

        free.push({ gx, gy });
      }
    }

    return free;
  }

  private cellToWorldX(gx: number): number {
    return ARENA_OFFSET_X + gx * CELL_SIZE + CELL_SIZE / 2;
  }

  private cellToWorldY(gy: number): number {
    return ARENA_OFFSET_Y + gy * CELL_SIZE + CELL_SIZE / 2;
  }
}
