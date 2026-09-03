import type { ProjectileManager } from '../entities/ProjectileManager';
import type { StinkCloudSystem } from '../effects/StinkCloudSystem';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type {
  HostHeldActionKind,
  LoadoutToolRef,
  LoadoutUseParams,
  LoadoutUseResult,
  TemporaryUtilityInstanceDescriptor,
} from '../types';
import type {
  BfgUtilityConfig,
  ChargedThrowUtilityActivationConfig,
  DecoyUtilityConfig,
  PlaceableUtilityConfig,
  StinkCloudUtilityConfig,
  TaserUtilityConfig,
  TranslocatorUtilityConfig,
  UtilityConfig,
} from '../loadout/LoadoutConfig';
import { GenericUtility } from '../loadout/GenericUtility';
import {
  TemporaryUtilityCollection,
  type TemporaryUtilityRuntimeInstance,
} from '../loadout/TemporaryUtilityCollection';
import { getHeldWeaponGameplayMuzzleOrigin } from '../loadout/HeldItemVisuals';
import { PLAYER_SIZE, COLORS, type MuzzleOrigin } from '../config';
import type { CombatSystem } from '../systems/CombatSystem';
import type { DecoySystem } from '../systems/DecoySystem';
import type { TranslocatorSystem } from '../systems/TranslocatorSystem';
import type { HeldActionIdentity } from '../systems/HostHeldActionSystem';
import type { PlayerActionActor, PlayerUtilityActionRequest, PlayerUtilityActionSource } from './PlayerActionRuntime';

export interface TemporaryUtilityPort {
  addTemporaryUtility(playerId: string, config: UtilityConfig, charges: number): string | null;
  releaseTemporaryUtilityForObjective(playerId: string, objectiveId: string): void;
}

interface UtilityActorPort {
  getPlayer(playerId: string): PlayerActionActor | undefined;
  canInteract(playerId: string): boolean;
  isAlive(playerId: string): boolean;
  isUtilityBlocked(playerId: string): boolean;
}

interface UtilityLoadoutPort {
  getEquippedUtilityConfig(playerId: string): UtilityConfig | undefined;
  resolveUtilityConfig(playerId: string, config: UtilityConfig): UtilityConfig;
  noteUtilityUsed(playerId: string, now: number): void;
}

interface UtilityHeldActionPort {
  start(
    playerId: string,
    actionId: string,
    kind: HostHeldActionKind,
    expectedDurationMs: number,
    hostNowMs: number,
    identity?: HeldActionIdentity,
  ): boolean;
  consume(
    playerId: string,
    actionId: string | undefined,
    kind: HostHeldActionKind,
    fullChargeDurationMs: number,
    hostNowMs: number,
    expectedIdentity?: HeldActionIdentity,
  ): { readonly elapsedMs: number; readonly chargeFraction: number } | null;
  clearPlayer(playerId: string): void;
}

export interface PlayerUtilityActionNetworkPort {
  readonly loadout: {
    publishUtilityCooldownUntil: (playerId: string, until: number, utilityId: string) => void;
    publishTemporaryUtilityInstances: (playerId: string, descriptors: readonly TemporaryUtilityInstanceDescriptor[]) => void;
    publishHeldUtilityId: (playerId: string, utilityId: string) => void;
  };
  readonly roundStats: {
    recordUtilityUsed: (playerId: string) => void;
    recordConstructionBuilt: (playerId: string) => void;
  };
}

