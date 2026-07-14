import * as Phaser from 'phaser';
import type { BaseManager } from '../entities/BaseManager';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager }     from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { NetworkBridge }     from '../network/NetworkBridge';
import type { ResourceSystem }    from './ResourceSystem';
import type { DetonationSystem }  from './DetonationSystem';
import type { EnergyShieldSystem } from './EnergyShieldSystem';
import type { DecoySystem, DecoyTargetSnapshot } from './DecoySystem';
import type { BurnOnHitConfig, ChainLightningConfig, HitscanVisualPreset, LoadoutSlot, MeleeVisualPreset, RadialDamageFalloffConfig, ShieldBlockCategory, ShotAudioKey, SyncedDeathEffect, SyncedHitEffect, SyncedHitscanTrace, SyncedMeleeSwing, DetonatorConfig, ProjectileExplosionConfig, TrackedProjectile, WeaponSlot } from '../types';
import {
  type GeometryHit,
  findNearestRectangleHit as geomNearestRectangleHit,
  findNearestCircleHit as geomNearestCircleHit,
} from '../utils/geometry';
import {
  ARENA_HEIGHT,
  ARMOR_MAX,
  COLORS,
  HP_MAX, RESPAWN_DELAY_MS,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH,
  HITSCAN_FAVOR_THE_SHOOTER_MAX_OFFSET,
  HITSCAN_FAVOR_THE_SHOOTER_MS,
  PLAYER_SIZE,
  RAGE_PER_DAMAGE, ADRENALINE_START,
} from '../config';
import { TRAIN } from '../train/TrainConfig';
import { isCoopDefenseMode } from '../gameModes';
import { getCoopDefenseEnemyXp } from '../config/coopDefenseEnemies';
import { computeProjectileExplosionDamage, computeRadialDamage } from '../utils/radialDamage';

// Hitscan-Traces und Melee-Swings werden jetzt per RPC statt State gesendet

// Zirkuläre Abhängigkeiten vermeiden: nur Typ-Imports
type BurrowSystemType    = { isBurrowed(id: string): boolean };
type LoadoutManagerType  = { getDamageMultiplier(id: string): number; getWeaponDamageMultiplier(id: string, slot: WeaponSlot, now?: number): number };
type PowerUpSystemType   = { getDamageMultiplier(id: string): number; removePlayer(id: string): void };
type StinkCloudSystemType = { hostDeactivateForPlayer(id: string): void };

interface AoeDamageOptions {
  category?: ShieldBlockCategory;
  allowTeamDamage?: boolean;
  weaponName?: string;
  sourceSlot?: LoadoutSlot;
  damageFalloff?: RadialDamageFalloffConfig;
  selfDamageMult?: number;
}

interface DamageApplicationOptions {
  allowTeamDamage?: boolean;
}

interface DamageVisualContext {
  sourceX?: number;
  sourceY?: number;
  dirX?: number;
  dirY?: number;
  projectileColor?: number;
}

export interface KillSourceContext {
  dirX?: number;
  dirY?: number;
  projectileColor?: number;
}

interface BurnStackState {
  expiresAt: number;
}

interface BurnSourceState {
  attackerId: string;
  stacks: BurnStackState[];
  nextTickAt: number;
  damagePerTick: number;
  tickIntervalMs: number;
  weaponName: string;
}

export interface HitscanTraceResult {
  readonly endX: number;
  readonly endY: number;
  readonly distance: number;
  readonly hitPlayerId: string | null;
  readonly hitEnemyId: string | null;
  readonly hitDecoyId: number | null;
  readonly hitObstacle: boolean;
}

export interface HitscanTraceOptions {
  readonly shooterId: string;
  readonly startX: number;
  readonly startY: number;
  readonly angle: number;
  readonly range: number;
  readonly traceThickness: number;
  readonly applyFavorTheShooter: boolean;
}

interface HitscanSpriteTarget {
  sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Arc;
  body: { velocity: { x: number; y: number } } | null;
}

type SweptProjectileHit =
  | { kind: 'player'; playerId: string; distance: number; x: number; y: number }
  | { kind: 'enemy'; enemyId: string; distance: number; x: number; y: number }
  | { kind: 'decoy'; decoyId: number; distance: number; x: number; y: number };

type ChainTarget =
  | { kind: 'enemy'; enemyId: string; x: number; y: number }
  | { kind: 'player'; playerId: string; x: number; y: number }
  | { kind: 'decoy'; decoyId: number; x: number; y: number }
  | { kind: 'detonable'; projectileId: number; x: number; y: number };

export class CombatSystem {
  private hp:            Map<string, number>                           = new Map();
  private maxHp:         Map<string, number>                           = new Map();
  private armor:         Map<string, number>                           = new Map();
  private alive:         Map<string, boolean>                          = new Map();
  private respawnTimers: Map<string, ReturnType<typeof setTimeout>>    = new Map();
  // Burn-Stacks pro Ziel, gruppiert nach Quelle (Angreifer + Waffe), damit
  // unterschiedliche Quellen (z.B. Flammenwerfer + Molotov) sauber stacken und
  // ihren Schaden addieren statt sich gegenseitig zu überschreiben.
  private burnStates:    Map<string, Map<string, BurnSourceState>>      = new Map();
  private readonly hitscanLine       = new Phaser.Geom.Line();
  private readonly chainScanLine     = new Phaser.Geom.Line();  // Scratch-Linie für Kettenblitz-Sichtlinienprüfung
  private readonly meleeLine         = new Phaser.Geom.Line();  // Scratch-Linie für Melee-Hindernisprüfung
  private readonly arenaBounds       = new Phaser.Geom.Rectangle(ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, ARENA_HEIGHT);
  private readonly scratchCircle     = new Phaser.Geom.Circle();
  private readonly scratchPoints:    Phaser.Math.Vector2[] = [];
  private readonly scratchTrainRect  = new Phaser.Geom.Rectangle();
  private meleeSwingIdCounter = 0;
  private effectSeedCounter = 1;

  // Kill-Tracking: letzter Angreifer & Waffe pro Ziel (für Frag-Vergabe)
  private lastAttacker: Map<string, string> = new Map();  // victimId → attackerId
  private lastWeapon:   Map<string, string> = new Map();  // victimId → weaponName
  private lastKillSource: Map<string, KillSourceContext> = new Map();

  // Callback: (killerId, victimId, weaponName) – Host-only
  private onKillCb: ((killerId: string, victimId: string, weapon: string, x: number, y: number, source?: KillSourceContext) => void) | null = null;
  private onDeathCb: ((playerId: string, x: number, y: number) => void) | null = null;

  // Optionale Referenzen – werden nach Konstruktion gesetzt
  private burrowSystem:     BurrowSystemType    | null  = null;
  private resourceSystem:   ResourceSystem      | null  = null;
  private loadoutManager:   LoadoutManagerType  | null  = null;
  private energyShieldSystem: EnergyShieldSystem | null = null;
  private powerUpSystem:    PowerUpSystemType   | null  = null;
  private detonationSystem: DetonationSystem    | null  = null;  private stinkCloudSystem: StinkCloudSystemType | null = null;  private rockObjects: readonly (Phaser.GameObjects.Image | null)[] | null = null;
  private decoySystem:      DecoySystem | null = null;
  private enemyManager:     EnemyManager | null = null;
  private baseManager:      BaseManager | null = null;
  private trunkObjects: readonly Phaser.GameObjects.Arc[] | null = null;
  /**
   * Coop-Defense-Basen als rechteckige LoS-/Hitscan-/Melee-Blocker.
   * Schuss-Schaden wird hier nie appliziert (Spieler-Schaden auf Basen ist in 1.3 verboten);
   * Basen wirken aber als physische Wände, hinter denen Spieler nicht getroffen werden.
   */
  private baseObstacles: readonly Phaser.GameObjects.Rectangle[] | null = null;
  private trainSegObjects: readonly Phaser.GameObjects.Rectangle[] | null = null;
  /** Client-seitiger Fallback: vorberechnete Zug-Bounds aus SyncedTrainState */
  private clientTrainBounds: Phaser.Geom.Rectangle | null = null;

  // Callbacks für Objekt-Schaden (gesetzt von ArenaScene)
  private onRockDamage:  ((rockIndex: number, damage: number, attackerId: string) => void) | null = null;
  private onTrainDamage: ((damage: number, attackerId: string) => void) | null = null;
  private onProjectileImpact: ((projectileId: number, x: number, y: number) => void) | null = null;
  private onPlayerImpulse: ((playerId: string, vx: number, vy: number, durationMs: number, sourcePlayerId?: string) => void) | null = null;
  private onEnemyImpulse: ((enemyId: string, vx: number, vy: number, durationMs: number, sourcePlayerId?: string) => void) | null = null;
  private playerMaxHpResolver: ((playerId: string) => number) | null = null;
  private playerDamageReductionResolver: ((playerId: string) => number) | null = null;
  private playerHpRegenPerSecondResolver: ((playerId: string) => number) | null = null;
  private playerMaxArmorResolver: ((playerId: string) => number) | null = null;
  private playerArmorGainMultiplierResolver: ((playerId: string) => number) | null = null;

  constructor(
    private playerManager:     PlayerManager,
    private projectileManager: ProjectileManager,
    private bridge:            NetworkBridge,
  ) {}

  syncArenaBounds(): void {
    this.arenaBounds.setTo(ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, ARENA_HEIGHT);
  }

  // ── Referenz-Injection ────────────────────────────────────────────────────

  setBurrowSystem(bs: BurrowSystemType | null): void     { this.burrowSystem   = bs; }
  setResourceSystem(rs: ResourceSystem | null): void     { this.resourceSystem = rs; }
  setLoadoutManager(lm: LoadoutManagerType | null): void { this.loadoutManager = lm; }
  setEnergyShieldSystem(es: EnergyShieldSystem | null): void { this.energyShieldSystem = es; }
  setPowerUpSystem(ps: PowerUpSystemType | null): void   { this.powerUpSystem  = ps; }
  setDetonationSystem(ds: DetonationSystem | null): void { this.detonationSystem = ds; }
  setStinkCloudSystem(sc: StinkCloudSystemType | null): void { this.stinkCloudSystem = sc; }
  setDecoySystem(ds: DecoySystem | null): void { this.decoySystem = ds; }
  setEnemyManager(manager: EnemyManager | null): void { this.enemyManager = manager; }
  setBaseManager(manager: BaseManager | null): void { this.baseManager = manager; }
  setPlayerMaxHpResolver(resolver: ((playerId: string) => number) | null): void { this.playerMaxHpResolver = resolver; }
  setPlayerDamageReductionResolver(resolver: ((playerId: string) => number) | null): void { this.playerDamageReductionResolver = resolver; }
  setPlayerHpRegenPerSecondResolver(resolver: ((playerId: string) => number) | null): void { this.playerHpRegenPerSecondResolver = resolver; }
  setPlayerMaxArmorResolver(resolver: ((playerId: string) => number) | null): void { this.playerMaxArmorResolver = resolver; }
  setPlayerArmorGainMultiplierResolver(resolver: ((playerId: string) => number) | null): void { this.playerArmorGainMultiplierResolver = resolver; }
  setArenaObstacles(
    rockObjects: readonly (Phaser.GameObjects.Image | null)[] | null,
    trunkObjects: readonly Phaser.GameObjects.Arc[] | null,
  ): void {
    this.rockObjects = rockObjects;
    this.trunkObjects = trunkObjects;
  }

  /**
   * Coop-Defense-Basen als Hitscan-/LoS-/Melee-Blocker registrieren. null
   * deaktiviert die Blocker (Lobby-Teardown).
   */
  setBaseObstacles(
    baseObstacles: readonly Phaser.GameObjects.Rectangle[] | null,
  ): void {
    this.baseObstacles = baseObstacles;
  }

  setTrainSegments(segments: readonly Phaser.GameObjects.Rectangle[] | null): void {
    this.trainSegObjects = segments;
  }

  /** Client-only: setzt vorberechnete Zug-Bounds direkt (ohne Segment-Objekte). */
  setClientTrainBounds(state: { x: number; y: number; dir: 1 | -1 } | null): void {
    if (!state) { this.clientTrainBounds = null; return; }
    const rearExtent = TRAIN.LOCO_HEIGHT / 2 + TRAIN.WAGON_COUNT * (TRAIN.SEGMENT_GAP + TRAIN.WAGON_HEIGHT);
    const minY = state.dir === 1 ? state.y - rearExtent : state.y - TRAIN.LOCO_HEIGHT / 2;
    const maxY = state.dir === 1 ? state.y + TRAIN.LOCO_HEIGHT / 2 : state.y + rearExtent;
    this.clientTrainBounds = new Phaser.Geom.Rectangle(
      state.x - TRAIN.HITBOX_WIDTH / 2,
      minY,
      TRAIN.HITBOX_WIDTH,
      maxY - minY,
    );
  }

  setRockDamageCallback(cb: ((rockIndex: number, damage: number, attackerId: string) => void) | null): void {
    this.onRockDamage = cb;
  }

  setTrainDamageCallback(cb: ((damage: number, attackerId: string) => void) | null): void {
    this.onTrainDamage = cb;
  }

  setProjectileImpactCallback(cb: ((projectileId: number, x: number, y: number) => void) | null): void {
    this.onProjectileImpact = cb;
  }

