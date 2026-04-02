import Phaser from 'phaser';
import type { DecoyUtilityConfig } from '../loadout/LoadoutConfig';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { SyncedActiveHudBuff, SyncedCombatEffect, SyncedDecoy, SyncedDeathEffect, SyncedHitEffect } from '../types';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, ARENA_HEIGHT, ARMOR_MAX, COLORS, HP_MAX } from '../config';
import type { PlayerManager } from '../entities/PlayerManager';
import { DecoyEntity } from '../entities/DecoyEntity';

type CombatStateReader = {
  getHP(playerId: string): number;
  getArmor(playerId: string): number;
  isAlive(playerId: string): boolean;
};

interface HostDecoy {
  id: number;
  ownerId: string;
  entity: DecoyEntity;
  expiresAt: number;
  hp: number;
  armor: number;
  maxHp: number;
  maxArmor: number;
  color: number;
  rotation: number;
  colliders: Phaser.Physics.Arcade.Collider[];
  speed: number;
}

interface StealthState {
  playerId: string;
  utilityId: string;
  cooldown: number;
  startedAt: number;
  expiresAt: number;
}

export interface DecoyTargetSnapshot {
  id: number;
  ownerId: string;
  sprite: Phaser.GameObjects.Image;
  body: Phaser.Physics.Arcade.Body | null;
}

