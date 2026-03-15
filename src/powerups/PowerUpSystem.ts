import Phaser from 'phaser';
import {
  CELL_SIZE, GRID_COLS, GRID_ROWS,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  HP_MAX,
} from '../config';
import type { ArenaLayout, SyncedPowerUp } from '../types';
import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatSystem }  from '../systems/CombatSystem';
import type { NetworkBridge }  from '../network/NetworkBridge';
import {
  POWERUP_DEFS, DROP_TABLES, SCHEDULED_SPAWNS,
  PICKUP_RADIUS,
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

type PowerUpSystemDeps = Pick<CombatSystem, 'healToFull' | 'isAlive'>;

/**
 * Host-autoritäres System für Power-Ups auf dem Boden und aktive Buffs.
 *
 * Clients rendern nur: {@link getNetSnapshot} liefert SyncedPowerUp[].
 * Pickup-Validierung, Buff-Vergabe und -Ablauf laufen ausschließlich auf dem Host.
 */
export class PowerUpSystem {
  private worldItems  = new Map<number, WorldItem>();
  private activeBuffs = new Map<string, ActiveBuff[]>(); // playerId → Buffs
  private nextUid     = 1;

  // Scheduled-Spawn-Tracking
  private arenaStartTime         = 0;
  private scheduledSpawnsFired   = new Set<number>(); // Indices bereits ausgelöster Einträge

  constructor(
    private playerManager: PlayerManager,
    private combat:        PowerUpSystemDeps,
    private layout:        ArenaLayout,
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
    this.nextUid = 1;
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
    }
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

  // ── Freie Zelle finden (analog PlayerManager.getSpawnPoint) ─────────────

  private getRandomFreeCell(): { gx: number; gy: number } {
    const blocked = new Set<string>();

    for (const r of this.layout.rocks) blocked.add(`${r.gridX}_${r.gridY}`);
    for (const t of this.layout.trees) blocked.add(`${t.gridX}_${t.gridY}`);

    // Spieler-Zellen ebenfalls ausschließen
    for (const p of this.playerManager.getAllPlayers()) {
      if (!p.sprite.active) continue;
      const gx = Math.floor((p.sprite.x - ARENA_OFFSET_X) / CELL_SIZE);
      const gy = Math.floor((p.sprite.y - ARENA_OFFSET_Y) / CELL_SIZE);
      blocked.add(`${gx}_${gy}`);
    }

    // Bereits liegende Power-Ups ausschließen
    for (const item of this.worldItems.values()) {
      const gx = Math.floor((item.x - ARENA_OFFSET_X) / CELL_SIZE);
      const gy = Math.floor((item.y - ARENA_OFFSET_Y) / CELL_SIZE);
      blocked.add(`${gx}_${gy}`);
    }

    const free: Array<{ gx: number; gy: number }> = [];
    for (let gy = 0; gy < GRID_ROWS; gy++) {
      for (let gx = 0; gx < GRID_COLS; gx++) {
        if (!blocked.has(`${gx}_${gy}`)) {
          free.push({ gx, gy });
        }
      }
    }

    if (free.length === 0) return { gx: 0, gy: 0 };
    return free[Math.floor(Math.random() * free.length)];
  }
}