export interface PlayerUtilityActionRuntimeOptions {
  readonly projectileManager: ProjectileManager;
  readonly combatSystem: Pick<CombatSystem, 'resolveMeleeSwing'>;
  readonly actor: UtilityActorPort;
  readonly loadout: UtilityLoadoutPort;
  readonly heldAction: UtilityHeldActionPort;
  readonly translocator: TranslocatorSystem | null;
  readonly decoy: DecoySystem | null;
  readonly stinkCloud: StinkCloudSystem | null;
  readonly gameAudioSystem: GameAudioSystem;
  readonly network: PlayerUtilityActionNetworkPort;
  readonly dropBeer: (playerId: string, x?: number, y?: number) => void;
  readonly nukeStrike: (playerId: string, targetX: number, targetY: number) => boolean;
  readonly resolveToolUtilityConfig?: (toolRef: LoadoutToolRef) => UtilityConfig | undefined;
  readonly isToolAuthorized?: (playerId: string, toolRef: LoadoutToolRef) => boolean;
  readonly placeable: {
    use: (
      config: PlaceableUtilityConfig,
      playerId: string,
      x: number,
      y: number,
      targetX: number,
      targetY: number,
      now: number,
      playerColor: number,
      params?: LoadoutUseParams,
    ) => boolean;
  } | null;
}

type ChargedUtilityConfig = UtilityConfig & {
  activation: Extract<UtilityConfig['activation'], { type: 'charged_throw' | 'charged_gate' }>;
};

/**
 * World-owned semantic utility action boundary.
 *
 * Equipment resolution stays behind the loadout read port. This owner is the single writer for
 * equipped utility cooldowns, temporary utility identity/charges and utility commit ordering.
 * Ability-specific systems only receive their narrow execution call.
 */
export class PlayerUtilityActionRuntime implements TemporaryUtilityPort {
  private readonly temporaryUtilities = new TemporaryUtilityCollection();
  private readonly equippedUtilities = new Map<string, GenericUtility>();
  private readonly inspectorUtilities = new Map<string, Map<string, GenericUtility>>();
  private readonly committedAttempts = new Map<string, LoadoutUseResult>();
  private placeableCapability: PlayerUtilityActionRuntimeOptions['placeable'];
  private destroyed = false;

  constructor(private readonly options: PlayerUtilityActionRuntimeOptions) {
    this.placeableCapability = options.placeable;
  }

  setPlacementCapability(
    capability: NonNullable<PlayerUtilityActionRuntimeOptions['placeable']>['use'] | null,
  ): void {
    this.placeableCapability = capability ? { use: capability } : null;
  }

  syncEquippedUtility(playerId: string): void {
    const config = this.options.loadout.getEquippedUtilityConfig(playerId);
    if (!config) {
      this.equippedUtilities.delete(playerId);
      this.publishTemporaryUtilities(playerId);
      return;
    }
    const current = this.equippedUtilities.get(playerId);
    if (current?.config.id === config.id && current.config === config) {
      this.publishTemporaryUtilities(playerId);
      return;
    }
    const previousLastUsedAt = current?.getLastUsedAt() ?? -Infinity;
    const next = new GenericUtility(config);
    if (previousLastUsedAt !== -Infinity) next.setLastUsedAt(previousLastUsedAt);
    this.equippedUtilities.set(playerId, next);
    this.options.network.loadout.publishUtilityCooldownUntil(playerId, 0, '__clear__');
    this.options.network.loadout.publishHeldUtilityId(playerId, '');
    this.publishTemporaryUtilities(playerId);
  }

  removePlayer(playerId: string): void {
    this.equippedUtilities.delete(playerId);
    this.inspectorUtilities.delete(playerId);
    this.temporaryUtilities.clearPlayer(playerId);
    for (const key of this.committedAttempts.keys()) {
      if (key.startsWith(`${playerId}:`)) this.committedAttempts.delete(key);
    }
    this.publishTemporaryUtilities(playerId);
    this.options.network.loadout.publishUtilityCooldownUntil(playerId, 0, '__clear__');
    this.options.network.loadout.publishHeldUtilityId(playerId, '');
  }

  addTemporaryUtility(playerId: string, config: UtilityConfig, charges: number): string | null {
    if (this.options.loadout.getEquippedUtilityConfig(playerId) === undefined) return null;
    const effectiveConfig = this.options.loadout.resolveUtilityConfig(playerId, config);
    const source = config.type === 'placeable_pedestal'
      ? { kind: 'objective-placement' as const, objectiveId: config.rewardObjectiveId, powerUpDefId: config.powerUpDefId }
      : { kind: 'utility' as const };
    const instance = this.temporaryUtilities.add(playerId, effectiveConfig, charges, source);
    if (!instance) return null;
    this.publishTemporaryUtilities(playerId);
    return instance.instanceId;
  }

