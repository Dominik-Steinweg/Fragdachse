import * as Phaser from 'phaser';
import type { DecoyUtilityConfig } from '../loadout/LoadoutConfig';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { SyncedActiveHudBuff, SyncedCombatEffect, SyncedDecoy, SyncedDeathEffect, SyncedHitEffect } from '../types';
import { ARMOR_MAX, PLAYER_SIZE, PLAYER_VISUAL_SIZE } from '../config';
import { PlayerBody } from '../entities/PlayerBody';
import { DecoyRuntime, type DecoyState, type DecoyEnd, type DecoyEndReason } from './DecoyRuntime';
import type { PlayerManager } from '../entities/PlayerManager';
import { DecoyEntity } from '../entities/DecoyEntity';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { CombatDamageMutationOutcome, TargetDamageMutationRequest } from '../combat/CombatMutation';
import { freezeTargetMutationOutcome } from '../combat/CombatMutation';
import type { CombatScope, CombatSource, CombatTargetRef } from '../combat/CombatScope';
import { isSameCombatScope, isSameCombatTargetInstance } from '../combat/CombatScope';

type CombatStateReader = {
  getHP(playerId: string): number;
  getMaxHp(playerId: string): number;
  getArmor(playerId: string): number;
  isAlive(playerId: string): boolean;
};

type HostDecoy = Readonly<DecoyState>;
export interface DecoyTargetSnapshot {
  readonly id: number;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly body: Phaser.Physics.Arcade.Body | null;
}
export interface DecoyLifecyclePort {
  beforeActivate(ownerId: string): void;
  activated(decoy: HostDecoy): void;
  /** Count actual living distractions before removing locks and before explosion damage. */
  ended(event: DecoyEnd): number;
}

