import Phaser from 'phaser';
import type { PlayerManager }     from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { NetworkBridge }     from '../network/NetworkBridge';
import type { ResourceSystem }    from './ResourceSystem';
import type { DetonationSystem }  from './DetonationSystem';
import type { EnergyShieldSystem } from './EnergyShieldSystem';
import type { DecoySystem, DecoyTargetSnapshot } from './DecoySystem';
import type { HitscanVisualPreset, LoadoutSlot, MeleeVisualPreset, ShieldBlockCategory, ShotAudioKey, SyncedDeathEffect, SyncedHitEffect, SyncedHitscanTrace, SyncedMeleeSwing, DetonatorConfig, ProjectileExplosionConfig, WeaponSlot } from '../types';
import {
  ARENA_HEIGHT,
  ARMOR_MAX,
  HP_MAX, RESPAWN_DELAY_MS,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH,
  HITSCAN_FAVOR_THE_SHOOTER_MAX_OFFSET,
  HITSCAN_FAVOR_THE_SHOOTER_MS,
  PLAYER_SIZE,
  RAGE_PER_DAMAGE, ADRENALINE_START,
} from '../config';
import { TRAIN } from '../train/TrainConfig';

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
}

interface DamageApplicationOptions {
  allowTeamDamage?: boolean;
}

interface DamageVisualContext {
  sourceX?: number;
  sourceY?: number;
  dirX?: number;
  dirY?: number;
}

interface BurnStackState {
  expiresAt: number;
}

interface BurnAttackerState {
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
  sprite: Phaser.GameObjects.Image;
  body: { velocity: { x: number; y: number } } | null;
}

export class CombatSystem {
  private hp:            Map<string, number>                           = new Map();
  private armor:         Map<string, number>                           = new Map();
  private alive:         Map<string, boolean>                          = new Map();
  private respawnTimers: Map<string, ReturnType<typeof setTimeout>>    = new Map();
  private burnStates:    Map<string, Map<string, BurnAttackerState>>   = new Map();
  private readonly hitscanLine       = new Phaser.Geom.Line();
  private readonly meleeLine         = new Phaser.Geom.Line();  // Scratch-Linie für Melee-Hindernisprüfung
  private readonly arenaBounds       = new Phaser.Geom.Rectangle(ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, ARENA_HEIGHT);
  private readonly scratchCircle     = new Phaser.Geom.Circle();
  private readonly scratchPoints:    Phaser.Geom.Point[] = [];
  private readonly scratchTrainRect  = new Phaser.Geom.Rectangle();
  private meleeSwingIdCounter = 0;
  private effectSeedCounter = 1;

  // Kill-Tracking: letzter Angreifer & Waffe pro Ziel (für Frag-Vergabe)
  private lastAttacker: Map<string, string> = new Map();  // victimId → attackerId
  private lastWeapon:   Map<string, string> = new Map();  // victimId → weaponName

  // Callback: (killerId, victimId, weaponName) – Host-only
  private onKillCb: ((killerId: string, victimId: string, weapon: string, x: number, y: number) => void) | null = null;
  private onDeathCb: ((playerId: string, x: number, y: number) => void) | null = null;

  // Optionale Referenzen – werden nach Konstruktion gesetzt
  private burrowSystem:     BurrowSystemType    | null  = null;
  private resourceSystem:   ResourceSystem      | null  = null;
  private loadoutManager:   LoadoutManagerType  | null  = null;
  private energyShieldSystem: EnergyShieldSystem | null = null;
  private powerUpSystem:    PowerUpSystemType   | null  = null;
  private detonationSystem: DetonationSystem    | null  = null;  private stinkCloudSystem: StinkCloudSystemType | null = null;  private rockObjects: readonly (Phaser.GameObjects.Image | null)[] | null = null;
  private decoySystem:      DecoySystem | null = null;
  private trunkObjects: readonly Phaser.GameObjects.Arc[] | null = null;
  private trainSegObjects: readonly Phaser.GameObjects.Rectangle[] | null = null;
  /** Client-seitiger Fallback: vorberechnete Zug-Bounds aus SyncedTrainState */
  private clientTrainBounds: Phaser.Geom.Rectangle | null = null;