  getTemporaryUtilityConfig(playerId: string, instanceId: string): UtilityConfig | null {
    return this.temporaryUtilities.get(playerId, instanceId)?.utility.config ?? null;
  }

  releaseTemporaryUtilityForObjective(playerId: string, objectiveId: string): void {
    if (!this.temporaryUtilities.removeForObjective(playerId, objectiveId)) return;
    this.publishTemporaryUtilities(playerId);
  }

  clearTemporaryUtilities(playerId: string): void {
    this.temporaryUtilities.clearPlayer(playerId);
    this.publishTemporaryUtilities(playerId);
  }

  beginUtilityCooldown(playerId: string, utilityId: string, now: number): void {
    const utility = this.equippedUtilities.get(playerId);
    if (!utility || utility.config.id !== utilityId) return;
    utility.recordUse(now);
    this.options.network.loadout.publishUtilityCooldownUntil(playerId, now + utility.config.cooldown, utilityId);
  }

  breakStealth(playerId: string, now: number): void {
    if (this.destroyed) return;
    this.options.decoy?.breakStealth(playerId, now);
  }

  startHeldAction(
    playerId: string,
    actionId: string,
    kind: HostHeldActionKind,
    hostNowMs: number,
    toolRef?: LoadoutToolRef,
    temporaryUtilityInstanceId?: string,
  ): boolean {
    if (this.destroyed || (toolRef !== undefined && temporaryUtilityInstanceId !== undefined)) return false;
    if (!this.options.actor.canInteract(playerId)
      || !this.options.actor.isAlive(playerId)
      || this.options.actor.isUtilityBlocked(playerId)) return false;

    const source = this.resolveSource(playerId, toolRef, temporaryUtilityInstanceId);
    if (!source || source.utility.config.activation.type !== kind) return false;
    const activation = source.utility.config.activation;
    if (activation.type !== 'charged_throw' && activation.type !== 'charged_gate') return false;
    const identity = this.identityFor(source.source);
    return this.options.heldAction.start(
      playerId,
      actionId,
      kind,
      activation.fullChargeDuration,
      hostNowMs,
      identity,
    );
  }

  useInspectorUtility(
    playerId: string,
    tool: LoadoutToolRef,
    config: UtilityConfig,
    angle: number,
    targetX: number,
    targetY: number,
    hostNowMs: number,
    params?: LoadoutUseParams,
  ): LoadoutUseResult {
    if (tool.kind !== 'utility') return { ok: false, reason: 'invalid' };
    if (this.options.isToolAuthorized && !this.options.isToolAuthorized(playerId, tool)) {
      return { ok: false, reason: 'blocked' };
    }
    const effectiveConfig = this.options.loadout.resolveUtilityConfig(playerId, config);
    return this.execute({
      category: 'utility',
      playerId,
      angle,
      targetX,
      targetY,
      hostNowMs,
      params: { ...(params ?? {}), toolRef: tool },
      source: { kind: 'tool', toolRef: tool, config: effectiveConfig },
    }, true);
  }

