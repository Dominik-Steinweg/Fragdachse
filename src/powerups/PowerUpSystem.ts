import * as Phaser from 'phaser';
import {
  CELL_SIZE, GRID_COLS, GRID_ROWS,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH, ARENA_HEIGHT,
  POWERUP_NET_FULL_SNAPSHOT_INTERVAL_TICKS,
} from '../config';
import type { ArenaLayout, ExplosionDamageTarget, SyncedNukeStrike, SyncedPowerUp, SyncedPowerUpPedestal, SyncedPowerUpPedestalSnapshot, SyncedPowerUpSnapshot } from '../types';
import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatSystem }  from '../systems/CombatSystem';
import {
  POWERUP_DEFS, DROP_TABLES, TIMED_POWERUP_PEDESTAL_CONFIGS,
  PICKUP_RADIUS, NUKE_CONFIG,
  type PowerUpDef, type DropTable,
} from './PowerUpConfig';
import { getAdrenalineSyringeDropChance } from '../utils/adrenalineDrops';

// ── Internes Tracking eines aktiven Buffs ──────────────────────────────────

interface ActiveBuff {
  defId:      string;
  multiplier: number;
  expiresAt:  number; // Date.now()-Timestamp
  durationMs: number;
}

// ── Internes Tracking eines World-Items ────────────────────────────────────

interface WorldItem {
  uid:  number;
  def:  PowerUpDef;
  x:    number; // Welt-Koordinate
  y:    number;
  pickupKind?: 'objective-marker' | 'objective-placement';
  objectiveId?: string;
}

interface PedestalRuntime {
  id: number;
  constructionId?: number;
  def: PowerUpDef;
  x: number;
  y: number;
  ownerColor?: number;
  respawnMs: number;
  spawnOnArenaStart: boolean;
  linkedBaseId?: string;
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
  variant: 'normal' | 'void';
  maxDamage: number;
  minDamage: number;
  allowTeamDamage: boolean;
  damageTarget?: ExplosionDamageTarget;
  damageOwnerId: string;
  sourceId: string;
}

export interface ConfiguredNukeStrike {
  readonly countdownMs: number;
  readonly radius: number;
  readonly maxDamage: number;
  readonly minDamage: number;
  readonly allowTeamDamage: boolean;
  readonly damageTarget?: ExplosionDamageTarget;
  readonly damageOwnerId?: string;
  readonly sourceId?: string;
  readonly variant?: 'normal' | 'void';
}

interface PowerUpSystemOptions {
  onPickupCollected?: (playerId: string) => void;
  onNukePickup?: (playerId: string) => boolean | void;
  onNukeExploded?: (x: number, y: number, radius: number, triggeredBy: string) => void;
  onConfiguredNukeExploded?: (strike: SyncedNukeStrike) => void;
  onHolyHandGrenadePickup?: (playerId: string) => boolean | void;
  onBfgPickup?: (playerId: string) => boolean | void;
  /** Claims a mission reward without applying the referenced PowerUpDef directly. */
  onObjectiveRewardPickup?: (objectiveId: string, playerId: string) => boolean;
  /** Finite XP plus a clearly documented round-duration estimate for persistent pressure. */
  coopDefenseMapXpReference?: number;
  isAdrenalineDropEnabled?: (playerId: string) => boolean;
  getAdrenalineDropChanceMultiplier?: (playerId: string) => number;
  getAdrenalineSyringeDurationMultiplier?: (playerId: string) => number;
  /** B2 gate for linked pedestals; unlinked pedestals remain unchanged. */
  isLinkedBaseActive?: (baseId: string) => boolean;
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
  private readonly netSnapshotCache = new Map<number, SyncedPowerUp>();
  private readonly pendingRemovalUids = new Set<number>();
  private readonly objectiveMarkerUids = new Map<string, number>();
  private readonly objectiveRewardUids = new Map<string, number>();
  private activeBuffs = new Map<string, ActiveBuff[]>(); // playerId → Buffs
  private activeNukes = new Map<number, ActiveNukeStrike>();
  private pedestals   = new Map<number, PedestalRuntime>();
  private itemToPedestal = new Map<number, number>();
  private readonly constructionPedestalIds = new Map<number, number>();
  private nextDynamicPedestalId = 0;
  private nextUid     = 1;
  private nextNukeId  = 1;
  private ticksSinceFullNetSnapshot = POWERUP_NET_FULL_SNAPSHOT_INTERVAL_TICKS;
  // Delta-Cache der Podeste: id → Signatur des zuletzt gesendeten Zustands (hasPowerUp|nextRespawnAt).
  private readonly pedestalNetCache = new Map<number, string>();
  private readonly pendingPedestalRemovalIds = new Set<number>();
  private ticksSinceFullPedestalSnapshot = POWERUP_NET_FULL_SNAPSHOT_INTERVAL_TICKS;
  private forceFullNetSnapshot = false;
  private constructionRespawnMultiplierProvider: ((constructionId: number) => number) | null = null;

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
    this.netSnapshotCache.clear();
    this.pendingRemovalUids.clear();
    this.objectiveMarkerUids.clear();
    this.objectiveRewardUids.clear();
    this.activeBuffs.clear();
    this.activeNukes.clear();
    this.itemToPedestal.clear();
    for (const pedestalId of this.constructionPedestalIds.values()) {
      this.pedestals.delete(pedestalId);
    }
    this.constructionPedestalIds.clear();
    this.nextDynamicPedestalId = this.getInitialDynamicPedestalId();
    this.nextUid = 1;
    this.nextNukeId = 1;
    this.ticksSinceFullNetSnapshot = POWERUP_NET_FULL_SNAPSHOT_INTERVAL_TICKS;
    this.pedestalNetCache.clear();
    this.pendingPedestalRemovalIds.clear();
    this.ticksSinceFullPedestalSnapshot = POWERUP_NET_FULL_SNAPSHOT_INTERVAL_TICKS;
    this.forceFullNetSnapshot = false;
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

