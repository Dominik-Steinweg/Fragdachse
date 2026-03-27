import Phaser from 'phaser';
import {
  CELL_SIZE, GRID_COLS, GRID_ROWS,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH, ARENA_HEIGHT,
} from '../config';
import type { ArenaLayout, SyncedNukeStrike, SyncedPowerUp, SyncedPowerUpPedestal } from '../types';
import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatSystem }  from '../systems/CombatSystem';
import {
  POWERUP_DEFS, DROP_TABLES, TIMED_POWERUP_PEDESTAL_CONFIGS,
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

interface PedestalRuntime {
  id: number;
  def: PowerUpDef;
  x: number;
  y: number;
  respawnMs: number;
  spawnOnArenaStart: boolean;
  currentUid: number | null;
  nextRespawnAt: number;
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
  onNukePickup?: (playerId: string) => void;
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

type PowerUpSystemDeps = Pick<CombatSystem, 'healToFull' | 'addArmor' | 'isAlive' | 'isBurrowed' | 'applyDamage' | 'applyExplosionDamage'>;

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
  private pedestals   = new Map<number, PedestalRuntime>();
  private itemToPedestal = new Map<number, number>();
  private nextUid     = 1;
  private nextNukeId  = 1;

  private arenaStartTime = 0;
  private pedestalsActivated = false;

  constructor(
    private playerManager: PlayerManager,
    private combat:        PowerUpSystemDeps,
    private layout:        ArenaLayout,
    private options:       PowerUpSystemOptions = {},
  ) {
    this.buildPedestals();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Aufrufen bei Rundenstart, um die host-autoritären Podest-Timer zu starten. */
  setArenaStartTime(ts: number): void {
    this.arenaStartTime = ts;
    this.pedestalsActivated = false;
    for (const pedestal of this.pedestals.values()) {
      pedestal.currentUid = null;
      pedestal.nextRespawnAt = pedestal.spawnOnArenaStart ? 0 : (ts > 0 ? ts + pedestal.respawnMs : 0);
    }
  }

  /** Komplett zurücksetzen (Rundenende / Teardown). */
  reset(): void {
    this.worldItems.clear();
    this.activeBuffs.clear();
    this.activeNukes.clear();
    this.itemToPedestal.clear();
    this.nextUid = 1;
    this.nextNukeId = 1;
    this.arenaStartTime = 0;
    this.pedestalsActivated = false;
    for (const pedestal of this.pedestals.values()) {
      pedestal.currentUid = null;
      pedestal.nextRespawnAt = 0;
    }
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

    // 2) Feste Podeste aktivieren und respawnen
    if (this.arenaStartTime > 0) {
      if (!this.pedestalsActivated && now >= this.arenaStartTime) {
        this.pedestalsActivated = true;
        for (const pedestal of this.pedestals.values()) {
          if (pedestal.spawnOnArenaStart) {
            this.spawnPedestalItem(pedestal);
          }
        }
      }

      for (const pedestal of this.pedestals.values()) {
        if (pedestal.currentUid !== null) continue;
        if (pedestal.nextRespawnAt <= 0) continue;
        if (now < pedestal.nextRespawnAt) continue;
        this.spawnPedestalItem(pedestal);
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

    this.spawnPowerUpDef(def, x, y);
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
    if (this.combat.isBurrowed(playerId)) return; // Eingebuddelte Spieler dürfen nichts einsammeln

    const dist = Phaser.Math.Distance.Between(playerX, playerY, item.x, item.y);
    if (dist > PICKUP_RADIUS * 2) return; // Zu weit weg → ignorieren (großzügiger Check)

    this.worldItems.delete(uid);
    const pedestalId = this.itemToPedestal.get(uid);
    if (pedestalId !== undefined) {
      const pedestal = this.pedestals.get(pedestalId);
      if (pedestal) {
        pedestal.currentUid = null;
        pedestal.nextRespawnAt = Date.now() + pedestal.respawnMs;
      }
      this.itemToPedestal.delete(uid);
    }
    this.applyEffect(playerId, item.def);
  }

  // ── Effekt-Anwendung ────────────────────────────────────────────────────

  private applyEffect(playerId: string, def: PowerUpDef): void {
    switch (def.type) {
      case 'instant_heal':
        this.combat.healToFull(playerId);
        break;
      case 'instant_armor':
        this.combat.addArmor(playerId, def.amount ?? 0);
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
        this.options.onNukePickup?.(playerId);
        break;
      case 'holy_hand_grenade':
        this.options.onHolyHandGrenadePickup?.(playerId);
        break;
      case 'bfg':
        this.options.onBfgPickup?.(playerId);
        break;
    }
  }

  scheduleNukeStrike(playerId: string, targetX: number, targetY: number): boolean {
    const owner = this.playerManager.getPlayer(playerId);
    if (!owner || !this.combat.isAlive(playerId)) return false;

    const spawn = this.clampNukePoint(targetX, targetY);
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
    return true;
  }

  private explodeNuke(strike: ActiveNukeStrike): void {
    this.combat.applyExplosionDamage(strike.x, strike.y, {
      radius: strike.radius,
      maxDamage: NUKE_CONFIG.maxDamage,
      minDamage: NUKE_CONFIG.minDamage,
      knockback: 0,
      selfDamageMult: 1,
    }, strike.triggeredBy, 'utility', 'Atombombe');

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

  getPedestalSnapshot(): SyncedPowerUpPedestal[] {
    const result: SyncedPowerUpPedestal[] = [];
    for (const pedestal of this.pedestals.values()) {
      result.push({
        id: pedestal.id,
        defId: pedestal.def.id,
        x: pedestal.x,
        y: pedestal.y,
        hasPowerUp: pedestal.currentUid !== null,
        nextRespawnAt: pedestal.currentUid === null ? pedestal.nextRespawnAt : 0,
      });
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

  private clampNukePoint(x: number, y: number): { x: number; y: number } {
    return {
      x: Phaser.Math.Clamp(x, ARENA_OFFSET_X, ARENA_OFFSET_X + ARENA_WIDTH),
      y: Phaser.Math.Clamp(y, ARENA_OFFSET_Y, ARENA_OFFSET_Y + ARENA_HEIGHT),
    };
  }

  private collectFreeCells(edgePaddingPx: number): Array<{ gx: number; gy: number }> {
    const blocked = new Set<string>();

    for (const r of this.layout.rocks) blocked.add(`${r.gridX}_${r.gridY}`);
    for (const t of this.layout.trees) blocked.add(`${t.gridX}_${t.gridY}`);
    for (const track of this.layout.tracks) {
      blocked.add(`${track.gridX}_${track.gridY}`);
      blocked.add(`${track.gridX + 1}_${track.gridY}`);
    }
    for (const pedestal of this.layout.powerUpPedestals) {
      blocked.add(`${pedestal.gridX}_${pedestal.gridY}`);
    }

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

  private buildPedestals(): void {
    this.pedestals.clear();
    for (const cell of this.layout.powerUpPedestals) {
      const def = POWERUP_DEFS[cell.defId];
      const cfg = TIMED_POWERUP_PEDESTAL_CONFIGS[cell.defId];
      if (!def || !cfg) continue;

      this.pedestals.set(cell.id, {
        id: cell.id,
        def,
        x: this.cellToWorldX(cell.gridX),
        y: this.cellToWorldY(cell.gridY),
        respawnMs: cfg.respawnMs,
        spawnOnArenaStart: cfg.spawnOnArenaStart,
        currentUid: null,
        nextRespawnAt: 0,
      });
    }
  }

  private spawnPowerUpDef(def: PowerUpDef, x: number, y: number): number {
    const uid = this.nextUid++;
    this.worldItems.set(uid, { uid, def, x, y });
    return uid;
  }

  private spawnPedestalItem(pedestal: PedestalRuntime): void {
    if (pedestal.currentUid !== null) return;
    const uid = this.spawnPowerUpDef(pedestal.def, pedestal.x, pedestal.y);
    pedestal.currentUid = uid;
    pedestal.nextRespawnAt = 0;
    this.itemToPedestal.set(uid, pedestal.id);
  }
}