  execute(request: PlayerUtilityActionRequest, inspector = false): LoadoutUseResult {
    if (this.destroyed) return { ok: false, reason: 'invalid' };
    const attemptKey = request.attemptId ? `${request.playerId}:${request.attemptId}` : null;
    if (request.attemptId !== undefined
      && (typeof request.attemptId !== 'string'
        || request.attemptId.length === 0
        || request.attemptId.length > 120
        || request.attemptId.trim() !== request.attemptId)) {
      return { ok: false, reason: 'invalid' };
    }
    if (attemptKey) {
      const previous = this.committedAttempts.get(attemptKey);
      if (previous) return previous;
    }

    const wireTemporaryId = request.params?.temporaryUtilityInstanceId;
    if (request.source?.kind === 'temporary'
      && wireTemporaryId !== undefined
      && wireTemporaryId !== request.source.instanceId) return { ok: false, reason: 'invalid' };
    if (request.source?.kind === 'equipped'
      && (wireTemporaryId !== undefined || request.params?.toolRef !== undefined)) return { ok: false, reason: 'invalid' };
    if (request.source?.kind === 'tool'
      && (wireTemporaryId !== undefined
        || (request.params?.toolRef !== undefined
          && (request.params.toolRef.kind !== request.source.toolRef.kind || request.params.toolRef.id !== request.source.toolRef.id)))) {
      return { ok: false, reason: 'invalid' };
    }

    const player = this.options.actor.getPlayer(request.playerId);
    const source = this.resolveSource(
      request.playerId,
      request.source?.kind === 'tool' ? request.source.toolRef : undefined,
      request.source?.kind === 'temporary'
        ? request.source.instanceId
        : request.params?.temporaryUtilityInstanceId,
      request.source,
    );
    if (!player || !source) return { ok: false, reason: 'invalid' };
    if (!this.options.actor.canInteract(request.playerId)
      || !this.options.actor.isAlive(request.playerId)
      || this.options.actor.isUtilityBlocked(request.playerId)) {
      return { ok: false, reason: 'blocked' };
    }

    const utility = source.utility;
    const cfg = utility.config;
    if (cfg.type !== 'decoy') this.options.decoy?.breakStealth(request.playerId, request.hostNowMs);
    if (source.temporary && (source.temporary.charges <= 0 || source.temporary.cooldownUntil > request.hostNowMs)) {
      return { ok: false, reason: source.temporary.cooldownUntil > request.hostNowMs ? 'cooldown' : 'invalid' };
    }
    if (!source.temporary && utility.isOnCooldown(request.hostNowMs)) return { ok: false, reason: 'cooldown' };

    let authoritativeParams = request.params;
    if (this.isChargeable(cfg) && !this.isTranslocatorRecall(request.playerId, cfg)) {
      const held = this.options.heldAction.consume(
        request.playerId,
        request.params?.heldActionId,
        cfg.activation.type,
        cfg.activation.fullChargeDuration,
        request.hostNowMs,
        this.identityFor(source.source),
      );
      if (!held || (cfg.activation.type === 'charged_gate' && held.chargeFraction < 1)) {
        return { ok: false, reason: 'blocked' };
      }
      authoritativeParams = {
        ...(request.params ?? {}),
        utilityChargeFraction: held.chargeFraction,
      };
    } else if (this.isTranslocatorRecall(request.playerId, cfg)) {
      this.options.heldAction.clearPlayer(request.playerId);
    }

    const position = inspector ? { x: player.x, y: player.y } : {
      x: request.clientPosition?.x ?? player.x,
      y: request.clientPosition?.y ?? player.y,
    };
    const didUse = this.dispatch(
      cfg,
      request.playerId,
      position.x,
      position.y,
      request.angle,
      request.targetX,
      request.targetY,
      request.hostNowMs,
      player.color,
      player.displaySize ?? PLAYER_SIZE,
      authoritativeParams,
    );
    if (!didUse) return { ok: false, reason: 'blocked' };

    if (source.temporary) {
      this.temporaryUtilities.recordSuccessfulUse(request.playerId, source.temporary.instanceId, request.hostNowMs);
      this.publishTemporaryUtilities(request.playerId);
    } else if (!cfg.skipCooldownPublish) {
      utility.recordUse(request.hostNowMs);
      this.options.network.loadout.publishUtilityCooldownUntil(
        request.playerId,
        request.hostNowMs + cfg.cooldown,
        cfg.id,
      );
    }
    this.options.loadout.noteUtilityUsed(request.playerId, request.hostNowMs);
    this.options.network.loadout.publishHeldUtilityId(request.playerId, cfg.id);
    this.options.network.roundStats.recordUtilityUsed(request.playerId);
    if (cfg.type === 'placeable_rock' || cfg.type === 'placeable_turret' || cfg.type === 'placeable_pedestal') {
      this.options.network.roundStats.recordConstructionBuilt(request.playerId);
    }
    if (cfg.type === 'decoy') {
      this.options.dropBeer(request.playerId);
      this.options.gameAudioSystem.playSound('sfx_place_decoy', player.x, player.y, request.playerId);
    }
    const result: LoadoutUseResult = { ok: true };
    if (attemptKey) this.committedAttempts.set(attemptKey, result);
    return result;
  }