  // Callbacks für Objekt-Schaden (gesetzt von ArenaScene)
  private onRockDamage:  ((rockIndex: number, damage: number, attackerId: string) => void) | null = null;
  private onTrainDamage: ((damage: number, attackerId: string) => void) | null = null;
  private onProjectileImpact: ((projectileId: number, x: number, y: number) => void) | null = null;

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
  setArenaObstacles(
    rockObjects: readonly (Phaser.GameObjects.Image | null)[] | null,
    trunkObjects: readonly Phaser.GameObjects.Arc[] | null,
  ): void {
    this.rockObjects = rockObjects;
    this.trunkObjects = trunkObjects;
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

  /** Setzt den Kill-Callback (Host-only). */
  setKillCallback(cb: (killerId: string, victimId: string, weapon: string, x: number, y: number) => void): void {
    this.onKillCb = cb;
  }

  setDeathCallback(cb: ((playerId: string, x: number, y: number) => void) | null): void {
    this.onDeathCb = cb;
  }

  // ── Spieler-Lifecycle ──────────────────────────────────────────────────────

  initPlayer(id: string): void {
    this.hp.set(id, HP_MAX);
    this.armor.set(id, 0);
    this.alive.set(id, true);
    this.clearBurnForPlayer(id);
    this.lastAttacker.delete(id);
    this.lastWeapon.delete(id);
  }

  removePlayer(id: string): void {
    this.clearBurnForPlayer(id);
    this.clearBurnByAttacker(id);
    this.hp.delete(id);
    this.armor.delete(id);
    this.alive.delete(id);
    this.lastAttacker.delete(id);
    this.lastWeapon.delete(id);
    const t = this.respawnTimers.get(id);
    if (t) { clearTimeout(t); this.respawnTimers.delete(id); }
  }

  // ── Abfragen ───────────────────────────────────────────────────────────────

  getHP(id: string):    number  { return this.hp.get(id)    ?? HP_MAX; }
  getArmor(id: string): number  { return this.armor.get(id) ?? 0;      }
  isAlive(id: string):  boolean { return this.alive.get(id) ?? false;  }
  isBurrowed(id: string): boolean { return this.burrowSystem?.isBurrowed(id) ?? false; }
  getBurnStackCount(id: string): number {
    const attackerStates = this.burnStates.get(id);
    if (!attackerStates) return 0;

    let totalStacks = 0;
    for (const state of attackerStates.values()) {
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
    if (!this.isAlive(targetId)) return;
    if (amount <= 0) return;
    if (!this.canDamageTarget(attackerId, targetId, options?.allowTeamDamage)) return;
    if (!skipBurrowCheck && this.burrowSystem?.isBurrowed(targetId)) return;
    this.decoySystem?.breakStealth(targetId, Date.now());

    // Letzten Angreifer tracken (Selbstschaden ausgenommen)
    if (attackerId && attackerId !== targetId) {
      this.lastAttacker.set(targetId, attackerId);
      if (weaponName) this.lastWeapon.set(targetId, weaponName);
    }

    const player = this.playerManager.getPlayer(targetId);
    const x = player?.sprite.x ?? 0;
    const y = player?.sprite.y ?? 0;

    const currentArmor = this.armor.get(targetId) ?? 0;
    const absorbedByArmor = Math.min(currentArmor, amount);
    const overflowDamage = Math.max(0, amount - absorbedByArmor);
    const newArmor = Math.max(0, currentArmor - absorbedByArmor);
    const currentHp = this.hp.get(targetId) ?? HP_MAX;
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

    let attackerState = targetState.get(attackerId);
    if (!attackerState) {
      attackerState = {
        stacks: [],
        nextTickAt: now + tickIntervalMs,
        damagePerTick,
        tickIntervalMs,
        weaponName,
      };
      targetState.set(attackerId, attackerState);
    }

    attackerState.damagePerTick = damagePerTick;
    attackerState.tickIntervalMs = tickIntervalMs;
    attackerState.weaponName = weaponName;
    attackerState.stacks.push({ expiresAt: now + durationMs });
  }

  updateBurnEffects(now: number): void {
    for (const [targetId, attackerStates] of [...this.burnStates]) {
      if (!this.isAlive(targetId) || this.isBurrowed(targetId)) {
        this.clearBurnForPlayer(targetId);
        continue;
      }

      for (const [attackerId, state] of [...attackerStates]) {
        state.stacks = state.stacks.filter(stack => stack.expiresAt > now);
        if (state.stacks.length === 0) {
          attackerStates.delete(attackerId);
          continue;
        }

        while (now >= state.nextTickAt && state.stacks.length > 0 && this.isAlive(targetId)) {
          const damage = state.damagePerTick * state.stacks.length;
          const attacker = this.playerManager.getPlayer(attackerId);
          this.applyDamage(targetId, damage, false, attackerId, state.weaponName, attacker
            ? { sourceX: attacker.sprite.x, sourceY: attacker.sprite.y }
            : undefined);
          state.nextTickAt += state.tickIntervalMs;

          if (!this.isAlive(targetId)) break;
        }
      }

      if (attackerStates.size === 0) {
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
      if (dist <= radius) {
        const category = options?.category ?? 'explosion';
        if (this.shouldBlockWithShield(player.id, category, damage, x, y)) continue;
        this.applyDamage(player.id, damage, false, ownerId, options?.weaponName ?? 'Granate', { sourceX: x, sourceY: y }, options);
      }
    }
  }

  applyExplosionDamage(
    x: number,
    y: number,
    effect: ProjectileExplosionConfig,
    ownerId: string,
    sourceSlot?: LoadoutSlot,
    weaponName = 'Explosion',
  ): void {
    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.isAlive(player.id)) continue;

      const dist = Phaser.Math.Distance.Between(x, y, player.sprite.x, player.sprite.y);
      if (dist > effect.radius) continue;

      const t = Phaser.Math.Clamp(dist / effect.radius, 0, 1);
      let damage = Phaser.Math.Linear(effect.maxDamage, effect.minDamage, t);
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
    }
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
      const projBounds = proj.sprite.getBounds();
      let projectileConsumed = false;

      for (const player of this.playerManager.getAllPlayers()) {
        if (!this.isAlive(player.id))                     continue;
        if (proj.ownerId === player.id)                   continue;
        if (this.burrowSystem?.isBurrowed(player.id))     continue;

        if (Phaser.Geom.Intersects.RectangleToRectangle(projBounds, player.sprite.getBounds())) {
          // Damage-Multiplier des Schützen (Ultimate + PowerUp)
          const loadoutMult  = proj.sourceSlot === 'weapon1' || proj.sourceSlot === 'weapon2'
            ? (this.loadoutManager?.getWeaponDamageMultiplier(proj.ownerId, proj.sourceSlot, Date.now()) ?? 1)
            : (this.loadoutManager?.getDamageMultiplier(proj.ownerId) ?? 1);
          const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(proj.ownerId) ?? 1;
          const actualDamage = proj.damage * loadoutMult * powerUpMult;
          const canDealDamage = this.canDamageTarget(proj.ownerId, player.id, proj.allowTeamDamage);

          if (canDealDamage && this.shouldBlockWithShield(player.id, 'projectile', actualDamage, proj.sprite.x, proj.sprite.y)) {
            this.projectileManager.destroyProjectile(proj.id);
            projectileConsumed = true;
            break;
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
            continue; // kein break, kein destroyProjectile
          }

          if (proj.isFlame && canDealDamage) {
            this.applyBurnStack(
              player.id,
              proj.ownerId,
              proj.burnDurationMs ?? 0,
              proj.burnDamagePerTick ?? 0,
              proj.burnTickIntervalMs ?? 0,
              proj.weaponName,
            );
          }

          this.handleHit(proj.id, player.id, actualDamage, proj.ownerId, proj.adrenalinGain, proj.weaponName, canDealDamage);
          projectileConsumed = true;
          break;  // Projektil trifft maximal einen Spieler pro Frame
        }
      }

      if (projectileConsumed) continue;

      for (const decoy of this.decoySystem?.getHostTargets() ?? []) {
        if (proj.ownerId === decoy.ownerId) continue;

        if (Phaser.Geom.Intersects.RectangleToRectangle(projBounds, decoy.sprite.getBounds())) {
          const loadoutMult  = proj.sourceSlot === 'weapon1' || proj.sourceSlot === 'weapon2'
            ? (this.loadoutManager?.getWeaponDamageMultiplier(proj.ownerId, proj.sourceSlot, Date.now()) ?? 1)
            : (this.loadoutManager?.getDamageMultiplier(proj.ownerId) ?? 1);
          const powerUpMult  = this.powerUpSystem?.getDamageMultiplier(proj.ownerId) ?? 1;
          const actualDamage = proj.damage * loadoutMult * powerUpMult;
          const decoyKey = `decoy_${decoy.id}`;

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
          projectileConsumed = true;
          break;
        }
      }
    }
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
    shotAudioVolume?: number,
    sourceSlot?: WeaponSlot,
    shotId?: number,
    detonatorCfg?: DetonatorConfig,
    rockDamageMult = 1,
    trainDamageMult = 1,
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
      impactKind: trace.hitPlayerId ? 'player' : (trace.hitObstacle ? 'environment' : 'none'),
      visualPreset,
      shooterId,
      shotId,
      shotAudioKey,
      shotAudioVolume,
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

      if (canDealDamage && adrenalinGain > 0) {
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

    return true;
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
  ): boolean {
    if (!this.bridge.isHost()) return false;

    const halfArcRad = (arcDegrees * Math.PI / 180) / 2;
    let hitPlayer = false;
    let nearestHitDistance = Number.POSITIVE_INFINITY;
    let impactX: number | undefined;
    let impactY: number | undefined;

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
      hitPlayer = true;
      if (dist < nearestHitDistance) {
        nearestHitDistance = dist;
        impactX = player.sprite.x;
        impactY = player.sprite.y;
      }

      if (canDealDamage && adrenalinGain > 0) {
        this.resourceSystem?.addAdrenaline(shooterId, adrenalinGain);
      }
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

    // Melee-Objektschaden: Felsen und Zug im Trefferbogen prüfen
    this.applyMeleeObjectDamage(x, y, angle, range, halfArcRad, damage, rockDamageMult, trainDamageMult, shooterId);

    // Swing-VFX für alle Clients in die Replikations-Queue einreihen
    this.queueMeleeSwing({ x, y, angle, arcDegrees, range, color: playerColor, shooterId, visualPreset, hitPlayer, impactX, impactY });
    return true;
  }

  // collectReplicatedMeleeSwings entfernt – Swings werden per RPC gesendet

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
      hitDecoyId = decoy.id;
    }