  /** Entfernt alle Podeste und eventuell darauf liegenden Power-Ups einer zerstörten Basis. */
  destroyPedestalsLinkedToBase(baseId: string): void {
    for (const [pedestalId, pedestal] of [...this.pedestals]) {
      if (pedestal.linkedBaseId !== baseId) continue;
      this.removePedestal(pedestalId);
    }
  }

  setConstructionRespawnMultiplierProvider(provider: ((constructionId: number) => number) | null): void {
    this.constructionRespawnMultiplierProvider = provider;
  }

  /**
   * Bindet ein gebautes Inspector-Podest an den bestehenden Power-up-Lifecycle.
   * Das erste Item liegt unmittelbar nach erfolgreicher Registrierung bereit.
   */
  registerConstructionPedestal(
    constructionId: number,
    defId: string,
    x: number,
    y: number,
    ownerColor?: number,
  ): boolean {
    const existingId = this.constructionPedestalIds.get(constructionId);
    if (existingId !== undefined) return this.pedestals.has(existingId);

    const def = POWERUP_DEFS[defId];
    const cfg = TIMED_POWERUP_PEDESTAL_CONFIGS[defId];
    if (!def || !cfg) return false;

    while (this.pedestals.has(this.nextDynamicPedestalId)) this.nextDynamicPedestalId += 1;
    const pedestalId = this.nextDynamicPedestalId++;
    const pedestal: PedestalRuntime = {
      id: pedestalId,
      constructionId,
      def,
      x,
      y,
      ownerColor,
      respawnMs: Math.max(1, Math.floor(cfg.respawnMs)),
      spawnOnArenaStart: true,
      currentUid: null,
      nextRespawnAt: 0,
    };
    this.pedestals.set(pedestalId, pedestal);
    this.constructionPedestalIds.set(constructionId, pedestalId);
    this.pendingPedestalRemovalIds.delete(pedestalId);
    this.spawnPedestalItem(pedestal);
    return true;
  }