  setPlayerImpulseCallback(cb: ((playerId: string, vx: number, vy: number, durationMs: number, sourcePlayerId?: string) => void) | null): void {
    this.onPlayerImpulse = cb;
  }

  setEnemyImpulseCallback(cb: ((enemyId: string, vx: number, vy: number, durationMs: number, sourcePlayerId?: string) => void) | null): void {
    this.onEnemyImpulse = cb;
  }

  /** Setzt den Kill-Callback (Host-only). */
  setKillCallback(cb: (killerId: string, victimId: string, weapon: string, x: number, y: number, source?: KillSourceContext) => void): void {
    this.onKillCb = cb;
  }

  setDeathCallback(cb: ((playerId: string, x: number, y: number) => void) | null): void {
    this.onDeathCb = cb;
  }

  // ── Spieler-Lifecycle ──────────────────────────────────────────────────────

  initPlayer(id: string): void {
    const maxHp = this.resolvePlayerMaxHp(id);
    this.maxHp.set(id, maxHp);
    this.hp.set(id, maxHp);
    this.armor.set(id, 0);
    this.alive.set(id, true);
    this.clearBurnForPlayer(id);
    this.lastAttacker.delete(id);
    this.lastWeapon.delete(id);
    this.lastKillSource.delete(id);
  }

  removePlayer(id: string): void {
    this.clearBurnForPlayer(id);
    this.clearBurnByAttacker(id);
    this.hp.delete(id);
    this.maxHp.delete(id);
    this.armor.delete(id);
    this.alive.delete(id);
    this.lastAttacker.delete(id);
    this.lastWeapon.delete(id);
    this.lastKillSource.delete(id);
    const t = this.respawnTimers.get(id);
    if (t) { clearTimeout(t); this.respawnTimers.delete(id); }
  }

  // ── Abfragen ───────────────────────────────────────────────────────────────

  getHP(id: string):    number  { return this.hp.get(id)    ?? this.getMaxHp(id); }
  getMaxHp(id: string): number  { return this.maxHp.get(id) ?? this.resolvePlayerMaxHp(id); }
  getArmor(id: string): number  { return this.armor.get(id) ?? 0;      }
  isAlive(id: string):  boolean { return (this.alive.get(id) ?? false) || this.enemyManager?.hasEnemy(id) === true; }
  isBurrowed(id: string): boolean { return this.burrowSystem?.isBurrowed(id) ?? false; }
  getBurnStackCount(id: string): number {
    const sourceStates = this.burnStates.get(id);
    if (!sourceStates) return 0;

    let totalStacks = 0;
    for (const state of sourceStates.values()) {
      totalStacks += state.stacks.length;
    }
    return totalStacks;
  }

  // ── Öffentliche Schadens-Methode ───────────────────────────────────────────

  /**
   * Fügt einem Spieler Schaden zu. Burrowed-Spieler sind unverwundbar
   * (Ausnahme: Stuck-Schaden über skipBurrowCheck=true).
   * attackerId/weaponName werden für die Kill-Zuordnung getrackt.
   */
  applyDamage(
    targetId:        string,
    amount:          number,
    skipBurrowCheck  = false,
    attackerId?:     string,
    weaponName?:     string,
    visualContext?:  DamageVisualContext,
    options?:        DamageApplicationOptions,
  ): void {
    if (this.enemyManager?.hasEnemy(targetId)) {
      this.applyEnemyDamage(targetId, amount, attackerId, weaponName, visualContext, options);
      return;
    }

    if (!this.isAlive(targetId)) return;
    if (amount <= 0) return;
    if (!this.canDamageTarget(attackerId, targetId, options?.allowTeamDamage)) return;
    if (!skipBurrowCheck && this.burrowSystem?.isBurrowed(targetId)) return;
    this.decoySystem?.breakStealth(targetId, Date.now());

    // Letzten Angreifer tracken (Selbstschaden ausgenommen)
    if (attackerId && attackerId !== targetId) {
      this.lastAttacker.set(targetId, attackerId);
      if (weaponName) this.lastWeapon.set(targetId, weaponName);
      if (visualContext) this.lastKillSource.set(targetId, {
        dirX: visualContext.dirX,
        dirY: visualContext.dirY,
        projectileColor: visualContext.projectileColor,
      });
    }

    const player = this.playerManager.getPlayer(targetId);
    const x = player?.sprite.x ?? 0;
    const y = player?.sprite.y ?? 0;

    const damageReduction = Phaser.Math.Clamp(this.playerDamageReductionResolver?.(targetId) ?? 0, 0, 1);
    const reducedAmount = amount * (1 - damageReduction);
    const currentArmor = this.armor.get(targetId) ?? 0;
    const absorbedByArmor = Math.min(currentArmor, reducedAmount);
    const overflowDamage = Math.max(0, reducedAmount - absorbedByArmor);
    const newArmor = Math.max(0, currentArmor - absorbedByArmor);
    const currentHp = this.hp.get(targetId) ?? this.getMaxHp(targetId);
    const newHp = Math.max(0, currentHp - overflowDamage);
    const armorLost = currentArmor - newArmor;
    const hpLost = currentHp - newHp;
    const totalDamage = armorLost + hpLost;
    this.armor.set(targetId, newArmor);
    this.hp.set(targetId, newHp);

    // Wut-Gewinn nur aus tatsaechlich verlorenem HP-Wert, nie aus Armor oder Overkill.
    if (hpLost > 0) {
      this.resourceSystem?.addRage(targetId, hpLost * RAGE_PER_DAMAGE);
    }

    if (totalDamage > 0) {
      const hitSeed = this.nextEffectSeed();
      this.bridge.broadcastEffect(this.buildHitEffect(
        targetId,
        x,
        y,
        attackerId,
        totalDamage,
        hpLost,
        armorLost,
        newHp === 0,
        visualContext,
        hitSeed,
      ));
    }

    if (newHp === 0) this.handleDeath(targetId, x, y, this.nextEffectSeed());
  }

  applyBurnStack(
    targetId: string,
    attackerId: string,
    durationMs: number,
    damagePerTick: number,
    tickIntervalMs: number,
    weaponName: string,
  ): void {
    if (!this.isAlive(targetId)) return;
    if (!this.canDamageTarget(attackerId, targetId)) return;
    if (durationMs <= 0 || damagePerTick <= 0 || tickIntervalMs <= 0) return;

    const now = Date.now();
    let targetState = this.burnStates.get(targetId);
    if (!targetState) {
      targetState = new Map();
      this.burnStates.set(targetId, targetState);
    }

    // Quelle = Angreifer + Waffe: gleiche Quelle stackt (1 Treffer = 1 Stack),
    // verschiedene Quellen ticken unabhängig und addieren ihren Schaden.
    const sourceKey = `${attackerId}␟${weaponName}`;
    let sourceState = targetState.get(sourceKey);
    if (!sourceState) {
      sourceState = {
        attackerId,
        stacks: [],
        nextTickAt: now + tickIntervalMs,
        damagePerTick,
        tickIntervalMs,
        weaponName,
      };
      targetState.set(sourceKey, sourceState);
    }

    sourceState.damagePerTick = damagePerTick;
    sourceState.tickIntervalMs = tickIntervalMs;
    sourceState.weaponName = weaponName;
    sourceState.stacks.push({ expiresAt: now + durationMs });
  }

  /**
   * Wendet eine BurnOnHitConfig auf ein Ziel an (Projektil/Hitscan/Melee/Explosion).
   * No-op, wenn keine Config vorhanden oder deaktiviert (damagePerTick/durationMs = 0).
   */
  private applyBurnOnHit(
    targetId:   string,
    attackerId: string,
    burn:       BurnOnHitConfig | undefined,
    weaponName: string,
  ): void {
    if (!burn) return;
    this.applyBurnStack(targetId, attackerId, burn.durationMs, burn.damagePerTick, burn.tickIntervalMs, weaponName);
  }

  /**
   * Brennende Treffer aus den Burn-Feldern eines Projektils (z.B. brennende
   * Kugeln der Glock/Negev oder Flammenwerfer-Hitbox). No-op ohne Burn-Felder.
   */
  /** true, wenn das Projektil eine aktive "nur bei Gegner-Treffern"-Explosion besitzt. */
  private hasEnemyHitExplosion(proj: TrackedProjectile | undefined): boolean {
    const e = proj?.enemyHitExplosion;
    return !!e && e.radius > 0 && e.maxDamage > 0;
  }

  private applyProjectileBurn(targetId: string, proj: TrackedProjectile | undefined): void {
    if (!proj) return;
    this.applyBurnStack(
      targetId,
      proj.ownerId,
      proj.burnDurationMs ?? 0,
      proj.burnDamagePerTick ?? 0,
      proj.burnTickIntervalMs ?? 0,
      proj.weaponName,
    );
  }

  updateBurnEffects(now: number): void {
    for (const [targetId, sourceStates] of [...this.burnStates]) {
      if (!this.isAlive(targetId) || this.isBurrowed(targetId)) {
        this.clearBurnForPlayer(targetId);
        continue;
      }

      for (const [sourceKey, state] of [...sourceStates]) {
        state.stacks = state.stacks.filter(stack => stack.expiresAt > now);
        if (state.stacks.length === 0) {
          sourceStates.delete(sourceKey);
          continue;
        }

        while (now >= state.nextTickAt && state.stacks.length > 0 && this.isAlive(targetId)) {
          const damage = state.damagePerTick * state.stacks.length;
          const attacker = this.playerManager.getPlayer(state.attackerId);
          this.applyDamage(targetId, damage, false, state.attackerId, state.weaponName, attacker
            ? { sourceX: attacker.sprite.x, sourceY: attacker.sprite.y }
            : undefined);
          state.nextTickAt += state.tickIntervalMs;

          if (!this.isAlive(targetId)) break;
        }
      }

      if (sourceStates.size === 0) {
        this.burnStates.delete(targetId);
      }
    }
  }