    return {
      endX: startX + dirX * closestDistance,
      endY: startY + dirY * closestDistance,
      distance: closestDistance,
      hitPlayerId,
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

    const baseRadius = PLAYER_SIZE * 0.5 + traceThickness * 0.5;
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
    const baseRadius = PLAYER_SIZE * 0.5 + traceThickness * 0.5;
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
  ): { distance: number; x: number; y: number } | null {
    const points = Phaser.Geom.Intersects.GetLineToRectangle(line, rect, this.scratchPoints);
    return this.pickNearestIntersection(line, points);
  }

  private findNearestCircleHit(
    line: Phaser.Geom.Line,
    centerX: number,
    centerY: number,
    radius: number,
  ): { distance: number; x: number; y: number } | null {
    this.scratchCircle.setTo(centerX, centerY, radius);
    const points = Phaser.Geom.Intersects.GetLineToCircle(line, this.scratchCircle, this.scratchPoints);
    return this.pickNearestIntersection(line, points);
  }

  private pickNearestIntersection(
    line: Phaser.Geom.Line,
    points: Phaser.Geom.Point[],
  ): { distance: number; x: number; y: number } | null {
    let bestHit: { distance: number; x: number; y: number } | null = null;

    for (const point of points) {
      const distance = Phaser.Math.Distance.Between(line.x1, line.y1, point.x, point.y);
      if (distance <= 0.01) continue;
      if (!bestHit || distance < bestHit.distance) {
        bestHit = { distance, x: point.x, y: point.y };
      }
    }

    points.length = 0;
    return bestHit;
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
      if (attacker) {
        dirX = targetX - attacker.sprite.x;
        dirY = targetY - attacker.sprite.y;
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
    const visualContext: DamageVisualContext | undefined = projectile
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
    if (allowDamage) {
      this.applyDamage(playerId, damage, false, shooterId, weaponName, visualContext);
    }

    // Adrenalin-Belohnung für den Schützen
    if (allowDamage && adrenalinGain > 0) {
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
      this.onKillCb?.(killerId, playerId, weapon, x, y);
    }

    const timer = setTimeout(() => this.respawn(playerId), RESPAWN_DELAY_MS);
    this.respawnTimers.set(playerId, timer);
  }

  /** Heilt den Spieler vollständig auf HP_MAX (nur wenn lebendig). */
  healToFull(playerId: string): void {
    if (!this.isAlive(playerId)) return;
    this.hp.set(playerId, HP_MAX);
  }

  addArmor(playerId: string, amount: number): number {
    if (!this.isAlive(playerId)) return this.getArmor(playerId);
    const newArmor = Phaser.Math.Clamp(this.getArmor(playerId) + amount, 0, ARMOR_MAX);
    this.armor.set(playerId, newArmor);
    return newArmor;
  }

  private respawn(playerId: string): void {
    this.hp.set(playerId, HP_MAX);
    this.armor.set(playerId, 0);
    this.alive.set(playerId, true);
    this.clearBurnForPlayer(playerId);
    this.respawnTimers.delete(playerId);
    this.lastAttacker.delete(playerId);
    this.lastWeapon.delete(playerId);

    this.resourceSystem?.setAdrenaline(playerId, ADRENALINE_START);

    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;

    player.body.enable = true;
    const spawn = this.playerManager.getSpawnPoint(playerId);
    player.setPosition(ARENA_OFFSET_X + spawn.x, ARENA_OFFSET_Y + spawn.y);
  }

  private clearBurnForPlayer(playerId: string): void {
    this.burnStates.delete(playerId);
  }

  private clearBurnByAttacker(attackerId: string): void {
    for (const [targetId, attackerStates] of this.burnStates) {
      attackerStates.delete(attackerId);
      if (attackerStates.size === 0) this.burnStates.delete(targetId);
    }
  }
}