  /** Entfernt ein gebautes Podest samt eventuell darauf liegendem Item. */
  unregisterConstructionPedestal(constructionId: number): boolean {
    const pedestalId = this.constructionPedestalIds.get(constructionId);
    if (pedestalId === undefined) return false;
    this.constructionPedestalIds.delete(constructionId);
    return this.removePedestal(pedestalId);
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
          if (pedestal.spawnOnArenaStart && pedestal.currentUid === null && pedestal.nextRespawnAt <= 0) {
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
  spawnFromTable(tableName: string, fixedX?: number, fixedY?: number, chanceMultiplier = 1): void {
    const table: DropTable | undefined = DROP_TABLES[tableName];
    if (!table) return;

    // Chance prüfen
    const chance = (table.chanceToDrop ?? 1.0) * chanceMultiplier;
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

  onCoopDefenseEnemyKilled(killerId: string, enemyXp: number, x: number, y: number): void {
    if (!this.options.isAdrenalineDropEnabled?.(killerId)) return;
    const multiplier = Math.max(0, this.options.getAdrenalineDropChanceMultiplier?.(killerId) ?? 1);
    const chance = getAdrenalineSyringeDropChance(
      enemyXp,
      this.options.coopDefenseMapXpReference ?? 1,
      multiplier,
    );
    if (Math.random() >= chance) return;
    this.spawnPowerUpDef(POWERUP_DEFS.ADRENALINE, x, y);
  }

  /** Callback: Ein Fels wurde zerstört → Drop an Fels-Mitte. */
  onRockDestroyed(rockId: number): void {
    const rock = this.layout.rocks[rockId];
    if (!rock) return;
    const wx = ARENA_OFFSET_X + rock.gridX * CELL_SIZE + CELL_SIZE / 2;
    const wy = ARENA_OFFSET_Y + rock.gridY * CELL_SIZE + CELL_SIZE / 2;
    this.spawnFromTable('ROCK_DESTROY', wx, wy, rock.armorDropMult ?? 1);
  }

  // ── Pickup ──────────────────────────────────────────────────────────────

  /**
   * Vom Host aufgerufen, wenn ein Client `pickup_powerup` sendet.
   * Validiert Existenz + Nähe, entfernt das Item und wendet den Effekt an.
   */
  /** Marks a Hold target's future reward location without creating an interactable pickup. */
  spawnObjectiveRewardMarker(objectiveId: string, defId: string, x: number, y: number): number | null {
    const def = POWERUP_DEFS[defId];
    if (!def || !TIMED_POWERUP_PEDESTAL_CONFIGS[defId]) return null;
    const existingUid = this.objectiveMarkerUids.get(objectiveId);
    if (existingUid !== undefined && this.worldItems.has(existingUid)) return existingUid;

    const uid = this.spawnPowerUpDef(def, x, y, {
      pickupKind: 'objective-marker',
      objectiveId,
    });
    this.objectiveMarkerUids.set(objectiveId, uid);
    return uid;
  }

  /**
   * Spawns the visible team reward above its persistent mission marker. It is tagged separately
   * from normal PowerUps so a client cannot interpret a Holy Hand Grenade reward as an instant HHG.
   */
  spawnObjectiveRewardPickup(objectiveId: string, defId: string, x: number, y: number): number | null {
    const def = POWERUP_DEFS[defId];
    if (!def || !TIMED_POWERUP_PEDESTAL_CONFIGS[defId]) return null;
    const existingUid = this.objectiveRewardUids.get(objectiveId);
    const existing = existingUid === undefined ? undefined : this.worldItems.get(existingUid);
    if (existing?.pickupKind === 'objective-placement') return existing.uid;

    const uid = this.spawnPowerUpDef(def, x, y, {
      pickupKind: 'objective-placement',
      objectiveId,
    });
    this.objectiveRewardUids.set(objectiveId, uid);
    return uid;
  }

  /** Removes a mission marker and any unclaimed reward when its objective becomes unavailable. */
  clearObjectiveReward(objectiveId: string): boolean {
    const markerUid = this.objectiveMarkerUids.get(objectiveId);
    const rewardUid = this.objectiveRewardUids.get(objectiveId);
    if (markerUid === undefined && rewardUid === undefined) return false;
    if (markerUid !== undefined) this.removeObjectiveWorldItem(markerUid);
    if (rewardUid !== undefined) this.removeObjectiveWorldItem(rewardUid);
    this.objectiveMarkerUids.delete(objectiveId);
    this.objectiveRewardUids.delete(objectiveId);
    return true;
  }

  tryPickup(playerId: string, uid: number, playerX: number, playerY: number): boolean {
    const item = this.worldItems.get(uid);
    if (!item) return false; // Existiert nicht (mehr)
    if (item.pickupKind === 'objective-marker') return false;
    if (!this.combat.isAlive(playerId)) return false; // Toter Spieler darf nicht aufheben
    if (this.combat.isBurrowed(playerId)) return false; // Eingebuddelte Spieler dürfen nichts einsammeln

    const dist = Phaser.Math.Distance.Between(playerX, playerY, item.x, item.y);
    if (dist > PICKUP_RADIUS * 2) return false; // Zu weit weg → ignorieren (großzügiger Check)

    const consumed = item.pickupKind === 'objective-placement'
      ? Boolean(item.objectiveId && this.options.onObjectiveRewardPickup?.(item.objectiveId, playerId))
      : this.applyEffect(playerId, item.def);
    if (!consumed) return false;

    this.worldItems.delete(uid);
    this.pendingRemovalUids.add(uid);
    this.netSnapshotCache.delete(uid);
    const pedestalId = this.itemToPedestal.get(uid);
    if (pedestalId !== undefined) {
      const pedestal = this.pedestals.get(pedestalId);
      if (pedestal) {
        pedestal.currentUid = null;
        const multiplier = pedestal.constructionId === undefined
          ? 1
          : Math.max(0.05, this.constructionRespawnMultiplierProvider?.(pedestal.constructionId) ?? 1);
        pedestal.nextRespawnAt = Date.now() + Math.max(1, Math.floor(pedestal.respawnMs * multiplier));
      }
      this.itemToPedestal.delete(uid);
    }
    if (item.pickupKind === 'objective-placement' && item.objectiveId) {
      if (this.objectiveRewardUids.get(item.objectiveId) === uid) {
        this.objectiveRewardUids.delete(item.objectiveId);
      }
    }
    this.options.onPickupCollected?.(playerId);
    return true;
  }

  // ── Effekt-Anwendung ────────────────────────────────────────────────────

  private applyEffect(playerId: string, def: PowerUpDef): boolean {
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
        const durationMultiplier = def.id === 'ADRENALINE'
          ? Math.max(0, this.options.getAdrenalineSyringeDurationMultiplier?.(playerId) ?? 1)
          : 1;
        const durationMs = Math.max(0, (def.durationMs ?? 0) * durationMultiplier);
        // Gleichen Buff-Typ auffrischen statt stacken
        const existing = buffs.find(b => b.defId === def.id);
        if (existing) {
          existing.expiresAt = Date.now() + durationMs;
          existing.multiplier = def.multiplier ?? 1;
          existing.durationMs = durationMs;
        } else {
          buffs.push({
            defId:      def.id,
            multiplier: def.multiplier ?? 1,
            expiresAt:  Date.now() + durationMs,
            durationMs,
          });
        }
        this.activeBuffs.set(playerId, buffs);
        break;
      }
      case 'global_nuke':
        return this.options.onNukePickup?.(playerId) !== false;
      case 'holy_hand_grenade':
        return this.options.onHolyHandGrenadePickup?.(playerId) !== false;
      case 'bfg':
        return this.options.onBfgPickup?.(playerId) !== false;
    }
    return true;
  }

  scheduleNukeStrike(playerId: string, targetX: number, targetY: number): boolean {
    const owner = this.playerManager.getPlayer(playerId);
    if (!owner || !this.combat.isAlive(playerId)) return false;
    return this.scheduleConfiguredNukeStrike(playerId, targetX, targetY, {
      countdownMs: NUKE_CONFIG.countdownMs,
      radius: NUKE_CONFIG.radius,
      maxDamage: NUKE_CONFIG.maxDamage,
      minDamage: NUKE_CONFIG.minDamage,
      allowTeamDamage: NUKE_CONFIG.allowTeamDamage,
      sourceId: 'powerup.NUKE',
    });
  }

  scheduleConfiguredNukeStrike(
    triggeredBy: string,
    targetX: number,
    targetY: number,
    config: ConfiguredNukeStrike,
    armedAt = Date.now(),
  ): boolean {
    const spawn = this.clampNukePoint(targetX, targetY);
    const strike: ActiveNukeStrike = {
      id:          this.nextNukeId++,
      x:           spawn.x,
      y:           spawn.y,
      radius:      config.radius,
      armedAt,
      explodeAt:   armedAt + config.countdownMs,
      triggeredBy,
      variant: config.variant ?? 'normal',
      maxDamage: config.maxDamage,
      minDamage: config.minDamage,
      allowTeamDamage: config.allowTeamDamage,
      damageTarget: config.damageTarget,
      damageOwnerId: config.damageOwnerId ?? triggeredBy,
      sourceId: config.sourceId ?? 'powerup.NUKE',
    };

    this.activeNukes.set(strike.id, strike);
    return true;
  }

  private explodeNuke(strike: ActiveNukeStrike): void {
    this.combat.applyExplosionDamage(strike.x, strike.y, {
      radius: strike.radius,
      maxDamage: strike.maxDamage,
      minDamage: strike.minDamage,
      knockback: 0,
      selfDamageMult: 1,
      allowTeamDamage: strike.allowTeamDamage,
      damageTarget: strike.damageTarget,
    }, strike.damageOwnerId, 'utility', strike.sourceId);

    if (strike.variant === 'normal') {
      this.options.onNukeExploded?.(strike.x, strike.y, strike.radius, strike.triggeredBy);
    }
    this.options.onConfiguredNukeExploded?.({
      id: strike.id,
      x: strike.x,
      y: strike.y,
      radius: strike.radius,
      armedAt: strike.armedAt,
      explodeAt: strike.explodeAt,
      triggeredBy: strike.triggeredBy,
      variant: strike.variant,
    });
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
      if (!def?.durationMs || b.durationMs <= 0) continue;
      const remaining = b.expiresAt - now;
      result.push({ defId: b.defId, remainingFrac: Math.min(1, remaining / b.durationMs) });
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

  getWorldItemSnapshot(): SyncedPowerUp[] {
    const result: SyncedPowerUp[] = [];
    for (const item of this.worldItems.values()) {
      result.push({
        uid: item.uid,
        defId: item.def.id,
        x: item.x,
        y: item.y,
        ...(item.pickupKind === undefined ? {} : { pickupKind: item.pickupKind }),
        ...(item.objectiveId === undefined ? {} : { objectiveId: item.objectiveId }),
      });
    }
    result.sort((left, right) => left.uid - right.uid);
    return result;
  }

  /** Naechster Netzwerk-Snapshot enthaelt Power-Ups und Podeste vollstaendig. */
  requestFullNetSnapshot(): void {
    this.forceFullNetSnapshot = true;
  }

  getNetSnapshot(): SyncedPowerUpSnapshot | null {
    const full = this.forceFullNetSnapshot
      || this.ticksSinceFullNetSnapshot >= POWERUP_NET_FULL_SNAPSHOT_INTERVAL_TICKS;
    const currentIds = new Set<number>();
    const upserts: SyncedPowerUp[] = [];

    for (const item of this.getWorldItemSnapshot()) {
      currentIds.add(item.uid);
      const previous = this.netSnapshotCache.get(item.uid);
      if (full || !previous) {
        upserts.push(item);
        this.netSnapshotCache.set(item.uid, item);
      }
    }

    const removals = full ? [] : [...this.pendingRemovalUids].sort((left, right) => left - right);

    if (full) {
      for (const uid of [...this.netSnapshotCache.keys()]) {
        if (!currentIds.has(uid)) this.netSnapshotCache.delete(uid);
      }
      this.ticksSinceFullNetSnapshot = 0;
    } else {
      this.ticksSinceFullNetSnapshot += 1;
      for (const uid of removals) {
        this.netSnapshotCache.delete(uid);
      }
    }

    this.pendingRemovalUids.clear();

    if (!full && upserts.length === 0 && removals.length === 0) return null;

    return {
      full,
      count: currentIds.size,
      upserts,
      removals,
    };
  }

  /** Voller Podest-Zustand für die host-lokale Darstellung (jeden Frame, kein Netzwerk). */
  getPedestalSnapshot(): SyncedPowerUpPedestal[] {
    const result: SyncedPowerUpPedestal[] = [];
    for (const pedestal of this.pedestals.values()) {
      result.push({
        id: pedestal.id,
        defId: pedestal.def.id,
        x: pedestal.x,
        y: pedestal.y,
        ...(pedestal.ownerColor === undefined ? {} : { ownerColor: pedestal.ownerColor }),
        hasPowerUp: pedestal.currentUid !== null,
        nextRespawnAt: pedestal.currentUid === null ? pedestal.nextRespawnAt : 0,
      });
    }
    return result;
  }

  /**
   * Delta-Snapshot der Podeste für die Übertragung. Sendet nur geänderte Podeste (plus periodischer
   * Full-Resync), statt das volle Array jeden Tick. Gibt null zurück, wenn nichts zu senden ist.
   */
  getPedestalNetSnapshot(): SyncedPowerUpPedestalSnapshot | null {
    const full = this.forceFullNetSnapshot
      || this.ticksSinceFullPedestalSnapshot >= POWERUP_NET_FULL_SNAPSHOT_INTERVAL_TICKS;
    const currentIds = new Set<number>();
    const upserts: SyncedPowerUpPedestal[] = [];

    for (const entry of this.getPedestalSnapshot()) {
      currentIds.add(entry.id);
      // Position/Typ sind statisch – nur der veränderliche Zustand bestimmt die Delta-Signatur.
      const signature = `${entry.ownerColor ?? ''}:${entry.hasPowerUp ? 1 : 0}:${entry.nextRespawnAt}`;
      if (full || this.pedestalNetCache.get(entry.id) !== signature) {
        upserts.push(entry);
        this.pedestalNetCache.set(entry.id, signature);
      }
    }

    const removals: number[] = full
      ? []
      : [...this.pendingPedestalRemovalIds].sort((left, right) => left - right);
    if (full) {
      for (const id of [...this.pedestalNetCache.keys()]) {
        if (!currentIds.has(id)) {
          this.pedestalNetCache.delete(id);
          removals.push(id);
        }
      }
      this.ticksSinceFullPedestalSnapshot = 0;
      this.forceFullNetSnapshot = false;
    } else {
      this.ticksSinceFullPedestalSnapshot += 1;
    }

    this.pendingPedestalRemovalIds.clear();

    if (!full && upserts.length === 0 && removals.length === 0) return null;

    return { full, upserts, removals };
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
        variant:     strike.variant,
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
      if (
        cell.linkedBaseId !== undefined
        && this.options.isLinkedBaseActive !== undefined
        && !this.options.isLinkedBaseActive(cell.linkedBaseId)
      ) continue;
      this.addLayoutPedestal(cell);
    }
    this.nextDynamicPedestalId = this.getInitialDynamicPedestalId();
  }

  /** Registers linked pedestals when their dormant base becomes active. */
  activatePedestalsLinkedToBase(baseId: string): void {
    for (const cell of this.layout.powerUpPedestals) {
      if (cell.linkedBaseId !== baseId || this.pedestals.has(cell.id)) continue;
      this.addLayoutPedestal(cell);
      const pedestal = this.pedestals.get(cell.id);
      if (!pedestal) continue;
      if (this.pedestalsActivated && pedestal.spawnOnArenaStart && pedestal.currentUid === null) {
        this.spawnPedestalItem(pedestal);
      }
    }
  }

  private addLayoutPedestal(cell: ArenaLayout['powerUpPedestals'][number]): void {
    const def = POWERUP_DEFS[cell.defId];
    const cfg = TIMED_POWERUP_PEDESTAL_CONFIGS[cell.defId];
    if (!def || !cfg) return;

    this.pedestals.set(cell.id, {
      id: cell.id,
      def,
      x: this.cellToWorldX(cell.gridX),
      y: this.cellToWorldY(cell.gridY),
      respawnMs: Math.max(1, Math.floor(cell.respawnMs ?? cfg.respawnMs)),
      spawnOnArenaStart: cell.spawnOnArenaStart ?? cfg.spawnOnArenaStart,
      linkedBaseId: cell.linkedBaseId,
      currentUid: null,
      nextRespawnAt: 0,
    });
  }

  private getInitialDynamicPedestalId(): number {
    let maxId = -1;
    for (const pedestal of this.layout.powerUpPedestals) maxId = Math.max(maxId, pedestal.id);
    return maxId + 1;
  }

  private removePedestal(pedestalId: number): boolean {
    const pedestal = this.pedestals.get(pedestalId);
    if (!pedestal) return false;
    if (pedestal.currentUid !== null) {
      this.worldItems.delete(pedestal.currentUid);
      this.netSnapshotCache.delete(pedestal.currentUid);
      this.pendingRemovalUids.add(pedestal.currentUid);
      this.itemToPedestal.delete(pedestal.currentUid);
    }
    this.pedestals.delete(pedestalId);
    this.pedestalNetCache.delete(pedestalId);
    this.pendingPedestalRemovalIds.add(pedestalId);
    return true;
  }

  private spawnPowerUpDef(
    def: PowerUpDef,
    x: number,
    y: number,
    metadata?: Pick<WorldItem, 'pickupKind' | 'objectiveId'>,
  ): number {
    const uid = this.nextUid++;
    this.worldItems.set(uid, { uid, def, x, y, ...metadata });
    return uid;
  }

  private removeObjectiveWorldItem(uid: number): void {
    if (this.worldItems.delete(uid)) {
      this.pendingRemovalUids.add(uid);
      this.netSnapshotCache.delete(uid);
    }
  }

  private spawnPedestalItem(pedestal: PedestalRuntime): void {
    if (pedestal.currentUid !== null) return;
    const uid = this.spawnPowerUpDef(pedestal.def, pedestal.x, pedestal.y);
    pedestal.currentUid = uid;
    pedestal.nextRespawnAt = 0;
    this.itemToPedestal.set(uid, pedestal.id);
  }
}