export class DecoySystem {
  private combatScope: CombatScope = Object.freeze({ worldRevision: 1, runtimeGeneration: 1 });
  private readonly replicatedActiveOwners = new Set<string>();
  private readonly entities = new Map<number, DecoyEntity>();
  readonly runtime = new DecoyRuntime();
  private readonly bodies = new Map<number, PlayerBody>();
  private readonly colliders = new Map<number, Phaser.Physics.Arcade.Collider[]>();
  private readonly trailPositions = new Map<number, { x: number; y: number }>();
  private lifecycle: DecoyLifecyclePort | null = null;
  private stealthBroken: ((playerId: string) => void) | null = null;
  private hostNowMs = 0;
  private refundCooldown: ((ownerId: string, utilityId: string, amountMs: number, now: number) => void) | null = null;
  private endEffect: ((event: DecoyEnd, now: number) => void) | null = null;
  private trail: ((decoy: HostDecoy, fromX: number, fromY: number, toX: number, toY: number, now: number) => void) | null = null;
  private mutationOutcomeSequence = 0;
  private effectSeedCounter = 1;
  private combatStateReader: CombatStateReader | null = null;
  private resolveRunSpeed: ((playerId: string) => number) | null = null;
  private rockGroup: Phaser.Physics.Arcade.StaticGroup | null = null;
  private trunkGroup: Phaser.Physics.Arcade.StaticGroup | null = null;
  private baseGroup: Phaser.Physics.Arcade.StaticGroup | null = null;
  private worldMetrics: WorldMetrics | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly playerManager: PlayerManager,
    private readonly bridge: NetworkBridge,
    private readonly presentationEnabled = true,
  ) {}

  setCombatScope(scope: CombatScope): void { this.combatScope = Object.freeze({ ...scope }); }

  setCombatStateReader(reader: CombatStateReader | null): void {
    this.combatStateReader = reader;
  }

  setRunSpeedResolver(resolver: ((playerId: string) => number) | null): void {
    this.resolveRunSpeed = resolver;
  }

  setCooldownRefund(cb: typeof this.refundCooldown): void { this.refundCooldown = cb; }
  setEndEffectHandler(cb: typeof this.endEffect): void { this.endEffect = cb; }
  setTrailHandler(cb: typeof this.trail): void { this.trail = cb; }
  setLifecyclePort(port: DecoyLifecyclePort | null): void { this.lifecycle = port; }
  setStealthBrokenHandler(handler: typeof this.stealthBroken): void { this.stealthBroken = handler; }
  setWorldMetrics(metrics: WorldMetrics | null): void { this.worldMetrics = metrics; }

  setObstacleGroups(
    rockGroup: Phaser.Physics.Arcade.StaticGroup | null,
    trunkGroup: Phaser.Physics.Arcade.StaticGroup | null,
    baseGroup: Phaser.Physics.Arcade.StaticGroup | null,
  ): void {
    this.rockGroup = rockGroup;
    this.trunkGroup = trunkGroup;
    this.baseGroup = baseGroup;

    for (const [id, body] of this.bodies) {
      for (const collider of this.colliders.get(id) ?? []) collider.destroy();
      this.colliders.set(id, this.createDecoyColliders(body));
    }
  }

  activate(cfg: DecoyUtilityConfig, playerId: string, angle: number, playerColor: number, now: number): boolean {
    if (!this.bridge.isHost() || !this.combatStateReader?.isAlive(playerId) || this.runtime.hasActive(playerId)) return false;
    const owner = this.playerManager.getPlayer(playerId);
    if (!owner) return false;
    this.hostNowMs = now;
    this.lifecycle?.beforeActivate(playerId);
    const body = new PlayerBody(this.scene, owner.x, owner.y, true);
    const decoy = this.runtime.activate({
      ownerId: playerId, position: body, config: cfg, now,
      hp: this.combatStateReader.getHP(playerId), maxHp: this.combatStateReader.getMaxHp(playerId),
      armor: this.combatStateReader.getArmor(playerId), maxArmor: ARMOR_MAX,
      color: playerColor, rotation: angle, speed: this.resolveRunSpeed?.(playerId) ?? 0,
    });
    if (!decoy) { body.destroy(); return false; }
    this.bodies.set(decoy.id, body);
    this.colliders.set(decoy.id, this.createDecoyColliders(body));
    this.trailPositions.set(decoy.id, { x: body.x, y: body.y });
    body.body.setVelocity(Math.cos(angle) * decoy.speed, Math.sin(angle) * decoy.speed);
    if (this.presentationEnabled) {
      const entity = new DecoyEntity(this.scene, decoy.id, playerId, body.x, body.y, playerColor,
        this.bridge.isEnemyPair(this.bridge.getLocalPlayerId(), playerId));
      entity.setRotation(angle);
      entity.updateVitals(decoy.hp, decoy.maxHp, decoy.armor, decoy.maxArmor);
      this.entities.set(decoy.id, entity);
    }
    this.lifecycle?.activated(decoy);
    return true;
  }

  /** Expiry is resolved before the Activity reads AI targets. */
  hostUpdateLifecycle(now: number): void {
    if (!this.bridge.isHost()) return;
    this.hostNowMs = now;
    for (const id of this.runtime.expired(now)) this.destroyDecoy(id, 'expired');
    this.runtime.expireStealth(now);
    for (const decoy of this.runtime.values()) {
      this.bodies.get(decoy.id)?.body.setVelocity(
        Math.cos(decoy.rotation) * decoy.speed, Math.sin(decoy.rotation) * decoy.speed);
    }
  }

  /** Authoritative physical segments; interpolation and rendering cannot create fire. */
  hostPostPhysics(now: number): void {
    if (!this.bridge.isHost()) return;
    this.hostNowMs = now;
    for (const decoy of this.runtime.values()) {
      const { x, y } = decoy.position;
      const last = this.trailPositions.get(decoy.id)!;
      // Visit each real segment (including slow turns); the fire port samples the shared grid.
      if (Math.hypot(x - last.x, y - last.y) > 0.001) {
        if (decoy.config.fireTrailDurationMs > 0) this.trail?.(decoy, last.x, last.y, x, y, now);
        this.trailPositions.set(decoy.id, { x, y });
      }
      this.entities.get(decoy.id)?.setPosition(x, y);
    }
  }

  /** Creates the network view after host physics has produced the current decoy position. */
  createHostSnapshots(): SyncedDecoy[] {
    return [...this.runtime.values()].map((decoy) => ({
      id: decoy.id,
      ownerId: decoy.ownerId,
      x: Math.round(decoy.position.x),
      y: Math.round(decoy.position.y),
      rot: decoy.rotation,
      hp: decoy.hp,
      maxHp: decoy.maxHp,
      armor: decoy.armor,
      maxArmor: decoy.maxArmor,
      color: decoy.color,
    }));
  }

  syncSnapshots(snapshots: readonly SyncedDecoy[]): void {
    this.replicatedActiveOwners.clear();
    for (const snapshot of snapshots) this.replicatedActiveOwners.add(snapshot.ownerId);
    if (!this.presentationEnabled) return;
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
        );
        this.entities.set(snapshot.id, entity);
      }

      if (!this.runtime.get(snapshot.id)) {
        entity.setTargetPosition(snapshot.x, snapshot.y);
        entity.setTargetRotation(snapshot.rot);
      }
      entity.setRotation(snapshot.rot);
      entity.updateVitals(snapshot.hp, snapshot.maxHp, snapshot.armor, snapshot.maxArmor);
      entity.syncBar();
    }

    for (const [id, entity] of [...this.entities]) {
      if (activeIds.has(id) || this.runtime.get(id)) continue;
      entity.destroy();
      this.entities.delete(id);
    }
  }

  updateVisuals(lerpFactor: number): void {
    for (const [id, entity] of this.entities) {
      if (this.runtime.get(id)) {
        entity.syncBar();
      } else {
        entity.lerpStep(lerpFactor);
      }
      // Der Koeder haelt, was sein Besitzer gerade haelt. Bewusst pro Frame nachgezogen: der
      // Besitzer kann waehrend der Lebensdauer des Koeders die Waffe wechseln.
      entity.setHeldItemId(this.bridge.getPlayerHeldItemId(entity.ownerId));
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
    return this.runtime.getStealth(playerId)
      ? { defId: 'DECOY_STEALTH', remainingFrac: this.getStealthRemainingFrac(playerId, now) } : null;
  }

  isStealthed(playerId: string): boolean { return this.runtime.getStealth(playerId) !== undefined; }
  hasActiveDecoy(playerId: string): boolean { return this.runtime.hasActive(playerId) || this.replicatedActiveOwners.has(playerId); }
  getStealthSpeedMultiplier(playerId: string): number { return this.runtime.getStealth(playerId)?.speedMultiplier ?? 1; }
  getStealthAdrenalineMultiplier(playerId: string): number { return this.runtime.getStealth(playerId)?.adrenalineMultiplier ?? 1; }
  getStealthHpRegen(playerId: string): number { return this.runtime.getStealth(playerId)?.hpPerSecond ?? 0; }

  getStealthRemainingFrac(playerId: string, now: number): number {
    const state = this.runtime.getStealth(playerId);
    return state ? Phaser.Math.Clamp((state.expiresAt - now) / Math.max(1, state.expiresAt - state.startedAt), 0, 1) : 0;
  }

  breakStealth(playerId: string, _now: number): boolean {
    if (!this.runtime.breakStealth(playerId)) return false;
    this.stealthBroken?.(playerId);
    return true;
  }

  clearPlayer(playerId: string): void {
    this.replicatedActiveOwners.delete(playerId);
    for (const decoy of [...this.runtime.values()]) {
      if (decoy.ownerId === playerId) this.destroyDecoy(decoy.id, 'cleanup');
    }
    this.runtime.breakStealth(playerId);
  }

  clearAll(): void {
    this.replicatedActiveOwners.clear();
    for (const decoy of [...this.runtime.values()]) this.destroyDecoy(decoy.id, 'cleanup');
    for (const entity of this.entities.values()) entity.destroy();
    this.entities.clear();
    this.runtime.clearStealth();
  }

  getHostTargets(): DecoyTargetSnapshot[] {
    return [...this.runtime.values()].map(decoy => this.targetSnapshot(decoy));
  }

  getHostTarget(decoyId: number): DecoyTargetSnapshot | null {
    const decoy = this.runtime.get(decoyId);
    return decoy ? this.targetSnapshot(decoy) : null;
  }

  private targetSnapshot(decoy: HostDecoy): DecoyTargetSnapshot {
    return { id: decoy.id, ownerId: decoy.ownerId, x: decoy.position.x, y: decoy.position.y,
      radius: PLAYER_SIZE / 2, body: this.bodies.get(decoy.id)?.body ?? null };
  }

  applyDamage(
    decoyId: number,
    amount: number,
    attackerId?: string,
    sourceId?: string,
    visualContext?: { sourceX?: number; sourceY?: number; dirX?: number; dirY?: number },
    source?: CombatSource,
  ): CombatDamageMutationOutcome {
    const decoy = this.runtime.get(decoyId);
    const target = this.getCombatTargetRef(decoyId) ?? Object.freeze({
      kind: 'decoy' as const,
      id: decoyId,
      scope: this.combatScope,
      instance: Object.freeze({ entityGeneration: 0 }),
    });
    return this.commitDamage({
      outcomeId: `legacy:decoy:${decoyId}:${++this.mutationOutcomeSequence}`,
      target,
      source: source ?? {
        gameplaySource: { kind: 'player', id: attackerId ?? 'legacy-combat' },
        attribution: { kind: 'player', id: attackerId ?? 'legacy-combat' },
        allegiance: { ownerId: attackerId ?? 'world' },
        authoredSourceId: sourceId,
        origin: 'direct',
      },
      damage: {
        amount,
        damageKind: source?.origin === 'support' ? 'direct' : source?.origin ?? 'direct',
        basis: { kind: 'authored', amount },
        sourceFactors: [],
        targetFactors: [],
        isCritical: false,
      },
    }, visualContext);
  }

  getCombatTargetRef(decoyId: number): CombatTargetRef | null {
    const decoy = this.runtime.get(decoyId);
    if (!decoy) return null;
    return Object.freeze({
      kind: 'decoy' as const,
      id: decoyId,
      scope: this.combatScope,
      instance: Object.freeze({ entityGeneration: decoy.entityGeneration }),
    });
  }

  commitDamage(
    request: TargetDamageMutationRequest,
    visualContext?: { sourceX?: number; sourceY?: number; dirX?: number; dirY?: number },
  ): CombatDamageMutationOutcome {
    if (!isSameCombatScope(request.target.scope, this.combatScope)) {
      return freezeTargetMutationOutcome({
        kind: 'rejected', outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'stale-scope',
      });
    }
    const decoy = request.target.kind === 'decoy' ? this.runtime.get(request.target.id) : undefined;
    const currentTarget = request.target.kind === 'decoy' ? this.getCombatTargetRef(request.target.id) : null;
    if (!decoy || !currentTarget) {
      return freezeTargetMutationOutcome({
        kind: 'rejected', outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'target-missing',
      });
    }
    if (!isSameCombatTargetInstance(request.target, currentTarget)) {
      return freezeTargetMutationOutcome({
        kind: 'rejected', outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'stale-target',
      });
    }
    const amount = request.damage.amount;
    if (!Number.isFinite(amount) || amount < 0) {
      return freezeTargetMutationOutcome({
        kind: 'rejected', outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'invalid-value',
      });
    }
    if (amount === 0) {
      return freezeTargetMutationOutcome({
        kind: 'accepted-no-effect', outcomeId: request.outcomeId, target: request.target,
        source: request.source, reason: 'zero-effect', resultingState: this.decoyVitals(decoy),
      });
    }

    const { armorLost, hpLost } = this.runtime.damage(decoy.id, amount)!;
    const totalDamage = armorLost + hpLost;
    this.entities.get(decoy.id)?.updateVitals(decoy.hp, decoy.maxHp, decoy.armor, decoy.maxArmor);

    const hitEffect = totalDamage > 0
      ? this.buildHitEffect(
        decoy,
        String(request.source.actor?.id ?? request.source.gameplaySource.id),
        totalDamage,
        hpLost,
        armorLost,
        decoy.hp <= 0,
        visualContext,
      )
      : null;

    const base = {
      kind: 'damage-applied' as const,
      outcomeId: request.outcomeId,
      target: request.target,
      source: request.source,
      damage: request.damage,
      actualDamage: totalDamage,
      hpLost,
      armorLost,
      integrityLost: 0,
      resultingState: this.decoyVitals(decoy),
    };
    const outcome = decoy.hp <= 0
      ? freezeTargetMutationOutcome({
        ...base,
        transition: {
          kind: 'dead' as const,
          facts: {
            target: request.target,
            position: { x: decoy.position.x, y: decoy.position.y },
            targetAllegiance: { ownerId: decoy.ownerId },
            targetCategory: 'decoy',
            rewardEligible: false,
          },
        },
      })
      : freezeTargetMutationOutcome({ ...base, transition: { kind: 'none' as const }, rescueHealing: 0 });

    if (decoy.hp <= 0) {
      this.destroyDecoy(decoy.id, 'killed', () => {
        if (hitEffect) this.bridge.broadcastEffect(hitEffect);
      });
    } else if (hitEffect) this.bridge.broadcastEffect(hitEffect);

    return outcome;
  }

  private createDecoyColliders(body: PlayerBody): Phaser.Physics.Arcade.Collider[] {
    const colliders: Phaser.Physics.Arcade.Collider[] = [];
    if (this.rockGroup) colliders.push(this.scene.physics.add.collider(body.proxy, this.rockGroup));
    if (this.trunkGroup) colliders.push(this.scene.physics.add.collider(body.proxy, this.trunkGroup));
    if (this.baseGroup) colliders.push(this.scene.physics.add.collider(body.proxy, this.baseGroup));
    return colliders;
  }

  private destroyDecoy(decoyId: number, reason: DecoyEndReason, afterRemoval?: () => void): void {
    const decoy = this.runtime.get(decoyId);
    if (!decoy) return;
    const deathEffect = reason !== 'cleanup' ? this.buildDeathEffect(decoy) : null;
    const event = this.runtime.end(decoyId, reason);
    if (!event) return;
    const count = this.lifecycle?.ended(event) ?? 0;
    for (const collider of this.colliders.get(decoyId) ?? []) collider.destroy();
    this.colliders.delete(decoyId);
    this.bodies.get(decoyId)?.destroy();
    this.bodies.delete(decoyId);
    this.entities.get(decoyId)?.destroy();
    this.entities.delete(decoyId);
    this.trailPositions.delete(decoyId);
    afterRemoval?.();
    if (reason === 'cleanup') return;
    this.refundCooldown?.(decoy.ownerId, decoy.config.id, count * decoy.config.refundPerEnemyMs, this.hostNowMs);
    if (deathEffect) this.bridge.broadcastEffect(deathEffect);
    this.endEffect?.(event, this.hostNowMs);
  }

  private decoyVitals(decoy: HostDecoy) {
    return Object.freeze({
      kind: 'combatant' as const,
      hp: decoy.hp,
      maxHp: decoy.maxHp,
      armor: decoy.armor,
      maxArmor: decoy.maxArmor,
      alive: decoy.hp > 0,
    });
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
      x: decoy.position.x,
      y: decoy.position.y,
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
    const sprite = this.entities.get(decoy.id)?.sprite;
    const textureKey = sprite?.texture?.key ?? 'badger';
    const frame = sprite?.frame?.name ?? 0;
    return {
      type: 'death',
      x: decoy.position.x,
      y: decoy.position.y,
      targetId: `decoy_${decoy.id}`,
      targetColor: decoy.color,
      rotation: decoy.rotation + Math.PI / 2,
      seed: this.nextEffectSeed(),
      ...(textureKey && frame != null ? {
        textureKey,
        frame,
        displayWidth: sprite?.displayWidth ?? PLAYER_VISUAL_SIZE,
        displayHeight: sprite?.displayHeight ?? PLAYER_VISUAL_SIZE,
        tint: sprite?.tint ?? 0xffffff,
      } : {}),
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
      dirX = decoy.position.x - visualContext.sourceX;
      dirY = decoy.position.y - visualContext.sourceY;
    }

    if (Math.hypot(dirX, dirY) <= 0.0001 && attackerId) {
      const attacker = this.playerManager.getPlayer(attackerId);
      if (attacker) {
        dirX = decoy.position.x - attacker.x;
        dirY = decoy.position.y - attacker.y;
      }
    }

    const len = Math.hypot(dirX, dirY);
    if (len > 0.0001) {
      return { dirX: dirX / len, dirY: dirY / len };
    }

    const metrics = this.worldMetrics;
    if (!metrics) {
      throw new Error('DecoySystem requires WorldMetrics before resolving damage direction');
    }
    const centerX = metrics.offsetX + metrics.widthPx / 2;
    const centerY = metrics.offsetY + metrics.heightPx / 2;
    const angle = Math.atan2(decoy.position.y - centerY, decoy.position.x - centerX) + (((seed >>> 5) % 41) - 20) * (Math.PI / 180);
    return { dirX: Math.cos(angle), dirY: Math.sin(angle) };
  }

  private nextEffectSeed(): number {
    const seed = Math.imul(this.effectSeedCounter++, 0x9e3779b1);
    return seed >>> 0;
  }
}