export class DecoySystem {
  private readonly entities = new Map<number, DecoyEntity>();
  private readonly hostDecoys = new Map<number, HostDecoy>();
  private readonly stealthStates = new Map<string, StealthState>();
  private nextDecoyId = 1;
  private effectSeedCounter = 1;
  private combatStateReader: CombatStateReader | null = null;
  private resolveRunSpeed: ((playerId: string) => number) | null = null;
  private beginCooldown: ((playerId: string, utilityId: string, now: number) => void) | null = null;
  private rockGroup: Phaser.Physics.Arcade.StaticGroup | null = null;
  private trunkGroup: Phaser.Physics.Arcade.StaticGroup | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly playerManager: PlayerManager,
    private readonly bridge: NetworkBridge,
  ) {}

  setCombatStateReader(reader: CombatStateReader | null): void {
    this.combatStateReader = reader;
  }

  setRunSpeedResolver(resolver: ((playerId: string) => number) | null): void {
    this.resolveRunSpeed = resolver;
  }

  setCooldownStarter(cb: ((playerId: string, utilityId: string, now: number) => void) | null): void {
    this.beginCooldown = cb;
  }

  setObstacleGroups(
    rockGroup: Phaser.Physics.Arcade.StaticGroup | null,
    trunkGroup: Phaser.Physics.Arcade.StaticGroup | null,
  ): void {
    this.rockGroup = rockGroup;
    this.trunkGroup = trunkGroup;

    for (const decoy of this.hostDecoys.values()) {
      for (const collider of decoy.colliders) collider.destroy();
      decoy.colliders = this.createDecoyColliders(decoy.entity);
    }
  }

  activate(cfg: DecoyUtilityConfig, playerId: string, angle: number, playerColor: number, now: number): boolean {
    if (!this.bridge.isHost()) return false;
    if (!this.combatStateReader?.isAlive(playerId)) return false;
    if (this.stealthStates.has(playerId)) return false;
    if ([...this.hostDecoys.values()].some(decoy => decoy.ownerId === playerId)) return false;

    const owner = this.playerManager.getPlayer(playerId);
    if (!owner) return false;

    const id = this.nextDecoyId++;
    const entity = new DecoyEntity(
      this.scene,
      id,
      playerId,
      owner.sprite.x,
      owner.sprite.y,
      playerColor,
      this.bridge.isEnemyPair(this.bridge.getLocalPlayerId(), playerId),
      true,
    );
    entity.setRotation(angle);

    const hp = this.combatStateReader.getHP(playerId);
    const armor = this.combatStateReader.getArmor(playerId);
    entity.updateVitals(hp, HP_MAX, armor, ARMOR_MAX);

    const speed = this.resolveRunSpeed?.(playerId) ?? 0;
    entity.body?.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);

    const hostDecoy: HostDecoy = {
      id,
      ownerId: playerId,
      entity,
      expiresAt: now + cfg.decoyLifetimeMs,
      hp,
      armor,
      maxHp: HP_MAX,
      maxArmor: ARMOR_MAX,
      color: playerColor,
      rotation: angle,
      colliders: this.createDecoyColliders(entity),
      speed,
    };

    this.entities.set(id, entity);
    this.hostDecoys.set(id, hostDecoy);
    this.stealthStates.set(playerId, {
      playerId,
      utilityId: cfg.id,
      cooldown: cfg.cooldown,
      startedAt: now,
      expiresAt: now + cfg.stealthDurationMs,
    });

    return true;
  }

  hostUpdate(now: number): SyncedDecoy[] {
    if (this.bridge.isHost()) {
      for (const decoy of [...this.hostDecoys.values()]) {
        if (now >= decoy.expiresAt) {
          this.destroyDecoy(decoy.id, true);
          continue;
        }
        decoy.entity.body?.setVelocity(
          Math.cos(decoy.rotation) * decoy.speed,
          Math.sin(decoy.rotation) * decoy.speed,
        );
        decoy.entity.syncBar();
      }

      for (const stealth of [...this.stealthStates.values()]) {
        if (now >= stealth.expiresAt) {
          this.breakStealth(stealth.playerId, now);
        }
      }
    }

    return [...this.hostDecoys.values()].map((decoy) => ({
      id: decoy.id,
      ownerId: decoy.ownerId,
      x: Math.round(decoy.entity.sprite.x),
      y: Math.round(decoy.entity.sprite.y),
      rot: decoy.rotation,
      hp: decoy.hp,
      maxHp: decoy.maxHp,
      armor: decoy.armor,
      maxArmor: decoy.maxArmor,
      color: decoy.color,
    }));
  }

  syncSnapshots(snapshots: readonly SyncedDecoy[]): void {
    const activeIds = new Set<number>();
    const localPlayerId = this.bridge.getLocalPlayerId();

    for (const snapshot of snapshots) {
      activeIds.add(snapshot.id);
      let entity = this.entities.get(snapshot.id);
      if (!entity) {
        entity = new DecoyEntity(
          this.scene,
          snapshot.id,
          snapshot.ownerId,
          snapshot.x,
          snapshot.y,
          snapshot.color,
          this.bridge.isEnemyPair(localPlayerId, snapshot.ownerId),
          false,
        );
        this.entities.set(snapshot.id, entity);
      }

      if (!this.hostDecoys.has(snapshot.id)) {
        entity.setTargetPosition(snapshot.x, snapshot.y);
        entity.setTargetRotation(snapshot.rot);
      }
      entity.setRotation(snapshot.rot);
      entity.updateVitals(snapshot.hp, snapshot.maxHp, snapshot.armor, snapshot.maxArmor);
      entity.syncBar();
    }

    for (const [id, entity] of [...this.entities]) {
      if (activeIds.has(id) || this.hostDecoys.has(id)) continue;
      entity.destroy();
      this.entities.delete(id);
    }
  }

  updateVisuals(lerpFactor: number): void {
    for (const [id, entity] of this.entities) {
      if (this.hostDecoys.has(id)) {
        entity.syncBar();
      } else {
        entity.lerpStep(lerpFactor);
      }
    }
  }

  getHoverNameTarget(pointerX: number, pointerY: number): { name: string; x: number; y: number; distanceSq: number } | null {
    let nearest: { name: string; x: number; y: number; distanceSq: number } | null = null;

    for (const entity of this.entities.values()) {
      const sprite = entity.sprite;
      if (!sprite.active || !sprite.visible) continue;
      const dx = pointerX - sprite.x;
      const dy = pointerY - sprite.y;
      const radius = Math.max(sprite.displayWidth, sprite.displayHeight) * 0.5;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > radius * radius) continue;
      if (!nearest || distanceSq < nearest.distanceSq) {
        nearest = { name: 'Decoy', x: sprite.x, y: sprite.y, distanceSq };
      }
    }

    return nearest;
  }

  getStealthBuff(playerId: string, now: number): SyncedActiveHudBuff | null {
    const state = this.stealthStates.get(playerId);
    if (!state) return null;
    const remaining = Math.max(0, state.expiresAt - now);
    const duration = Math.max(1, state.expiresAt - state.startedAt);
    return { defId: 'DECOY_STEALTH', remainingFrac: Phaser.Math.Clamp(remaining / duration, 0, 1) };
  }

  isStealthed(playerId: string): boolean {
    return this.stealthStates.has(playerId);
  }

  getStealthRemainingFrac(playerId: string, now: number): number {
    const state = this.stealthStates.get(playerId);
    if (!state) return 0;
    return Phaser.Math.Clamp((state.expiresAt - now) / Math.max(1, state.expiresAt - state.startedAt), 0, 1);
  }

  breakStealth(playerId: string, now: number): boolean {
    const state = this.stealthStates.get(playerId);
    if (!state) return false;
    this.stealthStates.delete(playerId);
    this.beginCooldown?.(playerId, state.utilityId, now);
    return true;
  }

  clearPlayer(playerId: string, suppressCooldown = true): void {
    for (const decoy of [...this.hostDecoys.values()]) {
      if (decoy.ownerId === playerId) {
        this.destroyDecoy(decoy.id, false);
      }
    }

    if (!suppressCooldown) {
      this.breakStealth(playerId, Date.now());
    } else {
      this.stealthStates.delete(playerId);
    }
  }

  clearAll(): void {
    for (const decoy of [...this.hostDecoys.values()]) {
      this.destroyDecoy(decoy.id, false);
    }
    for (const entity of this.entities.values()) {
      entity.destroy();
    }
    this.entities.clear();
    this.hostDecoys.clear();
    this.stealthStates.clear();
  }

  getHostTargets(): DecoyTargetSnapshot[] {
    return [...this.hostDecoys.values()].map((decoy) => ({
      id: decoy.id,
      ownerId: decoy.ownerId,
      sprite: decoy.entity.sprite,
      body: decoy.entity.body,
    }));
  }

  applyDamage(
    decoyId: number,
    amount: number,
    attackerId?: string,
    weaponName?: string,
    visualContext?: { sourceX?: number; sourceY?: number; dirX?: number; dirY?: number },
  ): boolean {
    const decoy = this.hostDecoys.get(decoyId);
    if (!decoy || amount <= 0) return false;

    const absorbedByArmor = Math.min(decoy.armor, amount);
    const hpDamage = Math.max(0, amount - absorbedByArmor);
    const armorLost = absorbedByArmor;
    const hpLost = Math.min(decoy.hp, hpDamage);
    const totalDamage = armorLost + hpLost;

    decoy.armor = Math.max(0, decoy.armor - absorbedByArmor);
    decoy.hp = Math.max(0, decoy.hp - hpDamage);
    decoy.entity.updateVitals(decoy.hp, decoy.maxHp, decoy.armor, decoy.maxArmor);

    if (totalDamage > 0) {
      const effect = this.buildHitEffect(decoy, attackerId, totalDamage, hpLost, armorLost, decoy.hp <= 0, visualContext);
      this.bridge.broadcastEffect(effect);
    }

    if (decoy.hp <= 0) {
      this.destroyDecoy(decoyId, true);
    }

    void weaponName;
    return totalDamage > 0;
  }

  private createDecoyColliders(entity: DecoyEntity): Phaser.Physics.Arcade.Collider[] {
    if (!entity.body) return [];

    const colliders: Phaser.Physics.Arcade.Collider[] = [];
    if (this.rockGroup) colliders.push(this.scene.physics.add.collider(entity.sprite, this.rockGroup));
    if (this.trunkGroup) colliders.push(this.scene.physics.add.collider(entity.sprite, this.trunkGroup));
    return colliders;
  }

  private destroyDecoy(decoyId: number, playEffect: boolean): void {
    const decoy = this.hostDecoys.get(decoyId);
    if (!decoy) return;

    for (const collider of decoy.colliders) collider.destroy();
    if (playEffect) {
      this.bridge.broadcastEffect(this.buildDeathEffect(decoy));
    }
    decoy.entity.destroy();
    this.entities.delete(decoyId);
    this.hostDecoys.delete(decoyId);
  }

  private buildHitEffect(
    decoy: HostDecoy,
    attackerId: string | undefined,
    totalDamage: number,
    hpLost: number,
    armorLost: number,
    isKill: boolean,
    visualContext?: { sourceX?: number; sourceY?: number; dirX?: number; dirY?: number },
  ): SyncedHitEffect {
    const seed = this.nextEffectSeed();
    const direction = this.resolveDamageDirection(decoy, attackerId, visualContext, seed);
    return {
      type: 'hit',
      x: decoy.entity.sprite.x,
      y: decoy.entity.sprite.y,
      targetId: `decoy_${decoy.id}`,
      shooterId: attackerId,
      targetColor: decoy.color,
      totalDamage,
      hpLost,
      armorLost,
      isKill,
      dirX: direction.dirX,
      dirY: direction.dirY,
      seed,
    };
  }

  private buildDeathEffect(decoy: HostDecoy): SyncedDeathEffect {
    return {
      type: 'death',
      x: decoy.entity.sprite.x,
      y: decoy.entity.sprite.y,
      targetId: `decoy_${decoy.id}`,
      targetColor: decoy.color,
      rotation: decoy.entity.sprite.rotation,
      seed: this.nextEffectSeed(),
    };
  }

  private resolveDamageDirection(
    decoy: HostDecoy,
    attackerId: string | undefined,
    visualContext: { sourceX?: number; sourceY?: number; dirX?: number; dirY?: number } | undefined,
    seed: number,
  ): { dirX: number; dirY: number } {
    let dirX = visualContext?.dirX ?? 0;
    let dirY = visualContext?.dirY ?? 0;

    if (Math.hypot(dirX, dirY) <= 0.0001 && visualContext?.sourceX !== undefined && visualContext?.sourceY !== undefined) {
      dirX = decoy.entity.sprite.x - visualContext.sourceX;
      dirY = decoy.entity.sprite.y - visualContext.sourceY;
    }

    if (Math.hypot(dirX, dirY) <= 0.0001 && attackerId) {
      const attacker = this.playerManager.getPlayer(attackerId);
      if (attacker) {
        dirX = decoy.entity.sprite.x - attacker.sprite.x;
        dirY = decoy.entity.sprite.y - attacker.sprite.y;
      }
    }

    const len = Math.hypot(dirX, dirY);
    if (len > 0.0001) {
      return { dirX: dirX / len, dirY: dirY / len };
    }

    const centerX = ARENA_OFFSET_X + ARENA_WIDTH / 2;
    const centerY = ARENA_OFFSET_Y + ARENA_HEIGHT / 2;
    const angle = Math.atan2(decoy.entity.sprite.y - centerY, decoy.entity.sprite.x - centerX) + (((seed >>> 5) % 41) - 20) * (Math.PI / 180);
    return { dirX: Math.cos(angle), dirY: Math.sin(angle) };
  }

  private nextEffectSeed(): number {
    const seed = Math.imul(this.effectSeedCounter++, 0x9e3779b1);
    return seed >>> 0;
  }
}