  private resolveSource(
    playerId: string,
    toolRef?: LoadoutToolRef,
    temporaryUtilityInstanceId?: string,
    explicit?: PlayerUtilityActionSource,
  ): { source: PlayerUtilityActionSource; utility: GenericUtility; temporary?: TemporaryUtilityRuntimeInstance } | null {
    if (toolRef) {
      if (toolRef.kind !== 'utility' || (this.options.isToolAuthorized && !this.options.isToolAuthorized(playerId, toolRef))) return null;
      const config = explicit?.kind === 'tool'
        ? explicit.config
        : this.options.resolveToolUtilityConfig?.(toolRef);
      if (!config) return null;
      const utilities = this.inspectorUtilities.get(playerId) ?? new Map<string, GenericUtility>();
      this.inspectorUtilities.set(playerId, utilities);
      let utility = utilities.get(config.id);
      if (!utility || utility.config !== config) {
        const previousLastUsedAt = utility?.getLastUsedAt() ?? -Infinity;
        utility = new GenericUtility(config);
        if (previousLastUsedAt !== -Infinity) utility.setLastUsedAt(previousLastUsedAt);
        utilities.set(config.id, utility);
      }
      return { source: { kind: 'tool', toolRef, config }, utility };
    }
    if (temporaryUtilityInstanceId !== undefined) {
      const temporary = this.temporaryUtilities.get(playerId, temporaryUtilityInstanceId);
      return temporary
        ? { source: { kind: 'temporary', instanceId: temporaryUtilityInstanceId }, utility: temporary.utility, temporary }
        : null;
    }
    this.syncEquippedUtility(playerId);
    const utility = this.equippedUtilities.get(playerId);
    return utility ? { source: { kind: 'equipped' }, utility } : null;
  }

  private identityFor(source: PlayerUtilityActionSource): HeldActionIdentity | undefined {
    if (source.kind === 'temporary') return { temporaryUtilityInstanceId: source.instanceId };
    if (source.kind === 'tool') return { toolRef: source.toolRef };
    return undefined;
  }

  private isChargeable(config: UtilityConfig): config is ChargedUtilityConfig {
    return config.activation.type === 'charged_throw' || config.activation.type === 'charged_gate';
  }

  private isTranslocatorRecall(playerId: string, config: UtilityConfig): boolean {
    return config.type === 'translocator' && this.options.translocator?.getActivePuckId(playerId) !== undefined;
  }

  private dispatch(
    cfg: UtilityConfig,
    playerId: string,
    x: number,
    y: number,
    angle: number,
    targetX: number,
    targetY: number,
    now: number,
    playerColor: number,
    displaySize: number,
    params?: LoadoutUseParams,
  ): boolean {
    const muzzle = getHeldWeaponGameplayMuzzleOrigin(cfg.id, x, y, angle, displaySize) ?? undefined;
    switch (cfg.activation.type) {
      case 'charged_throw':
        if (cfg.type === 'translocator') {
          return this.options.translocator?.handleUse(playerId, angle, targetX, targetY, now, params, cfg as TranslocatorUtilityConfig) ?? false;
        }
        return this.throwGrenade(
          cfg as UtilityConfig & { activation: ChargedThrowUtilityActivationConfig },
          x,
          y,
          angle,
          playerId,
          playerColor,
          params?.utilityChargeFraction ?? 0,
          muzzle,
        );
      case 'charged_gate':
        if ((params?.utilityChargeFraction ?? 0) < 1 || cfg.type !== 'bfg') return false;
        return this.fireBfg(cfg as BfgUtilityConfig, x, y, angle, playerId, muzzle);
      case 'targeted_click':
        return cfg.type === 'nuke' && this.options.nukeStrike(playerId, targetX, targetY);
      case 'placement_mode':
        return (cfg.type === 'placeable_rock' || cfg.type === 'placeable_turret' || cfg.type === 'placeable_pedestal')
          && (this.placeableCapability?.use(cfg as PlaceableUtilityConfig, playerId, x, y, targetX, targetY, now, playerColor, params) ?? false);
      case 'instant':
        if (cfg.type === 'stinkcloud') return this.activateStinkCloud(cfg, playerId, now);
        if (cfg.type === 'taser') return this.activateTaser(cfg, playerId, x, y, angle, playerColor);
        if (cfg.type === 'decoy') return this.options.decoy?.activate(cfg as DecoyUtilityConfig, playerId, angle, playerColor, now) ?? false;
        return false;
    }
  }