  /**
   * Flächenschaden um einen Punkt (z.B. Granaten-Explosion).
   * Burrowed-Spieler sind immun (skipBurrowCheck=false).
   */
  applyAoeDamage(
    x: number,
    y: number,
    radius: number,
    damage: number,
    ownerId: string,
    includeSelf = false,
    options?: AoeDamageOptions,
  ): void {
    for (const player of this.playerManager.getAllPlayers()) {
      if (!includeSelf && player.id === ownerId) continue;
      if (!this.isAlive(player.id)) continue;
      if (!this.canDamageTarget(ownerId, player.id, options?.allowTeamDamage)) continue;
      const dist = Phaser.Math.Distance.Between(x, y, player.sprite.x, player.sprite.y);
      if (dist > radius) continue;

      let appliedDamage = computeRadialDamage(dist, radius, damage, options?.damageFalloff);
      if (player.id === ownerId) {
        appliedDamage *= options?.selfDamageMult ?? 1;
      }

      const roundedDamage = Math.round(appliedDamage);
      if (roundedDamage <= 0) continue;

      const category = options?.category ?? 'explosion';
      if (this.shouldBlockWithShield(player.id, category, roundedDamage, x, y)) continue;
      this.applyDamage(player.id, roundedDamage, false, ownerId, options?.weaponName ?? 'Granate', { sourceX: x, sourceY: y }, options);
    }

    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
      const dist = Phaser.Math.Distance.Between(x, y, enemy.sprite.x, enemy.sprite.y);
      if (dist > radius) continue;

      const roundedDamage = Math.round(computeRadialDamage(dist, radius, damage, options?.damageFalloff));
      if (roundedDamage <= 0) continue;
      this.applyDamage(enemy.id, roundedDamage, false, ownerId, options?.weaponName ?? 'Granate', { sourceX: x, sourceY: y }, options);
    }
  }

  applyExplosionDamage(
    x: number,
    y: number,
    effect: ProjectileExplosionConfig,
    ownerId: string,
    sourceSlot?: LoadoutSlot,
    weaponName = 'Explosion',
  ): string[] {
    const damagedTargetKeys: string[] = [];
    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.isAlive(player.id)) continue;

      const dist = Phaser.Math.Distance.Between(x, y, player.sprite.x, player.sprite.y);
      if (dist > effect.radius) continue;

      let damage = computeProjectileExplosionDamage(dist, effect);
      if (player.id === ownerId) {
        damage *= effect.selfDamageMult;
      }
      if (!this.canDamageTarget(ownerId, player.id, effect.allowTeamDamage)) continue;

      const roundedDamage = Math.round(damage);
      if (roundedDamage <= 0) continue;
      if (this.shouldBlockWithShield(player.id, 'explosion', roundedDamage, x, y)) continue;
      void sourceSlot;
      this.applyDamage(player.id, roundedDamage, false, ownerId, weaponName, { sourceX: x, sourceY: y }, {
        allowTeamDamage: effect.allowTeamDamage,
      });
      damagedTargetKeys.push(`players:${player.id}`);
      if (player.id !== ownerId) this.applyBurnOnHit(player.id, ownerId, effect.burnOnHit, weaponName);
    }

    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
      const dist = Phaser.Math.Distance.Between(x, y, enemy.sprite.x, enemy.sprite.y);
      if (dist > effect.radius) continue;

      const roundedDamage = Math.round(computeProjectileExplosionDamage(dist, effect));
      if (roundedDamage <= 0) continue;
      this.applyDamage(enemy.id, roundedDamage, false, ownerId, weaponName, { sourceX: x, sourceY: y }, {
        allowTeamDamage: effect.allowTeamDamage,
      });
      damagedTargetKeys.push(`enemies:${enemy.id}`);
      this.applyBurnOnHit(enemy.id, ownerId, effect.burnOnHit, weaponName);
    }
    return damagedTargetKeys;
  }

  canDamageTarget(attackerId: string | undefined, targetId: string, allowTeamDamage = false): boolean {
    if (!attackerId) return true;
    if (attackerId === targetId) return true;
    if (allowTeamDamage) return true;
    return !this.bridge.areTeammates(attackerId, targetId);
  }

  private shouldBlockWithShield(
    targetId: string,
    category: ShieldBlockCategory,
    damage: number,
    sourceX: number,
    sourceY: number,
  ): boolean {
    if (!this.energyShieldSystem) return false;
    return this.energyShieldSystem.tryBlockDamage({
      targetId,
      category,
      damage,
      sourceX,
      sourceY,
      now: Date.now(),
    });
  }

  // ── Host-Update: Projektil-Spieler-Kollisionserkennung ────────────────────

  /**
   * Jeden Frame auf dem Host aufrufen.
   * Prüft Überschneidungen zwischen Projektilen und Spielern.
   * Selbst-Treffer, Granaten und burrowed Spieler werden ignoriert.
   */
  update(): void {
    if (!this.bridge.isHost()) return;

    for (const proj of this.projectileManager.getActiveProjectiles()) {
      if (proj.isGrenade) continue;  // Granaten treffen nicht direkt, nur AoE

      if (this.shouldUseContinuousProjectileCollision(proj)) {
        const travelDistance = Phaser.Math.Distance.Between(proj.lastX, proj.lastY, proj.sprite.x, proj.sprite.y);
        if (travelDistance > 0.5) {
          this.tryResolveContinuousProjectileHit(proj);
          continue;
        }
      }

      const projBounds = proj.sprite.getBounds();
      if (this.resolveProjectilePlayerHits(proj, projBounds)) continue;
      if (this.resolveProjectileEnemyHits(proj, projBounds)) continue;
      this.resolveProjectileDecoyHits(proj, projBounds);
    }
  }

  /** Schützen-Damage-Multiplikator (Loadout/Ultimate + PowerUp) auf den Projektil-Basisschaden anwenden. */
  private computeProjectileDamage(proj: TrackedProjectile): number {
    const loadoutMult  = proj.sourceSlot === 'weapon1' || proj.sourceSlot === 'weapon2'
      ? (this.loadoutManager?.getWeaponDamageMultiplier(proj.ownerId, proj.sourceSlot, Date.now()) ?? 1)
      : (this.loadoutManager?.getDamageMultiplier(proj.ownerId) ?? 1);
    const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(proj.ownerId) ?? 1;
    return proj.damage * loadoutMult * powerUpMult;
  }

  /** AABB-Treffer gegen Spieler (Shield/Piercing/Flammen-Burn/Standard). Liefert true, wenn das Projektil verbraucht ist. */
  private resolveProjectilePlayerHits(proj: TrackedProjectile, projBounds: Phaser.Geom.Rectangle): boolean {
    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.isAlive(player.id))                     continue;
      if (proj.ownerId === player.id)                   continue;
      if (this.burrowSystem?.isBurrowed(player.id))     continue;
      if (proj.multiExplosionExcludedTargetKeys?.has(`players:${player.id}`)) continue;

      if (Phaser.Geom.Intersects.RectangleToRectangle(projBounds, player.sprite.getBounds())) {
        const actualDamage = this.computeProjectileDamage(proj);
        const canDealDamage = this.canDamageTarget(proj.ownerId, player.id, proj.allowTeamDamage);

        if (canDealDamage && this.shouldBlockWithShield(player.id, 'projectile', actualDamage, proj.sprite.x, proj.sprite.y)) {
          const reflectionFactor = proj.reflected ? 0 : (this.energyShieldSystem?.getReflectionDamageFactor(player.id) ?? 0);
          if (reflectionFactor > 0) {
            const speed = Math.hypot(proj.body.velocity.x, proj.body.velocity.y);
            const angle = Math.atan2(-proj.body.velocity.y, -proj.body.velocity.x);
            this.projectileManager.spawnProjectile(player.sprite.x, player.sprite.y, angle, player.id, {
              speed,
              size: Math.max(1, proj.sprite.displayWidth),
              damage: proj.damage * reflectionFactor,
              color: proj.color,
              ownerColor: proj.ownerColor,
              lifetime: Math.max(1, proj.lifetime - (Date.now() - proj.createdAt)),
              maxBounces: 0,
              isGrenade: false,
              adrenalinGain: 0,
              weaponName: 'Reflektor',
              projectileStyle: proj.projectileStyle,
              bulletVisualPreset: proj.bulletVisualPreset,
              tracerConfig: proj.tracerConfig,
              reflected: true,
              sourceSlot: 'weapon2',
            });
          }
          this.projectileManager.destroyProjectile(proj.id);
          return true;
        }

        if (proj.penetrationHitIds) {
          if (proj.penetrationHitIds.has(player.id)) continue;
          proj.penetrationHitIds.add(player.id);
          if (canDealDamage) {
            this.applyDamage(player.id, actualDamage, false, proj.ownerId, proj.weaponName, { sourceX: proj.sprite.x, sourceY: proj.sprite.y, dirX: proj.body.velocity.x, dirY: proj.body.velocity.y }, { allowTeamDamage: proj.allowTeamDamage });
            this.applyProjectileBurn(player.id, proj);
          }
          if ((proj.penetrationRemaining ?? 0) > 0) {
            proj.penetrationRemaining = (proj.penetrationRemaining ?? 0) - 1;
            proj.damage *= proj.penetrationDamageRetention ?? 1;
            continue;
          }
          this.projectileManager.destroyProjectile(proj.id);
          return true;
        }

        if (proj.isBfg || proj.projectileStyle === 'gauss') {
          // Piercing-Projektile: Spieler nur 1x treffen, Projektil fliegt weiter.
          if (!proj.bfgHitPlayers) proj.bfgHitPlayers = new Set();
          if (proj.projectileStyle === 'gauss') {
            if (!proj.gaussHitPlayers) proj.gaussHitPlayers = new Set();
            if (proj.gaussHitPlayers.has(player.id)) continue;
            proj.gaussHitPlayers.add(player.id);
          } else {
            if (proj.bfgHitPlayers.has(player.id)) continue;
            proj.bfgHitPlayers.add(player.id);
          }
          this.applyDamage(player.id, actualDamage, false, proj.ownerId, proj.weaponName, {
            sourceX: proj.sprite.x,
            sourceY: proj.sprite.y,
            dirX: proj.body.velocity.x,
            dirY: proj.body.velocity.y,
          }, {
            allowTeamDamage: proj.allowTeamDamage,
          });
          if (proj.projectileStyle === 'gauss') this.resolveGaussDischarge(proj, player.id, undefined, actualDamage);
          continue; // kein break, kein destroyProjectile
        }

        if (proj.isFlame && proj.flamePierceHitIds !== undefined) {
          if (proj.flamePierceHitIds.has(player.id)) continue;
          proj.flamePierceHitIds.add(player.id);
          if (canDealDamage) {
            this.applyBurnStack(player.id, proj.ownerId, proj.burnDurationMs ?? 0, proj.burnDamagePerTick ?? 0, proj.burnTickIntervalMs ?? 0, proj.weaponName);
            this.applyDamage(player.id, actualDamage, false, proj.ownerId, proj.weaponName, { sourceX: proj.sprite.x, sourceY: proj.sprite.y, dirX: proj.body.velocity.x, dirY: proj.body.velocity.y }, { allowTeamDamage: proj.allowTeamDamage });
          }
          continue;
        }

        // Brennende Treffer (Flammenwerfer-Hitbox, brennende Kugeln, …) werden
        // zentral in handleHit aus den Burn-Feldern des Projektils angewendet.
        this.handleHit(proj.id, player.id, actualDamage, proj.ownerId, proj.adrenalinGain, proj.weaponName, canDealDamage);
        return true;  // Projektil trifft maximal einen Spieler pro Frame
      }
    }
    return false;
  }

  /** AABB-Treffer gegen Gegner (Coop-Defense). Liefert true, wenn das Projektil verbraucht ist. */
  private resolveProjectileEnemyHits(proj: TrackedProjectile, projBounds: Phaser.Geom.Rectangle): boolean {
    // Gegnergeschosse fliegen durch verbuendete Gegner. Ohne dieses Gate
    // wuerden sie zwar keinen Friendly-Fire-Schaden verursachen, aber dennoch
    // am ersten eigenen Mob zerstoert (wichtig fuer die Sporenkanone).
    if (this.enemyManager?.hasEnemy(proj.ownerId)) return false;

    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
      if (proj.ownerId === enemy.id) continue;
      if (proj.multiExplosionExcludedTargetKeys?.has(`enemies:${enemy.id}`)) continue;

      if (Phaser.Geom.Intersects.RectangleToRectangle(projBounds, enemy.sprite.getBounds())) {
        const actualDamage = this.computeProjectileDamage(proj);
        const enemyKey = `enemy_${enemy.id}`;

        if (proj.penetrationHitIds) {
          if (proj.penetrationHitIds.has(enemyKey)) continue;
          proj.penetrationHitIds.add(enemyKey);
          this.applyDamage(enemy.id, actualDamage, false, proj.ownerId, proj.weaponName, { sourceX: proj.sprite.x, sourceY: proj.sprite.y, dirX: proj.body.velocity.x, dirY: proj.body.velocity.y }, { allowTeamDamage: proj.allowTeamDamage });
          this.applyProjectileBurn(enemy.id, proj);
          if ((proj.penetrationRemaining ?? 0) > 0) {
            proj.penetrationRemaining = (proj.penetrationRemaining ?? 0) - 1;
            proj.damage *= proj.penetrationDamageRetention ?? 1;
            continue;
          }
          this.projectileManager.destroyProjectile(proj.id);
          return true;
        }

        if (proj.isBfg || proj.projectileStyle === 'gauss') {
          if (!proj.bfgHitPlayers) proj.bfgHitPlayers = new Set();
          if (proj.projectileStyle === 'gauss') {
            if (!proj.gaussHitPlayers) proj.gaussHitPlayers = new Set();
            if (proj.gaussHitPlayers.has(enemyKey)) continue;
            proj.gaussHitPlayers.add(enemyKey);
          } else {
            if (proj.bfgHitPlayers.has(enemyKey)) continue;
            proj.bfgHitPlayers.add(enemyKey);
          }
          this.applyDamage(enemy.id, actualDamage, false, proj.ownerId, proj.weaponName, {
            sourceX: proj.sprite.x,
            sourceY: proj.sprite.y,
            dirX: proj.body.velocity.x,
            dirY: proj.body.velocity.y,
          }, {
            allowTeamDamage: proj.allowTeamDamage,
          });
          if (proj.projectileStyle === 'gauss') this.resolveGaussDischarge(proj, undefined, enemy.id, actualDamage);
          continue;
        }

        if (proj.isFlame && proj.flamePierceHitIds !== undefined) {
          const enemyKey = `enemy_${enemy.id}`;
          if (proj.flamePierceHitIds.has(enemyKey)) continue;
          proj.flamePierceHitIds.add(enemyKey);
          this.applyBurnStack(enemy.id, proj.ownerId, proj.burnDurationMs ?? 0, proj.burnDamagePerTick ?? 0, proj.burnTickIntervalMs ?? 0, proj.weaponName);
          this.applyDamage(enemy.id, actualDamage, false, proj.ownerId, proj.weaponName, { sourceX: proj.sprite.x, sourceY: proj.sprite.y, dirX: proj.body.velocity.x, dirY: proj.body.velocity.y }, { allowTeamDamage: proj.allowTeamDamage });
          continue;
        }

        // Brennende Treffer werden zentral in handleEnemyHit angewendet.
        this.handleEnemyHit(proj.id, enemy.id, actualDamage, proj.ownerId, proj.adrenalinGain, proj.weaponName);
        return true;
      }
    }
    return false;
  }

  /** AABB-Treffer gegen Decoys. Liefert true, wenn das Projektil verbraucht ist. */
  private resolveProjectileDecoyHits(proj: TrackedProjectile, projBounds: Phaser.Geom.Rectangle): boolean {
    for (const decoy of this.decoySystem?.getHostTargets() ?? []) {
      if (proj.ownerId === decoy.ownerId) continue;

      if (Phaser.Geom.Intersects.RectangleToRectangle(projBounds, decoy.sprite.getBounds())) {
        const actualDamage = this.computeProjectileDamage(proj);
        const decoyKey = `decoy_${decoy.id}`;

        if (proj.penetrationHitIds) {
          if (proj.penetrationHitIds.has(decoyKey)) continue;
          proj.penetrationHitIds.add(decoyKey);
          this.decoySystem?.applyDamage(decoy.id, actualDamage, proj.ownerId, proj.weaponName, { sourceX: proj.sprite.x, sourceY: proj.sprite.y, dirX: proj.body.velocity.x, dirY: proj.body.velocity.y });
          if ((proj.penetrationRemaining ?? 0) > 0) {
            proj.penetrationRemaining = (proj.penetrationRemaining ?? 0) - 1;
            proj.damage *= proj.penetrationDamageRetention ?? 1;
            continue;
          }
          this.projectileManager.destroyProjectile(proj.id);
          return true;
        }

        if (proj.isBfg || proj.projectileStyle === 'gauss') {
          if (!proj.bfgHitPlayers) proj.bfgHitPlayers = new Set();
          if (proj.projectileStyle === 'gauss') {
            if (!proj.gaussHitPlayers) proj.gaussHitPlayers = new Set();
            if (proj.gaussHitPlayers.has(decoyKey)) continue;
            proj.gaussHitPlayers.add(decoyKey);
          } else {
            if (proj.bfgHitPlayers.has(decoyKey)) continue;
            proj.bfgHitPlayers.add(decoyKey);
          }

          const hit = this.decoySystem?.applyDamage(decoy.id, actualDamage, proj.ownerId, proj.weaponName, {
            sourceX: proj.sprite.x,
            sourceY: proj.sprite.y,
            dirX: proj.body.velocity.x,
            dirY: proj.body.velocity.y,
          }) ?? false;
          if (hit && proj.adrenalinGain > 0) {
            this.resourceSystem?.addAdrenaline(proj.ownerId, proj.adrenalinGain);
          }
          continue;
        }

        this.handleDecoyHit(proj.id, decoy.id, actualDamage, proj.ownerId, proj.adrenalinGain, proj.weaponName);
        return true;
      }
    }
    return false;
  }

  private shouldUseContinuousProjectileCollision(proj: TrackedProjectile): boolean {
    return proj.projectileStyle === 'bullet' || proj.projectileStyle === 'awp';
  }

  private resolveGaussDischarge(proj: TrackedProjectile, hitPlayerId: string | undefined, hitEnemyId: string | undefined, damage: number): void {
    const radius = proj.gaussChainRadius ?? 0;
    const factor = proj.gaussChainDamageFactor ?? 0;
    if (radius <= 0 || factor <= 0) return;
    this.resolveChainLightning({
      shooterId: proj.ownerId,
      originX: proj.sprite.x,
      originY: proj.sprite.y,
      baseDamage: damage,
      chainCfg: { maxJumps: 1, searchRadius: radius, damageFalloffPerJump: 1 - factor, targetPlayers: true, targetEnemies: true, targetDecoys: false },
      weaponName: 'Magnetische Entladung',
      adrenalinGain: 0,
      playerColor: proj.ownerColor ?? proj.color,
      visualPreset: 'asmd_primary',
      baseThickness: 2,
      visitedPlayers: new Set(hitPlayerId ? [hitPlayerId] : []),
      visitedEnemies: new Set(hitEnemyId ? [hitEnemyId] : []),
      visitedDecoys: new Set(),
    });
  }

  private tryResolveContinuousProjectileHit(proj: TrackedProjectile): boolean {
    const line = new Phaser.Geom.Line(proj.lastX, proj.lastY, proj.sprite.x, proj.sprite.y);
    const travelDistance = Phaser.Geom.Line.Length(line);
    if (travelDistance <= 0.5) return false;

    const blockerDistance = this.findNearestProjectilePathBlockerDistance(line);
    const projectileRadius = Math.max(proj.sprite.displayWidth, proj.sprite.displayHeight) * 0.5;
    let bestHit: SweptProjectileHit | null = null;

    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.isAlive(player.id)) continue;
      if (proj.ownerId === player.id) continue;
      if (this.burrowSystem?.isBurrowed(player.id)) continue;
      if (proj.penetrationHitIds?.has(player.id)) continue;

      const hit = this.findNearestCircleHit(line, player.sprite.x, player.sprite.y, PLAYER_SIZE * 0.5 + projectileRadius);
      if (!hit) continue;
      if (blockerDistance !== null && blockerDistance < hit.distance - 0.75) continue;
      if (!bestHit || hit.distance < bestHit.distance) {
        bestHit = { kind: 'player', playerId: player.id, distance: hit.distance, x: hit.x, y: hit.y };
      }
    }

    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
      if (proj.ownerId === enemy.id) continue;
      if (proj.penetrationHitIds?.has(`enemy_${enemy.id}`)) continue;

      const enemyRadius = Math.max(enemy.sprite.displayWidth, enemy.sprite.displayHeight) * 0.5 + projectileRadius;
      const hit = this.findNearestCircleHit(line, enemy.sprite.x, enemy.sprite.y, enemyRadius);
      if (!hit) continue;
      if (blockerDistance !== null && blockerDistance < hit.distance - 0.75) continue;
      if (!bestHit || hit.distance < bestHit.distance) {
        bestHit = { kind: 'enemy', enemyId: enemy.id, distance: hit.distance, x: hit.x, y: hit.y };
      }
    }

    for (const decoy of this.decoySystem?.getHostTargets() ?? []) {
      if (proj.ownerId === decoy.ownerId) continue;
      if (proj.penetrationHitIds?.has(`decoy_${decoy.id}`)) continue;

      const decoyRadius = Math.max(decoy.sprite.displayWidth, decoy.sprite.displayHeight) * 0.5 + projectileRadius;
      const hit = this.findNearestCircleHit(line, decoy.sprite.x, decoy.sprite.y, decoyRadius);
      if (!hit) continue;
      if (blockerDistance !== null && blockerDistance < hit.distance - 0.75) continue;
      if (!bestHit || hit.distance < bestHit.distance) {
        bestHit = { kind: 'decoy', decoyId: decoy.id, distance: hit.distance, x: hit.x, y: hit.y };
      }
    }

    if (!bestHit) return false;

    const vx = proj.body.velocity.x;
    const vy = proj.body.velocity.y;
    proj.body.reset(bestHit.x, bestHit.y);
    proj.body.setVelocity(vx, vy);

    const loadoutMult = proj.sourceSlot === 'weapon1' || proj.sourceSlot === 'weapon2'
      ? (this.loadoutManager?.getWeaponDamageMultiplier(proj.ownerId, proj.sourceSlot, Date.now()) ?? 1)
      : (this.loadoutManager?.getDamageMultiplier(proj.ownerId) ?? 1);
    const powerUpMult = this.powerUpSystem?.getDamageMultiplier(proj.ownerId) ?? 1;
    const actualDamage = proj.damage * loadoutMult * powerUpMult;

    if (bestHit.kind === 'player') {
      const canDealDamage = this.canDamageTarget(proj.ownerId, bestHit.playerId, proj.allowTeamDamage);

      if (canDealDamage && this.shouldBlockWithShield(bestHit.playerId, 'projectile', actualDamage, bestHit.x, bestHit.y)) {
        const reflectionFactor = proj.reflected ? 0 : (this.energyShieldSystem?.getReflectionDamageFactor(bestHit.playerId) ?? 0);
        if (reflectionFactor > 0) {
          const speed = Math.hypot(proj.body.velocity.x, proj.body.velocity.y);
          const angle = Math.atan2(-proj.body.velocity.y, -proj.body.velocity.x);
          this.projectileManager.spawnProjectile(bestHit.x, bestHit.y, angle, bestHit.playerId, {
            speed,
            size: Math.max(1, proj.sprite.displayWidth),
            damage: proj.damage * reflectionFactor,
            color: proj.color,
            ownerColor: proj.ownerColor,
            lifetime: Math.max(1, proj.lifetime - (Date.now() - proj.createdAt)),
            maxBounces: 0,
            isGrenade: false,
            adrenalinGain: 0,
            weaponName: 'Reflektor',
            projectileStyle: proj.projectileStyle,
            bulletVisualPreset: proj.bulletVisualPreset,
            tracerConfig: proj.tracerConfig,
            reflected: true,
            sourceSlot: 'weapon2',
          });
        }
        this.projectileManager.destroyProjectile(proj.id);
        return true;
      }

      if (proj.penetrationHitIds) {
        proj.penetrationHitIds.add(bestHit.playerId);
        if (canDealDamage) {
          this.applyDamage(bestHit.playerId, actualDamage, false, proj.ownerId, proj.weaponName, { sourceX: bestHit.x, sourceY: bestHit.y, dirX: vx, dirY: vy }, { allowTeamDamage: proj.allowTeamDamage });
          this.applyProjectileBurn(bestHit.playerId, proj);
        }
        if ((proj.penetrationRemaining ?? 0) > 0) {
          proj.penetrationRemaining = (proj.penetrationRemaining ?? 0) - 1;
          proj.damage *= proj.penetrationDamageRetention ?? 1;
          return true;
        }
        this.projectileManager.destroyProjectile(proj.id);
        return true;
      }

      this.handleHit(proj.id, bestHit.playerId, actualDamage, proj.ownerId, proj.adrenalinGain, proj.weaponName, canDealDamage);
      return true;
    }

    if (bestHit.kind === 'enemy') {
      if (proj.penetrationHitIds) {
        proj.penetrationHitIds.add(`enemy_${bestHit.enemyId}`);
        this.applyDamage(bestHit.enemyId, actualDamage, false, proj.ownerId, proj.weaponName, { sourceX: bestHit.x, sourceY: bestHit.y, dirX: vx, dirY: vy }, { allowTeamDamage: proj.allowTeamDamage });
        this.applyProjectileBurn(bestHit.enemyId, proj);
        if ((proj.penetrationRemaining ?? 0) > 0) {
          proj.penetrationRemaining = (proj.penetrationRemaining ?? 0) - 1;
          proj.damage *= proj.penetrationDamageRetention ?? 1;
          return true;
        }
        this.projectileManager.destroyProjectile(proj.id);
        return true;
      }
      this.handleEnemyHit(proj.id, bestHit.enemyId, actualDamage, proj.ownerId, proj.adrenalinGain, proj.weaponName);
      return true;
    }

    if (proj.penetrationHitIds) {
      proj.penetrationHitIds.add(`decoy_${bestHit.decoyId}`);
      this.decoySystem?.applyDamage(bestHit.decoyId, actualDamage, proj.ownerId, proj.weaponName, { sourceX: bestHit.x, sourceY: bestHit.y, dirX: vx, dirY: vy });
      if ((proj.penetrationRemaining ?? 0) > 0) {
        proj.penetrationRemaining = (proj.penetrationRemaining ?? 0) - 1;
        proj.damage *= proj.penetrationDamageRetention ?? 1;
        return true;
      }
      this.projectileManager.destroyProjectile(proj.id);
      return true;
    }
    this.handleDecoyHit(proj.id, bestHit.decoyId, actualDamage, proj.ownerId, proj.adrenalinGain, proj.weaponName);
    return true;
  }

  private findNearestProjectilePathBlockerDistance(line: Phaser.Geom.Line): number | null {
    let bestDistance: number | null = null;

    if (this.rockObjects) {
      for (const rock of this.rockObjects) {
        if (!rock?.active) continue;
        const hit = this.findNearestRectangleHit(line, rock.getBounds());
        if (hit && (bestDistance === null || hit.distance < bestDistance)) {
          bestDistance = hit.distance;
        }
      }
    }

    if (this.trunkObjects) {
      for (const trunk of this.trunkObjects) {
        if (!trunk.active) continue;
        const hit = this.findNearestCircleHit(line, trunk.x, trunk.y, trunk.radius);
        if (hit && (bestDistance === null || hit.distance < bestDistance)) {
          bestDistance = hit.distance;
        }
      }
    }

    if (this.baseObstacles) {
      for (const base of this.baseObstacles) {
        if (!base.active) continue;
        const hit = this.findNearestRectangleHit(line, base.getBounds());
        if (hit && (bestDistance === null || hit.distance < bestDistance)) {
          bestDistance = hit.distance;
        }
      }
    }

    const trainBounds = this.computeTrainBounds();
    if (trainBounds) {
      const hit = this.findNearestRectangleHit(line, trainBounds);
      if (hit && (bestDistance === null || hit.distance < bestDistance)) {
        bestDistance = hit.distance;
      }
    }

    return bestDistance;
  }

  resolveHitscanShot(
    shooterId: string,
    startX: number,
    startY: number,
    angle: number,
    range: number,
    damage: number,
    traceThickness: number,
    playerColor: number,
    adrenalinGain: number,
    weaponName: string,
    visualPreset: HitscanVisualPreset = 'default',
    shotAudioKey?: ShotAudioKey,
    sourceSlot?: WeaponSlot,
    shotId?: number,
    detonatorCfg?: DetonatorConfig,
    rockDamageMult = 1,
    trainDamageMult = 1,
    chainCfg?: ChainLightningConfig,
    burnOnHit?: BurnOnHitConfig,
  ): boolean {
    if (!this.bridge.isHost()) return false;

    const trace = this.traceHitscan({
      shooterId,
      startX,
      startY,
      angle,
      range,
      traceThickness,
      applyFavorTheShooter: true,
    });

    this.queueHitscanTrace({
      startX: Math.round(startX),
      startY: Math.round(startY),
      endX: Math.round(trace.endX),
      endY: Math.round(trace.endY),
      color: playerColor,
      thickness: traceThickness,
      impactKind: (trace.hitPlayerId || trace.hitEnemyId) ? 'player' : (trace.hitObstacle ? 'environment' : 'none'),
      visualPreset,
      shooterId,
      shotId,
      shotAudioKey,
    });

    // Hitscan-Detonation prüfen (z.B. ASMD Primary zündet ASMD Secondary-Ball)
    if (detonatorCfg) {
      this.detonationSystem?.checkHitscanDetonations(
        startX, startY, trace.endX, trace.endY, shooterId, detonatorCfg,
      );
    }

    if (trace.hitPlayerId) {
      const loadoutMult  = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      const canDealDamage = this.canDamageTarget(shooterId, trace.hitPlayerId);
      if (canDealDamage && this.shouldBlockWithShield(trace.hitPlayerId, 'hitscan', actualDamage, startX, startY)) return true;
      this.applyDamage(trace.hitPlayerId, actualDamage, false, shooterId, weaponName, {
        sourceX: startX,
        sourceY: startY,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
      });

      if (canDealDamage) this.applyBurnOnHit(trace.hitPlayerId, shooterId, burnOnHit, weaponName);

      if (canDealDamage && adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
    } else if (trace.hitEnemyId) {
      const loadoutMult  = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      this.applyDamage(trace.hitEnemyId, actualDamage, false, shooterId, weaponName, {
        sourceX: startX,
        sourceY: startY,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
      });

      this.applyBurnOnHit(trace.hitEnemyId, shooterId, burnOnHit, weaponName);

      if (adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
    } else if (trace.hitDecoyId !== null) {
      const loadoutMult  = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      const hit = this.decoySystem?.applyDamage(trace.hitDecoyId, actualDamage, shooterId, weaponName, {
        sourceX: startX,
        sourceY: startY,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
      }) ?? false;

      if (hit && adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
    } else {
      // Kein Spieler getroffen → prüfen ob Fels oder Zug getroffen wurde
      this.applyHitscanObjectDamage(
        startX, startY, trace.endX, trace.endY,
        damage, rockDamageMult, trainDamageMult, shooterId,
      );
    }

    // Kettenblitz: vom Einschlagspunkt aus auf weitere Ziele überspringen.
    if (chainCfg && chainCfg.maxJumps > 0) {
      const loadoutMult = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
      const powerUpMult = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const baseChainDamage = damage * loadoutMult * powerUpMult;

      const visitedPlayers = new Set<string>();
      const visitedEnemies = new Set<string>();
      const visitedDecoys  = new Set<number>();
      if (trace.hitPlayerId)         visitedPlayers.add(trace.hitPlayerId);
      if (trace.hitEnemyId)          visitedEnemies.add(trace.hitEnemyId);
      if (trace.hitDecoyId !== null) visitedDecoys.add(trace.hitDecoyId);

      this.resolveChainLightning({
        shooterId,
        originX:       trace.endX,
        originY:       trace.endY,
        baseDamage:    baseChainDamage,
        chainCfg,
        weaponName,
        adrenalinGain,
        playerColor,
        visualPreset,
        baseThickness: traceThickness,
        visitedPlayers,
        visitedEnemies,
        visitedDecoys,
      });
    }

    return true;
  }

  // ── Kettenblitz ────────────────────────────────────────────────────────────

  /**
   * Lässt einen Hitscan-Treffer als Kettenblitz von Ziel zu Ziel überspringen.
   * Ausgangspunkt jedes Sprungs ist der letzte Einschlag; pro Sprung wird das
   * nächstgelegene noch nicht getroffene Ziel mit freier Sichtlinie gewählt.
   * Detonierbare Ziele (z.B. ASMD-Bälle) lösen ihre Detonation aus statt
   * direkten Schaden zu nehmen.
   */
  private resolveChainLightning(opts: {
    shooterId:      string;
    originX:        number;
    originY:        number;
    baseDamage:     number;   // Primärschaden inkl. Multiplikatoren
    chainCfg:       ChainLightningConfig;
    weaponName:     string;
    adrenalinGain:  number;
    playerColor:    number;
    visualPreset:   HitscanVisualPreset;
    baseThickness:  number;
    visitedPlayers: Set<string>;
    visitedEnemies: Set<string>;
    visitedDecoys:  Set<number>;
  }): void {
    const { chainCfg } = opts;
    const maxJumps = Math.floor(chainCfg.maxJumps);
    if (maxJumps <= 0 || opts.baseDamage <= 0) return;

    const falloffPerJump   = Math.max(0, chainCfg.damageFalloffPerJump);
    const thicknessFalloff = chainCfg.thicknessFalloffPerJump ?? 0.2;
    const detonableTags    = chainCfg.detonableTags ?? [];

    let originX = opts.originX;
    let originY = opts.originY;

    for (let jump = 1; jump <= maxJumps; jump++) {
      const target = this.findNearestChainTarget(originX, originY, opts.shooterId, chainCfg, detonableTags, opts);
      if (!target) break;

      // Tracer wie die Hitscan-Linie, je Sprung etwas schmaler.
      const thickness = Math.max(1, opts.baseThickness * Math.max(0.15, 1 - thicknessFalloff * jump));
      this.queueHitscanTrace({
        startX:      Math.round(originX),
        startY:      Math.round(originY),
        endX:        Math.round(target.x),
        endY:        Math.round(target.y),
        color:       opts.playerColor,
        thickness,
        impactKind:  'player',
        visualPreset: opts.visualPreset,
        shooterId:   opts.shooterId,
      });

      const jumpDamage = opts.baseDamage * Math.max(0, 1 - falloffPerJump * jump);
      const visualContext: DamageVisualContext = { sourceX: originX, sourceY: originY };

      if (target.kind === 'enemy') {
        opts.visitedEnemies.add(target.enemyId);
        this.applyDamage(target.enemyId, jumpDamage, false, opts.shooterId, opts.weaponName, visualContext);
        if (opts.adrenalinGain > 0) this.resourceSystem?.addAdrenaline(opts.shooterId, opts.adrenalinGain);
      } else if (target.kind === 'player') {
        opts.visitedPlayers.add(target.playerId);
        const canDeal = this.canDamageTarget(opts.shooterId, target.playerId);
        if (!(canDeal && this.shouldBlockWithShield(target.playerId, 'hitscan', jumpDamage, originX, originY))) {
          this.applyDamage(target.playerId, jumpDamage, false, opts.shooterId, opts.weaponName, visualContext);
          if (canDeal && opts.adrenalinGain > 0) this.resourceSystem?.addAdrenaline(opts.shooterId, opts.adrenalinGain);
        }
      } else if (target.kind === 'decoy') {
        opts.visitedDecoys.add(target.decoyId);
        this.decoySystem?.applyDamage(target.decoyId, jumpDamage, opts.shooterId, opts.weaponName, visualContext);
        if (opts.adrenalinGain > 0) this.resourceSystem?.addAdrenaline(opts.shooterId, opts.adrenalinGain);
      } else {
        // Detonierbares Ziel (z.B. ASMD-Ball) → Detonation auslösen; Projektil wird zerstört.
        this.detonationSystem?.detonateProjectile(target.projectileId, opts.shooterId);
      }

      originX = target.x;
      originY = target.y;
    }
  }

  /**
   * Sucht das nächstgelegene gültige Kettenblitz-Ziel innerhalb des Suchradius
   * mit freier Sichtlinie zum Ausgangspunkt. Bereits getroffene Ziele werden
   * übersprungen. Priorität: geringste Distanz.
   */
  private findNearestChainTarget(
    originX:        number,
    originY:        number,
    shooterId:      string,
    chainCfg:       ChainLightningConfig,
    detonableTags:  readonly string[],
    visited: {
      visitedPlayers: ReadonlySet<string>;
      visitedEnemies: ReadonlySet<string>;
      visitedDecoys:  ReadonlySet<number>;
    },
  ): ChainTarget | null {
    const radiusSq = chainCfg.searchRadius * chainCfg.searchRadius;
    let best: ChainTarget | null = null;
    let bestDistSq = Number.POSITIVE_INFINITY;

    const consider = (x: number, y: number, build: () => ChainTarget): void => {
      const dx = x - originX;
      const dy = y - originY;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq || distSq >= bestDistSq) return;
      if (!this.hasChainLineOfSight(originX, originY, x, y)) return;
      best = build();
      bestDistSq = distSq;
    };

    if (chainCfg.targetEnemies) {
      for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
        if (enemy.id === shooterId || visited.visitedEnemies.has(enemy.id)) continue;
        consider(enemy.sprite.x, enemy.sprite.y, () => ({ kind: 'enemy', enemyId: enemy.id, x: enemy.sprite.x, y: enemy.sprite.y }));
      }
    }

    if (chainCfg.targetPlayers) {
      for (const player of this.playerManager.getAllPlayers()) {
        if (player.id === shooterId || visited.visitedPlayers.has(player.id)) continue;
        if (!this.isAlive(player.id) || this.burrowSystem?.isBurrowed(player.id)) continue;
        if (!this.canDamageTarget(shooterId, player.id)) continue;
        consider(player.sprite.x, player.sprite.y, () => ({ kind: 'player', playerId: player.id, x: player.sprite.x, y: player.sprite.y }));
      }
    }

    if (chainCfg.targetDecoys) {
      for (const decoy of this.decoySystem?.getHostTargets() ?? []) {
        if (decoy.ownerId === shooterId || visited.visitedDecoys.has(decoy.id)) continue;
        consider(decoy.sprite.x, decoy.sprite.y, () => ({ kind: 'decoy', decoyId: decoy.id, x: decoy.sprite.x, y: decoy.sprite.y }));
      }
    }

    if (detonableTags.length > 0) {
      for (const proj of this.projectileManager.getActiveProjectiles()) {
        if (!proj.detonable || !detonableTags.includes(proj.detonable.tag)) continue;
        if (!proj.detonable.allowCrossTeam && proj.ownerId !== shooterId) continue;
        const projId = proj.id;
        consider(proj.sprite.x, proj.sprite.y, () => ({ kind: 'detonable', projectileId: projId, x: proj.sprite.x, y: proj.sprite.y }));
      }
    }

    return best;
  }

  /**
   * Sichtlinie für Kettenblitz-Sprünge: blockiert durch Felsen, Baumstämme,
   * Basen und den Zug – analog zur normalen Hitscan-/Projektil-Hindernislogik.
   */
  private hasChainLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    this.chainScanLine.setTo(x1, y1, x2, y2);
    const dist = Phaser.Geom.Line.Length(this.chainScanLine);
    if (dist <= 0.0001) return true;
    const blockerDistance = this.findNearestProjectilePathBlockerDistance(this.chainScanLine);
    return blockerDistance === null || blockerDistance >= dist - 1;
  }

  /**
   * Prüft, ob der Hitscan-Endpunkt einen Fels oder Zug trifft, und wendet Schaden an.
   */
  private applyHitscanObjectDamage(
    startX: number, startY: number, endX: number, endY: number,
    damage: number, rockMult: number, trainMult: number, shooterId: string,
  ): void {
    const hitLine = new Phaser.Geom.Line(startX, startY, endX, endY);
    const endDist = Phaser.Geom.Line.Length(hitLine);
    const EPSILON = 2; // Toleranz in px

    // Nächsten Fels am Endpunkt suchen
    if (rockMult !== 0 && this.rockObjects && this.onRockDamage) {
      let bestRockIdx = -1;
      let bestRockDist = Infinity;
      for (let i = 0; i < this.rockObjects.length; i++) {
        const rock = this.rockObjects[i];
        if (!rock?.active) continue;
        const hit = this.findNearestRectangleHit(hitLine, rock.getBounds());
        if (hit && Math.abs(hit.distance - endDist) < EPSILON && hit.distance < bestRockDist) {
          bestRockDist = hit.distance;
          bestRockIdx = i;
        }
      }
      if (bestRockIdx >= 0) {
        this.onRockDamage(bestRockIdx, damage * rockMult, shooterId);
        return; // Fels blockiert – kein Zug dahinter
      }
    }

    // Zug-Bounding-Box am Endpunkt suchen (gesamter Zug als ein Block, keine Lücken)
    if (trainMult !== 0 && this.trainSegObjects && this.onTrainDamage) {
      const trainBounds = this.computeTrainBounds();
      if (trainBounds) {
        const hit = this.findNearestRectangleHit(hitLine, trainBounds);
        if (hit && Math.abs(hit.distance - endDist) < EPSILON) {
          this.onTrainDamage(damage * trainMult, shooterId);
        }
      }
    }
  }

  // collectReplicatedHitscanTraces entfernt – Traces werden per RPC gesendet

  // ── Melee-Angriff ─────────────────────────────────────────────────────────

  /**
   * Löst einen Melee-Angriff aus.
   * Trifft ALLE Gegner, die sich im Trefferbereich befinden (Fächerform).
   * Hindernisse (Felsen, Baumstämme) blockieren den Angriff auf dahinter stehende Ziele.
   * Gibt true zurück wenn der Angriff verarbeitet wurde (Host-only).
   */
  resolveMeleeSwing(
    shooterId:     string,
    x:             number,
    y:             number,
    angle:         number,
    range:         number,
    arcDegrees:    number,
    damage:        number,
    adrenalinGain: number,
    weaponName:    string,
    playerColor:   number,
    sourceSlot?:   WeaponSlot,
    rockDamageMult  = 1,
    trainDamageMult = 1,
    visualPreset: MeleeVisualPreset = 'default',
    shotAudioKey?: string,
    burnOnHit?: BurnOnHitConfig,
    chain?: { count: number; radius: number; damageFactor: number },
    hitHeal = 0,
    hitAdrenaline = 0,
    bloodEffectMultiplier = 1,
  ): boolean {
    if (!this.bridge.isHost()) return false;

    const halfArcRad = (arcDegrees * Math.PI / 180) / 2;
    let hitPlayer = false;
    let nearestHitDistance = Number.POSITIVE_INFINITY;
    let impactX: number | undefined;
    let impactY: number | undefined;
    const meleeHitIds = new Set<string>();

    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.isMeleeTargetCandidate(player.id, shooterId)) continue;

      const dx   = player.sprite.x - x;
      const dy   = player.sprite.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Reichweite – Spieler-Radius als Toleranz hinzurechnen
      if (dist > range + PLAYER_SIZE * 0.5) continue;

      // Winkelprüfung: liegt das Ziel innerhalb des Trefferbogens?
      let angleDiff = Math.atan2(dy, dx) - angle;
      while (angleDiff >  Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      if (Math.abs(angleDiff) > halfArcRad) continue;

      // Hindernischeck: liegt ein Fels/Stamm zwischen Schütze und Ziel?
      this.meleeLine.setTo(x, y, player.sprite.x, player.sprite.y);
      if (this.isMeleePathBlocked(dist - PLAYER_SIZE * 0.5)) continue;

      const loadoutMult  = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      const canDealDamage = this.canDamageTarget(shooterId, player.id);
      if (canDealDamage && this.shouldBlockWithShield(player.id, 'melee', actualDamage, x, y)) continue;
      this.applyDamage(player.id, actualDamage, false, shooterId, weaponName, {
        sourceX: x,
        sourceY: y,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
      });
      this.applyBurnOnHit(player.id, shooterId, burnOnHit, weaponName);
      meleeHitIds.add(player.id);
      hitPlayer = true;
      if (dist < nearestHitDistance) {
        nearestHitDistance = dist;
        impactX = player.sprite.x;
        impactY = player.sprite.y;
      }

      if (canDealDamage && adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
      if (canDealDamage) this.applyMeleeHitRewards(shooterId, hitHeal, hitAdrenaline);
    }

    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
      if (enemy.id === shooterId) continue;

      const enemyRadius = Math.max(enemy.sprite.displayWidth, enemy.sprite.displayHeight) * 0.5;
      const dx   = enemy.sprite.x - x;
      const dy   = enemy.sprite.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > range + enemyRadius) continue;

      let angleDiff = Math.atan2(dy, dx) - angle;
      while (angleDiff >  Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      if (Math.abs(angleDiff) > halfArcRad) continue;

      this.meleeLine.setTo(x, y, enemy.sprite.x, enemy.sprite.y);
      if (this.isMeleePathBlocked(dist - enemyRadius)) continue;

      const loadoutMult  = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      this.applyDamage(enemy.id, actualDamage, false, shooterId, weaponName, {
        sourceX: x,
        sourceY: y,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
      });
      this.applyBurnOnHit(enemy.id, shooterId, burnOnHit, weaponName);
      meleeHitIds.add(enemy.id);
      hitPlayer = true;
      if (dist < nearestHitDistance) {
        nearestHitDistance = dist;
        impactX = enemy.sprite.x;
        impactY = enemy.sprite.y;
      }

      if (adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
      this.applyMeleeHitRewards(shooterId, hitHeal, hitAdrenaline);
    }

    for (const decoy of this.decoySystem?.getHostTargets() ?? []) {
      if (decoy.ownerId === shooterId) continue;

      const dx   = decoy.sprite.x - x;
      const dy   = decoy.sprite.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > range + PLAYER_SIZE * 0.5) continue;

      let angleDiff = Math.atan2(dy, dx) - angle;
      while (angleDiff >  Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      if (Math.abs(angleDiff) > halfArcRad) continue;

      this.meleeLine.setTo(x, y, decoy.sprite.x, decoy.sprite.y);
      if (this.isMeleePathBlocked(dist - PLAYER_SIZE * 0.5)) continue;

      const loadoutMult  = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
      const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      const hit = this.decoySystem?.applyDamage(decoy.id, actualDamage, shooterId, weaponName, {
        sourceX: x,
        sourceY: y,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
      }) ?? false;
      if (!hit) continue;

      hitPlayer = true;
      if (dist < nearestHitDistance) {
        nearestHitDistance = dist;
        impactX = decoy.sprite.x;
        impactY = decoy.sprite.y;
      }

      if (adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
    }

    if (chain && chain.count > 0 && chain.radius > 0 && impactX !== undefined && impactY !== undefined) {
      let chainX = impactX;
      let chainY = impactY;
      let chainDamage = damage;
      for (let jump = 0; jump < chain.count; jump += 1) {
        let next: { id: string; x: number; y: number } | null = null;
        let best = chain.radius;
        const candidates = [
          ...this.playerManager.getAllPlayers().map(player => ({ id: player.id, x: player.sprite.x, y: player.sprite.y })),
          ...(this.enemyManager?.getAllEnemies() ?? []).map(enemy => ({ id: enemy.id, x: enemy.sprite.x, y: enemy.sprite.y })),
        ];
        for (const candidate of candidates) {
          if (candidate.id === shooterId || meleeHitIds.has(candidate.id) || !this.isAlive(candidate.id) || !this.canDamageTarget(shooterId, candidate.id)) continue;
          const distance = Phaser.Math.Distance.Between(chainX, chainY, candidate.x, candidate.y);
          if (distance > best) continue;
          best = distance;
          next = candidate;
        }
        if (!next) break;
        meleeHitIds.add(next.id);
        chainDamage *= chain.damageFactor;
        this.applyDamage(next.id, chainDamage, false, shooterId, weaponName, { sourceX: chainX, sourceY: chainY });
        chainX = next.x;
        chainY = next.y;
      }
    }

    if (this.enemyManager?.hasEnemy(shooterId)) {
      const baseHit = this.applyMeleeBaseDamage(
        x,
        y,
        angle,
        range,
        halfArcRad,
        damage,
        shooterId,
        weaponName,
        sourceSlot,
      );
      if (baseHit.hit && baseHit.distance < nearestHitDistance) {
        nearestHitDistance = baseHit.distance;
        impactX = baseHit.impactX;
        impactY = baseHit.impactY;
      }
    }

    // Melee-Objektschaden: Felsen und Zug im Trefferbogen prüfen
    this.applyMeleeObjectDamage(x, y, angle, range, halfArcRad, damage, rockDamageMult, trainDamageMult, shooterId);

    // Swing-VFX für alle Clients in die Replikations-Queue einreihen
    this.queueMeleeSwing({ x, y, angle, arcDegrees, range, color: playerColor, shooterId, visualPreset, hitPlayer, impactX, impactY, bloodEffectMultiplier, shotAudioKey });
    return true;
  }

  // collectReplicatedMeleeSwings entfernt – Swings werden per RPC gesendet

  private applyMeleeHitRewards(shooterId: string, hitHeal: number, hitAdrenaline: number): void {
    if (hitHeal > 0) this.heal(shooterId, hitHeal);
    if (hitAdrenaline > 0) this.resourceSystem?.addAdrenaline(shooterId, hitAdrenaline);
  }

  /**
   * Prüft, ob Felsen oder Zug-Segmente im Melee-Trefferbogen liegen, und wendet Schaden an.
   */
  private applyMeleeObjectDamage(
    x: number, y: number, angle: number, range: number, halfArcRad: number,
    damage: number, rockMult: number, trainMult: number, shooterId: string,
  ): void {
    // Felsschaden
    if (rockMult !== 0 && this.rockObjects && this.onRockDamage) {
      for (let i = 0; i < this.rockObjects.length; i++) {
        const rock = this.rockObjects[i];
        if (!rock?.active) continue;
        const dx   = rock.x - x;
        const dy   = rock.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > range) continue;
        let ad = Math.atan2(dy, dx) - angle;
        while (ad >  Math.PI) ad -= 2 * Math.PI;
        while (ad < -Math.PI) ad += 2 * Math.PI;
        if (Math.abs(ad) > halfArcRad) continue;
        this.onRockDamage(i, damage * rockMult, shooterId);
      }
    }

    // Zugschaden
    if (trainMult !== 0 && this.trainSegObjects && this.onTrainDamage) {
      for (const seg of this.trainSegObjects) {
        if (!seg.active) continue;
        const dx   = seg.x - x;
        const dy   = seg.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > range) continue;
        let ad = Math.atan2(dy, dx) - angle;
        while (ad >  Math.PI) ad -= 2 * Math.PI;
        while (ad < -Math.PI) ad += 2 * Math.PI;
        if (Math.abs(ad) > halfArcRad) continue;
        this.onTrainDamage(damage * trainMult, shooterId);
        break; // Nur einmal pro Swing den Zug treffen
      }
    }
  }

  private applyMeleeBaseDamage(
    x: number,
    y: number,
    angle: number,
    range: number,
    halfArcRad: number,
    damage: number,
    shooterId: string,
    weaponName: string,
    sourceSlot?: WeaponSlot,
  ): { hit: boolean; distance: number; impactX?: number; impactY?: number } {
    let hit = false;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let impactX: number | undefined;
    let impactY: number | undefined;

    for (const base of this.baseManager?.getBases() ?? []) {
      if (base.getHp() <= 0) continue;

      const surface = base.getNearestSurfacePoint(x, y);
      if (!surface) continue;
      const targetX = surface.x;
      const targetY = surface.y;
      const dx = targetX - x;
      const dy = targetY - y;
      const dist = surface.distance;

      if (dist > range) continue;

      let angleDiff = Math.atan2(dy, dx) - angle;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      if (Math.abs(angleDiff) > halfArcRad) continue;

      this.meleeLine.setTo(x, y, targetX, targetY);
      if (this.isMeleePathBlocked(Math.max(0, dist - 0.5))) continue;

      const loadoutMult = sourceSlot
        ? (this.loadoutManager?.getWeaponDamageMultiplier(shooterId, sourceSlot, Date.now()) ?? 1)
        : (this.loadoutManager?.getDamageMultiplier(shooterId) ?? 1);
      const powerUpMult = this.powerUpSystem?.getDamageMultiplier(shooterId) ?? 1;
      const actualDamage = damage * loadoutMult * powerUpMult;
      this.baseManager?.applyDamage(base.id, actualDamage);
      hit = true;

      if (dist < nearestDistance) {
        nearestDistance = dist;
        impactX = targetX;
        impactY = targetY;
      }
    }

    return { hit, distance: nearestDistance, impactX, impactY };
  }

  traceHitscan(options: HitscanTraceOptions): HitscanTraceResult {
    const { shooterId, startX, startY, angle, range, traceThickness, applyFavorTheShooter } = options;

    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const maxEndX = startX + dirX * range;
    const maxEndY = startY + dirY * range;
    this.hitscanLine.setTo(startX, startY, maxEndX, maxEndY);

    let closestDistance = Phaser.Geom.Line.Length(this.hitscanLine);
    const obstacleHit = this.findNearestObstacleHit(this.hitscanLine);
    if (obstacleHit) closestDistance = obstacleHit.distance;

    let hitPlayerId: string | null = null;
    let hitEnemyId: string | null = null;
    let hitDecoyId: number | null = null;
    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.isHitscanTargetCandidate(player.id, shooterId)) continue;

      const hitDistance = this.getHitscanTargetHitDistance(
        this.hitscanLine,
        player,
        traceThickness,
        applyFavorTheShooter,
      );
      if (hitDistance === null || hitDistance > closestDistance) continue;

      closestDistance = hitDistance;
      hitPlayerId = player.id;
      hitEnemyId = null;
      hitDecoyId = null;
    }

    for (const enemy of this.enemyManager?.getAllEnemies() ?? []) {
      if (enemy.id === shooterId) continue;

      const hitDistance = this.getHitscanTargetHitDistance(
        this.hitscanLine,
        { sprite: enemy.sprite, body: enemy.sprite.body as Phaser.Physics.Arcade.Body | null },
        traceThickness,
        applyFavorTheShooter,
      );
      if (hitDistance === null || hitDistance > closestDistance) continue;

      closestDistance = hitDistance;
      hitPlayerId = null;
      hitEnemyId = enemy.id;
      hitDecoyId = null;
    }

    for (const decoy of this.decoySystem?.getHostTargets() ?? []) {
      if (decoy.ownerId === shooterId) continue;

      const hitDistance = this.getHitscanTargetHitDistance(
        this.hitscanLine,
        decoy,
        traceThickness,
        applyFavorTheShooter,
      );
      if (hitDistance === null || hitDistance > closestDistance) continue;

      closestDistance = hitDistance;
      hitPlayerId = null;
      hitEnemyId = null;
      hitDecoyId = decoy.id;
    }

    return {
      endX: startX + dirX * closestDistance,
      endY: startY + dirY * closestDistance,
      distance: closestDistance,
      hitPlayerId,
      hitEnemyId,
      hitDecoyId,
      hitObstacle: obstacleHit !== null && closestDistance >= obstacleHit.distance,
    };
  }

  // ── LoS-Check (für BFG-Laser) ──────────────────────────────────────────────

  /**
   * Prüft, ob eine direkte Sichtlinie zwischen zwei Punkten besteht.
   * Felsen und Baumstämme blockieren die Sichtlinie; Arena-Wände und Zug nicht.
   */
  hasLineOfSight(
    startX: number, startY: number,
    endX: number, endY: number,
    skipRockIndex?: number,
  ): boolean {
    const line = new Phaser.Geom.Line(startX, startY, endX, endY);
    const targetDist = Phaser.Geom.Line.Length(line);

    if (this.rockObjects) {
      for (let i = 0; i < this.rockObjects.length; i++) {
        if (i === skipRockIndex) continue;
        const rock = this.rockObjects[i];
        if (!rock?.active) continue;
        const hit = this.findNearestRectangleHit(line, rock.getBounds());
        if (hit && hit.distance < targetDist - 2) return false;
      }
    }

    if (this.trunkObjects) {
      for (const trunk of this.trunkObjects) {
        if (!trunk.active) continue;
        const hit = this.findNearestCircleHit(line, trunk.x, trunk.y, trunk.radius);
        if (hit && hit.distance < targetDist - 2) return false;
      }
    }

    if (this.baseObstacles) {
      for (const base of this.baseObstacles) {
        if (!base.active) continue;
        const hit = this.findNearestRectangleHit(line, base.getBounds());
        if (hit && hit.distance < targetDist - 2) return false;
      }
    }

    return true;
  }

  // ── Privat: Treffer, Tod, Respawn ──────────────────────────────────────────

  private queueHitscanTrace(trace: SyncedHitscanTrace): void {
    // Direkt per RPC an alle Clients senden (einmalig, statt per-frame in GameState)
    this.bridge.broadcastHitscanTracer(
      trace.startX, trace.startY, trace.endX, trace.endY,
      trace.color, trace.thickness, trace.impactKind, trace.visualPreset, trace.shooterId, trace.shotId, trace.shotAudioKey,
    );
    // Lokale Wiedergabe auf dem Host (EffectSystem bekommt das RPC auch)
  }

  private queueMeleeSwing(swing: Omit<SyncedMeleeSwing, 'swingId'>): void {
    const fullSwing: SyncedMeleeSwing = { ...swing, swingId: ++this.meleeSwingIdCounter };
    // Direkt per RPC an alle Clients senden
    this.bridge.broadcastMeleeSwing(fullSwing);
  }

  /**
   * Prüft, ob ein Hindernis (Fels oder Baumstamm) die aktuelle meleeLine
   * vor der angegebenen Distanz blockiert (Arena-Außenwände werden ignoriert,
   * da Ziele immer innerhalb der Arena stehen).
   */
  private isMeleePathBlocked(maxDist: number): boolean {
    if (this.rockObjects) {
      for (const rock of this.rockObjects) {
        if (!rock?.active) continue;
        const hit = this.findNearestRectangleHit(this.meleeLine, rock.getBounds());
        if (hit && hit.distance < maxDist) return true;
      }
    }
    if (this.trunkObjects) {
      for (const trunk of this.trunkObjects) {
        if (!trunk.active) continue;
        const hit = this.findNearestCircleHit(this.meleeLine, trunk.x, trunk.y, trunk.radius);
        if (hit && hit.distance < maxDist) return true;
      }
    }
    if (this.baseObstacles) {
      for (const base of this.baseObstacles) {
        if (!base.active) continue;
        const hit = this.findNearestRectangleHit(this.meleeLine, base.getBounds());
        if (hit && hit.distance < maxDist) return true;
      }
    }
    return false;
  }

  private isMeleeTargetCandidate(playerId: string, shooterId: string): boolean {
    if (playerId === shooterId) return false;
    if (!this.isAlive(playerId)) return false;
    if (this.burrowSystem?.isBurrowed(playerId)) return false;
    return true;
  }

  private isHitscanTargetCandidate(playerId: string, shooterId: string): boolean {
    if (playerId === shooterId) return false;
    if (!this.isHitscanTargetAlive(playerId)) return false;
    if (this.isHitscanTargetBurrowed(playerId)) return false;
    return true;
  }

  private isHitscanTargetAlive(playerId: string): boolean {
    if (this.bridge.isHost()) return this.isAlive(playerId);
    return this.bridge.getLatestGameState()?.players[playerId]?.alive ?? true;
  }

  private isHitscanTargetBurrowed(playerId: string): boolean {
    if (this.burrowSystem) return this.burrowSystem.isBurrowed(playerId);
    return this.bridge.getLatestGameState()?.players[playerId]?.isBurrowed ?? false;
  }

  private getHitscanTargetHitDistance(
    line: Phaser.Geom.Line,
    target: HitscanSpriteTarget,
    traceThickness: number,
    applyFavorTheShooter: boolean,
  ): number | null {
    if (applyFavorTheShooter) {
      return this.getFavorTheShooterHitDistance(line, target, traceThickness);
    }

    const baseRadius = Math.max(target.sprite.displayWidth, target.sprite.displayHeight) * 0.5 + traceThickness * 0.5;
    return this.findNearestCircleHit(line, target.sprite.x, target.sprite.y, baseRadius)?.distance ?? null;
  }

  private findNearestObstacleHit(
    line: Phaser.Geom.Line,
  ): { distance: number; x: number; y: number } | null {
    let bestHit = this.findNearestRectangleHit(line, this.arenaBounds);

    if (this.rockObjects) {
      for (const rock of this.rockObjects) {
        if (!rock?.active) continue;
        const hit = this.findNearestRectangleHit(line, rock.getBounds());
        if (hit && (!bestHit || hit.distance < bestHit.distance)) bestHit = hit;
      }
    }

    if (this.trunkObjects) {
      for (const trunk of this.trunkObjects) {
        if (!trunk.active) continue;
        const hit = this.findNearestCircleHit(line, trunk.x, trunk.y, trunk.radius);
        if (hit && (!bestHit || hit.distance < bestHit.distance)) bestHit = hit;
      }
    }

    if (this.baseObstacles) {
      for (const base of this.baseObstacles) {
        if (!base.active) continue;
        const hit = this.findNearestRectangleHit(line, base.getBounds());
        if (hit && (!bestHit || hit.distance < bestHit.distance)) bestHit = hit;
      }
    }

    const trainBounds = this.computeTrainBounds();
    if (trainBounds) {
      const hit = this.findNearestRectangleHit(line, trainBounds);
      if (hit && (!bestHit || hit.distance < bestHit.distance)) bestHit = hit;
    }

    return bestHit;
  }

  private getFavorTheShooterHitDistance(
    line: Phaser.Geom.Line,
    target: HitscanSpriteTarget,
    traceThickness: number,
  ): number | null {
    const baseRadius = Math.max(target.sprite.displayWidth, target.sprite.displayHeight) * 0.5 + traceThickness * 0.5;
    const currentHit = this.findNearestCircleHit(line, target.sprite.x, target.sprite.y, baseRadius);

    const velocity = target.body?.velocity ?? { x: 0, y: 0 };
    const rewindX = target.sprite.x - velocity.x * (HITSCAN_FAVOR_THE_SHOOTER_MS / 1000);
    const rewindY = target.sprite.y - velocity.y * (HITSCAN_FAVOR_THE_SHOOTER_MS / 1000);
    const rewindHit = this.findNearestCircleHit(line, rewindX, rewindY, baseRadius);

    const rewindOffset = Math.min(
      HITSCAN_FAVOR_THE_SHOOTER_MAX_OFFSET,
      Phaser.Math.Distance.Between(target.sprite.x, target.sprite.y, rewindX, rewindY),
    );
    const sweepHit = this.findNearestCircleHit(
      line,
      (target.sprite.x + rewindX) * 0.5,
      (target.sprite.y + rewindY) * 0.5,
      baseRadius + rewindOffset * 0.5,
    );

    return [currentHit, rewindHit, sweepHit]
      .filter((hit): hit is { distance: number; x: number; y: number } => hit !== null)
      .reduce<number | null>((best, hit) => {
        if (best === null || hit.distance < best) return hit.distance;
        return best;
      }, null);
  }

  /**
   * Berechnet die kombinierte Bounding-Box aller aktiven Zug-Segmente.
   * Behandelt den gesamten Zug (inkl. Lücken) als ein zusammenhängendes Hindernis.
   * Gibt null zurück wenn kein aktives Segment vorhanden.
   */
  private computeTrainBounds(): Phaser.Geom.Rectangle | null {
    if (!this.trainSegObjects || this.trainSegObjects.length === 0) return this.clientTrainBounds;
    let minY = Infinity, maxY = -Infinity;
    let trainX = 0, trainW = 0;
    let anyActive = false;
    for (const seg of this.trainSegObjects) {
      if (!seg.active) continue;
      anyActive = true;
      const b = seg.getBounds();
      if (b.top    < minY) minY = b.top;
      if (b.bottom > maxY) maxY = b.bottom;
      trainX = b.x;
      trainW = b.width;
    }
    if (!anyActive) return null;
    return this.scratchTrainRect.setTo(trainX, minY, trainW, maxY - minY);
  }

  private findNearestRectangleHit(
    line: Phaser.Geom.Line,
    rect: Phaser.Geom.Rectangle,
  ): GeometryHit | null {
    return geomNearestRectangleHit(line, rect, this.scratchPoints);
  }

  private findNearestCircleHit(
    line: Phaser.Geom.Line,
    centerX: number,
    centerY: number,
    radius: number,
  ): GeometryHit | null {
    return geomNearestCircleHit(line, centerX, centerY, radius, this.scratchCircle, this.scratchPoints);
  }

  private nextEffectSeed(): number {
    const seed = Math.imul(this.effectSeedCounter++, 0x9e3779b1);
    return seed >>> 0;
  }

  private buildHitEffect(
    targetId: string,
    x: number,
    y: number,
    attackerId: string | undefined,
    totalDamage: number,
    hpLost: number,
    armorLost: number,
    isKill: boolean,
    visualContext: DamageVisualContext | undefined,
    seed: number,
  ): SyncedHitEffect {
    const target = this.playerManager.getPlayer(targetId);
    const direction = this.resolveDamageDirection(targetId, attackerId, visualContext, seed, x, y);

    return {
      type: 'hit',
      x,
      y,
      targetId,
      shooterId: attackerId,
      targetColor: target?.color,
      totalDamage,
      hpLost,
      armorLost,
      isKill,
      dirX: direction.dirX,
      dirY: direction.dirY,
      seed,
    };
  }

  private buildDeathEffect(playerId: string, x: number, y: number, seed: number): SyncedDeathEffect {
    const player = this.playerManager.getPlayer(playerId);
    return {
      type: 'death',
      x,
      y,
      targetId: playerId,
      targetColor: player?.color,
      rotation: player?.sprite.rotation ?? 0,
      seed,
    };
  }

  private resolveDamageDirection(
    targetId: string,
    attackerId: string | undefined,
    visualContext: DamageVisualContext | undefined,
    seed: number,
    targetX: number,
    targetY: number,
  ): { dirX: number; dirY: number } {
    let dirX = visualContext?.dirX ?? 0;
    let dirY = visualContext?.dirY ?? 0;

    if (Math.hypot(dirX, dirY) <= 0.0001 && visualContext?.sourceX !== undefined && visualContext?.sourceY !== undefined) {
      dirX = targetX - visualContext.sourceX;
      dirY = targetY - visualContext.sourceY;
    }

    if (Math.hypot(dirX, dirY) <= 0.0001 && attackerId) {
      const attacker = this.playerManager.getPlayer(attackerId);
      const enemyAttacker = this.enemyManager?.getEnemy(attackerId);
      if (attacker) {
        dirX = targetX - attacker.sprite.x;
        dirY = targetY - attacker.sprite.y;
      } else if (enemyAttacker) {
        dirX = targetX - enemyAttacker.sprite.x;
        dirY = targetY - enemyAttacker.sprite.y;
      }
    }

    const len = Math.hypot(dirX, dirY);
    if (len > 0.0001) {
      return { dirX: dirX / len, dirY: dirY / len };
    }

    return this.fallbackDamageDirection(targetX, targetY, seed);
  }

  private fallbackDamageDirection(targetX: number, targetY: number, seed: number): { dirX: number; dirY: number } {
    const centerX = ARENA_OFFSET_X + ARENA_WIDTH / 2;
    const centerY = ARENA_OFFSET_Y + ARENA_HEIGHT / 2;
    const baseAngle = Math.atan2(targetY - centerY, targetX - centerX);
    const jitterDeg = ((seed >>> 5) % 41) - 20;
    const angle = Number.isFinite(baseAngle)
      ? baseAngle + jitterDeg * (Math.PI / 180)
      : (seed % 360) * (Math.PI / 180);
    return { dirX: Math.cos(angle), dirY: Math.sin(angle) };
  }

  private handleHit(
    projectileId:  number,
    playerId:      string,
    damage:        number,
    shooterId:     string,
    adrenalinGain: number,
    weaponName:    string,
    allowDamage = true,
  ): void {
    const projectile = this.projectileManager.getActiveProjectiles().find(p => p.id === projectileId);
    const leafBlowerImpulse = projectile ? this.createLeafBlowerImpulse(projectile, playerId) : null;
    const visualContext: DamageVisualContext | undefined = projectile
      ? {
          sourceX: projectile.sprite.x,
          sourceY: projectile.sprite.y,
          dirX: projectile.body.velocity.x,
          dirY: projectile.body.velocity.y,
          projectileColor: projectile.color,
        }
      : undefined;
    if (projectile?.impactCloud) {
      this.onProjectileImpact?.(projectileId, projectile.sprite.x, projectile.sprite.y);
    }
    if (allowDamage && this.hasEnemyHitExplosion(projectile)) {
      // Explosion nur bei tatsächlichem Treffer auf einen gültigen Gegner (z.B. XXX-BOW Explosivbolzen).
      this.projectileManager.triggerEnemyImpactExplosion(projectileId);
    } else if (projectile?.explosion) {
      this.projectileManager.triggerProjectileExplosion(projectileId, `players:${playerId}`);
    } else {
      this.projectileManager.destroyProjectile(projectileId);
    }
    if (allowDamage) {
      this.applyDamage(playerId, damage, false, shooterId, weaponName, visualContext);
      this.applyProjectileBurn(playerId, projectile);
      if (leafBlowerImpulse && this.isAlive(playerId)) {
        this.onPlayerImpulse?.(playerId, leafBlowerImpulse.vx, leafBlowerImpulse.vy, leafBlowerImpulse.durationMs, shooterId);
      }
    }

    // Adrenalin-Belohnung für den Schützen
    if (allowDamage && adrenalinGain > 0) {
      this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
    }
  }

  private handleEnemyHit(
    projectileId: number,
    enemyId: string,
    damage: number,
    shooterId: string,
    adrenalinGain: number,
    weaponName: string,
  ): void {
    const projectile = this.projectileManager.getActiveProjectiles().find(p => p.id === projectileId);
    const leafBlowerImpulse = projectile ? this.createLeafBlowerImpulse(projectile, enemyId) : null;
    const visualContext = projectile
      ? {
          sourceX: projectile.sprite.x,
          sourceY: projectile.sprite.y,
          dirX: projectile.body.velocity.x,
          dirY: projectile.body.velocity.y,
          projectileColor: projectile.color,
        }
      : undefined;
    if (projectile?.impactCloud) {
      this.onProjectileImpact?.(projectileId, projectile.sprite.x, projectile.sprite.y);
    }
    if (this.hasEnemyHitExplosion(projectile)) {
      // Explosion nur bei Gegner-Treffer (z.B. XXX-BOW Explosivbolzen).
      this.projectileManager.triggerEnemyImpactExplosion(projectileId);
    } else if (projectile?.explosion) {
      this.projectileManager.triggerProjectileExplosion(projectileId, `enemies:${enemyId}`);
    } else {
      this.projectileManager.destroyProjectile(projectileId);
    }

    this.applyDamage(enemyId, damage, false, shooterId, weaponName, visualContext);
    this.applyProjectileBurn(enemyId, projectile);
    if (leafBlowerImpulse && this.enemyManager?.hasEnemy(enemyId)) {
      this.onEnemyImpulse?.(enemyId, leafBlowerImpulse.vx, leafBlowerImpulse.vy, leafBlowerImpulse.durationMs, shooterId);
    }

    if (adrenalinGain > 0) {
      this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
    }
  }

  private handleDecoyHit(
    projectileId: number,
    decoyId: number,
    damage: number,
    shooterId: string,
    adrenalinGain: number,
    weaponName: string,
  ): void {
    const projectile = this.projectileManager.getActiveProjectiles().find(p => p.id === projectileId);
    const visualContext = projectile
      ? {
          sourceX: projectile.sprite.x,
          sourceY: projectile.sprite.y,
          dirX: projectile.body.velocity.x,
          dirY: projectile.body.velocity.y,
        }
      : undefined;
    if (projectile?.impactCloud) {
      this.onProjectileImpact?.(projectileId, projectile.sprite.x, projectile.sprite.y);
    }
    if (projectile?.explosion) {
      this.projectileManager.triggerProjectileExplosion(projectileId);
    } else {
      this.projectileManager.destroyProjectile(projectileId);
    }
    this.decoySystem?.applyDamage(decoyId, damage, shooterId, weaponName, visualContext);

    if (adrenalinGain > 0) {
      this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
    }
  }

  private createLeafBlowerImpulse(
    projectile: TrackedProjectile,
    targetId: string,
  ): { vx: number; vy: number; durationMs: number } | null {
    const minKnockback = projectile.leafBlowerMinKnockback;
    const maxKnockback = projectile.leafBlowerMaxKnockback;
    if (minKnockback === undefined || maxKnockback === undefined || maxKnockback <= 0) return null;

    const startSize = projectile.body.width;
    const maxSize = projectile.hitboxMaxSize ?? startSize;
    const spread = Math.max(maxSize - startSize, 0.0001);
    const progress = Phaser.Math.Clamp((projectile.sprite.displayWidth - startSize) / spread, 0, 1);
    const magnitude = Phaser.Math.Linear(maxKnockback, minKnockback, progress);
    if (magnitude <= 0) return null;

    const player = this.playerManager.getPlayer(targetId);
    const enemy = this.enemyManager?.getEnemy(targetId);
    const targetX = player?.sprite.x ?? enemy?.sprite.x ?? projectile.sprite.x;
    const targetY = player?.sprite.y ?? enemy?.sprite.y ?? projectile.sprite.y;
    const fallbackDx = targetX - projectile.sprite.x;
    const fallbackDy = targetY - projectile.sprite.y;
    const velocityLen = Math.hypot(projectile.body.velocity.x, projectile.body.velocity.y);
    const fallbackLen = Math.hypot(fallbackDx, fallbackDy);
    const dirX = velocityLen > 0.001
      ? projectile.body.velocity.x / velocityLen
      : (fallbackLen > 0.001 ? fallbackDx / fallbackLen : 0);
    const dirY = velocityLen > 0.001
      ? projectile.body.velocity.y / velocityLen
      : (fallbackLen > 0.001 ? fallbackDy / fallbackLen : -1);

    return {
      vx: dirX * magnitude,
      vy: dirY * magnitude,
      durationMs: 220,
    };
  }

  private applyEnemyDamage(
    targetId: string,
    amount: number,
    attackerId?: string,
    weaponName?: string,
    visualContext?: DamageVisualContext,
    options?: DamageApplicationOptions,
  ): void {
    const enemy = this.enemyManager?.getEnemy(targetId);
    if (!enemy) return;
    if (amount <= 0) return;
    if (attackerId && this.enemyManager?.hasEnemy(attackerId)) return;
    if (!this.canDamageTarget(attackerId, targetId, options?.allowTeamDamage)) return;

    if (attackerId && attackerId !== targetId) {
      this.lastAttacker.set(targetId, attackerId);
      if (weaponName) this.lastWeapon.set(targetId, weaponName);
      if (visualContext) this.lastKillSource.set(targetId, {
        dirX: visualContext.dirX,
        dirY: visualContext.dirY,
        projectileColor: visualContext.projectileColor,
      });
    }

    const x = enemy.sprite.x;
    const y = enemy.sprite.y;
    const previousHp = enemy.getHp();
    const result = this.enemyManager?.applyDamage(targetId, amount);
    if (!result) return;

    const hpLost = previousHp - result.remainingHp;
    if (hpLost <= 0) return;

    const hitSeed = this.nextEffectSeed();
    const direction = this.resolveDamageDirection(targetId, attackerId, visualContext, hitSeed, x, y);
    this.bridge.broadcastEffect({
      type: 'hit',
      x,
      y,
      targetId,
      shooterId: attackerId,
      targetColor: COLORS.RED_2,
      totalDamage: hpLost,
      hpLost,
      armorLost: 0,
      isKill: result.died,
      dirX: direction.dirX,
      dirY: direction.dirY,
      seed: hitSeed,
    });

    if (result.died) {
      this.bridge.broadcastEffect({
        type: 'death',
        x,
        y,
        targetId,
        targetColor: COLORS.RED_2,
        rotation: 0,
        seed: this.nextEffectSeed(),
      });

      const killerId = this.lastAttacker.get(targetId);
      if (killerId && killerId !== targetId) {
        if (this.bridge.getPlayerProfile(killerId)) {
          this.bridge.incrementPlayerFrags(killerId);
          if (isCoopDefenseMode(this.bridge.getGameMode())) {
            const enemyXp = getCoopDefenseEnemyXp(enemy.kind);
            if (enemyXp > 0) {
              this.bridge.addCoopDefenseRoundXp(enemyXp);
              this.bridge.broadcastCoopDefenseXpPopup(x, y, enemyXp);
            }
          }
        }
        const weapon = this.lastWeapon.get(targetId) ?? weaponName ?? 'Waffe';
        this.onKillCb?.(killerId, targetId, weapon, x, y, this.lastKillSource.get(targetId));
      }

      this.lastAttacker.delete(targetId);
      this.lastWeapon.delete(targetId);
      this.lastKillSource.delete(targetId);
    }
  }

  private handleDeath(playerId: string, x: number, y: number, seed: number): void {
    this.alive.set(playerId, false);
    this.armor.set(playerId, 0);
    this.clearBurnForPlayer(playerId);
    this.onDeathCb?.(playerId, x, y);

    // Aktive Duration-Buffs (z.B. Adrenalinspritze) beim Tod entfernen
    this.powerUpSystem?.removePlayer(playerId);
    // Stinkwolke beim Tod sofort deaktivieren
    this.stinkCloudSystem?.hostDeactivateForPlayer(playerId);
    this.decoySystem?.clearPlayer(playerId);

    const player = this.playerManager.getPlayer(playerId);
    if (player) player.body.enable = false;

    this.bridge.broadcastEffect(this.buildDeathEffect(playerId, x, y, seed));

    // Kill-Callback auslösen (Host-only, kein Selbstkill)
    const killerId = this.lastAttacker.get(playerId);
    if (killerId && killerId !== playerId) {
      const weapon = this.lastWeapon.get(playerId) ?? 'Waffe';
      this.onKillCb?.(killerId, playerId, weapon, x, y, this.lastKillSource.get(playerId));
    }

    const timer = setTimeout(() => this.respawn(playerId), RESPAWN_DELAY_MS);
    this.respawnTimers.set(playerId, timer);
  }

  /** Heilt den Spieler vollständig auf HP_MAX (nur wenn lebendig). */
  healToFull(playerId: string): void {
    if (!this.isAlive(playerId)) return;
    this.hp.set(playerId, this.getMaxHp(playerId));
  }

  heal(playerId: string, amount: number): number {
    if (!this.isAlive(playerId) || amount <= 0) return this.getHP(playerId);
    const next = Math.min(this.getMaxHp(playerId), this.getHP(playerId) + amount);
    this.hp.set(playerId, next);
    return next;
  }

  addArmor(playerId: string, amount: number): number {
    if (!this.isAlive(playerId)) return this.getArmor(playerId);
    const adjustedAmount = amount > 0
      ? amount * Math.max(0, this.playerArmorGainMultiplierResolver?.(playerId) ?? 1)
      : amount;
    const maxArmor = Math.max(0, this.playerMaxArmorResolver?.(playerId) ?? ARMOR_MAX);
    const newArmor = Phaser.Math.Clamp(this.getArmor(playerId) + adjustedAmount, 0, maxArmor);
    this.armor.set(playerId, newArmor);
    return newArmor;
  }

  private respawn(playerId: string): void {
    this.hp.set(playerId, this.getMaxHp(playerId));
    this.armor.set(playerId, 0);
    this.alive.set(playerId, true);
    this.clearBurnForPlayer(playerId);
    this.respawnTimers.delete(playerId);
    this.lastAttacker.delete(playerId);
    this.lastWeapon.delete(playerId);
    this.lastKillSource.delete(playerId);

    this.resourceSystem?.setAdrenaline(playerId, ADRENALINE_START);

    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;

    player.body.enable = true;
    const spawn = this.playerManager.getSpawnPoint(playerId);
    player.setPosition(ARENA_OFFSET_X + spawn.x, ARENA_OFFSET_Y + spawn.y);
  }

  hpRegenTick(playerId: string, deltaMs: number): void {
    if (!(this.alive.get(playerId) ?? false)) return;
    const regenPerSecond = this.playerHpRegenPerSecondResolver?.(playerId) ?? 0;
    if (regenPerSecond <= 0) return;
    const current = this.hp.get(playerId) ?? 0;
    const max = this.getMaxHp(playerId);
    if (current >= max) return;
    this.hp.set(playerId, Math.min(max, current + regenPerSecond * deltaMs / 1000));
  }

  private resolvePlayerMaxHp(playerId: string): number {
    const resolved = this.playerMaxHpResolver?.(playerId) ?? HP_MAX;
    return Math.max(1, Math.floor(resolved));
  }

  private clearBurnForPlayer(playerId: string): void {
    this.burnStates.delete(playerId);
  }

  private clearBurnByAttacker(attackerId: string): void {
    for (const [targetId, sourceStates] of this.burnStates) {
      for (const [sourceKey, state] of sourceStates) {
        if (state.attackerId === attackerId) sourceStates.delete(sourceKey);
      }
      if (sourceStates.size === 0) this.burnStates.delete(targetId);
    }
  }
}