  private throwGrenade(
    cfg: UtilityConfig & { activation: ChargedThrowUtilityActivationConfig },
    x: number,
    y: number,
    angle: number,
    playerId: string,
    playerColor: number,
    chargeFraction: number,
    muzzle?: MuzzleOrigin,
  ): boolean {
    const clampedCharge = Math.max(0, Math.min(1, chargeFraction));
    const speed = cfg.activation.minThrowSpeed + (cfg.projectileSpeed - cfg.activation.minThrowSpeed) * clampedCharge;
    this.options.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed,
      size: cfg.projectileSize,
      damage: 0,
      color: cfg.projectileColor ?? playerColor,
      allowTeamDamage: cfg.allowTeamDamage,
      lifetime: cfg.fuseTime,
      maxBounces: cfg.maxBounces,
      isGrenade: true,
      adrenalinGain: 0,
      sourceId: cfg.id,
      gameplayMuzzleOrigin: muzzle,
      fuseTime: cfg.fuseTime,
      grenadeEffect: this.buildGrenadeEffect(cfg, playerColor),
      projectileStyle: cfg.projectileStyle,
      grenadeVisualPreset: cfg.grenadeVisualPreset,
      frictionDelayMs: cfg.frictionDelayMs,
      airFrictionDecayPerSec: cfg.airFrictionDecayPerSec,
      bounceFrictionMultiplier: cfg.bounceFrictionMultiplier,
      stopSpeedThreshold: cfg.stopSpeedThreshold,
      shotAudioKey: cfg.shotAudio?.successKey,
    });
    return true;
  }

  private fireBfg(cfg: BfgUtilityConfig, x: number, y: number, angle: number, playerId: string, muzzle?: MuzzleOrigin): boolean {
    this.options.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed: cfg.projectileSpeed,
      size: cfg.projectileSize,
      damage: cfg.directDamage,
      color: COLORS.GREEN_2,
      allowTeamDamage: cfg.allowTeamDamage,
      lifetime: (cfg.range / cfg.projectileSpeed) * 1000,
      remainingRangePx: cfg.range,
      maxBounces: 0,
      isGrenade: false,
      adrenalinGain: 0,
      sourceId: cfg.id,
      gameplayMuzzleOrigin: muzzle,
      projectileStyle: 'bfg',
      isBfg: true,
      proximityPulse: cfg.proximityPulse,
      shotAudioKey: cfg.shotAudio?.successKey,
    });
    return true;
  }

  private activateStinkCloud(cfg: StinkCloudUtilityConfig, playerId: string, now: number): boolean {
    if (!this.options.stinkCloud) return false;
    this.options.stinkCloud.hostActivate(
      playerId,
      cfg.cloudRadius,
      cfg.cloudDuration,
      cfg.cloudDamagePerTick,
      cfg.cloudTickInterval,
      cfg.rockDamageMult ?? 1,
      cfg.trainDamageMult ?? 1,
      cfg.baseDamageMult ?? 1,
      cfg.afterCloudDurationMs ?? 0,
      cfg.afterCloudRadiusFactor ?? 0,
      cfg.afterCloudDamageFactor ?? 0,
      cfg.visualVariant ?? 'stink',
      now,
    );
    return true;
  }

  private activateTaser(cfg: TaserUtilityConfig, playerId: string, x: number, y: number, angle: number, playerColor: number): boolean {
    return this.options.combatSystem.resolveMeleeSwing(
      playerId, x, y, angle,
      cfg.range, cfg.hitArcDegrees, cfg.damage,
      0, cfg.id, playerColor, undefined,
      cfg.rockDamageMult ?? 1,
      cfg.trainDamageMult ?? 1,
      cfg.visualPreset,
      cfg.shotAudio?.successKey,
      undefined,
      (cfg.chainCount ?? 0) > 0
        ? { count: cfg.chainCount ?? 0, radius: cfg.chainRadius ?? 0, damageFactor: cfg.chainDamageFactor ?? 0 }
        : undefined,
      undefined,
      undefined,
      1,
      undefined,
      cfg.baseDamageMult ?? 1,
    );
  }

  private buildGrenadeEffect(cfg: UtilityConfig, playerColor?: number) {
    if (cfg.type === 'explosive') {
      return { type: 'damage' as const, radius: cfg.aoeRadius, damage: cfg.aoeDamage, damageFalloff: cfg.damageFalloff, allowTeamDamage: cfg.allowTeamDamage, rockDamageMult: cfg.rockDamageMult, trainDamageMult: cfg.trainDamageMult, baseDamageMult: cfg.baseDamageMult, visualStyle: cfg.explosionVisualStyle, clusterCount: cfg.clusterCount, clusterRadiusFactor: cfg.clusterRadiusFactor, clusterDamageFactor: cfg.clusterDamageFactor };
    }
    if (cfg.type === 'molotov') {
      return { type: 'fire' as const, radius: cfg.fireRadius, damagePerTick: cfg.fireDamagePerTick, lingerDuration: cfg.fireLingerDuration, allowTeamDamage: cfg.allowTeamDamage, rockDamageMult: cfg.rockDamageMult, trainDamageMult: cfg.trainDamageMult, baseDamageMult: cfg.baseDamageMult, burnDurationMs: cfg.fireBurnDurationMs, burnDamagePerTick: cfg.fireBurnDamagePerTick, wildfire: (cfg.wildfireEnabled ?? 0) > 0 ? { speedMultiplier: cfg.wildfirePanicSpeedMultiplier ?? 1.5, trailDurationMs: cfg.wildfireTrailDurationMs ?? 2000, trailDamagePerTick: cfg.wildfireTrailDamagePerTick ?? 2 } : undefined };
    }
    if (cfg.type === 'smoke') {
      return { type: 'smoke' as const, radius: cfg.smokeRadius, spreadDuration: cfg.smokeExpandDuration, lingerDuration: cfg.smokeLingerDuration, dissipateDuration: cfg.smokeDissipateDuration, maxAlpha: cfg.smokeMaxAlpha, dotDamagePerTick: cfg.smokeDotDamagePerTick, dotTickIntervalMs: cfg.smokeDotTickIntervalMs };
    }
    if (cfg.type === 'time_bubble') {
      return { type: 'time_bubble' as const, radius: cfg.bubbleRadius, duration: cfg.bubbleDuration, projectileSlowFactor: cfg.projectileSlowFactor, playerSlowFactor: cfg.playerSlowFactor, trainSlowFactor: cfg.trainSlowFactor, color: cfg.bubbleColor ?? cfg.projectileColor ?? playerColor, distortion: cfg.bubbleDistortion, friendlyImmunity: cfg.friendlyImmunity };
    }
    return { type: 'damage' as const, radius: 0, damage: 0 };
  }

  private publishTemporaryUtilities(playerId: string): void {
    this.options.network.loadout.publishTemporaryUtilityInstances(
      playerId,
      this.temporaryUtilities.getDescriptors(playerId),
    );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const playerId of this.equippedUtilities.keys()) this.publishTemporaryUtilities(playerId);
    this.equippedUtilities.clear();
    this.inspectorUtilities.clear();
    this.committedAttempts.clear();
  }
}
