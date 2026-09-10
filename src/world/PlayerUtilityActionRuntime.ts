import type { StinkCloudUtilityState } from '../loadout/StinkCloudUtilityState';
import { resolveTimeBubblePrismEmitter } from '../loadout/TimeBubbleConfig';
import { resolveMolotovFireEffect } from '../loadout/resolveMolotovFireEffect';
import type { TimeBubbleUtilityState } from '../loadout/TimeBubbleUtilityState';
import type { TimeBubbleUtilityPort } from './TimeBubbleUtilityPort';
import type { ProjectileGrenadePayloadRequest } from '../projectile/ProjectileExplosionPort';
import type { ProjectileSpawnPort } from '../projectile/ProjectileSpawnPort';
import { createSingleOwnerProvenance } from '../projectile/ProjectileSpawnRequest';
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
import { UTILITY_CONFIGS } from '../loadout/LoadoutConfig';
import { RechargeableCharges } from '../systems/RechargeableCharges';
import { getUtilityChargeReadyAt, type UtilityChargeState } from '../loadout/UtilityChargeState';
import {
  TemporaryUtilityCollection,
  type TemporaryUtilityRuntimeInstance,
} from '../loadout/TemporaryUtilityCollection';
import { getHeldWeaponGameplayMuzzleOrigin } from '../loadout/HeldItemVisuals';
import { PLAYER_SIZE, COLORS, type MuzzleOrigin } from '../config';
import type {
  CombatImmediateAttackPort,
} from '../combat/CombatCapabilities';
import type { MeleeSwingRequest } from '../loadout/WeaponFireExecutor';
import type { DecoySystem } from '../systems/DecoySystem';
import type { TranslocatorSystem } from '../systems/TranslocatorSystem';
import type { HeldActionIdentity } from '../systems/HostHeldActionSystem';
import {
  isValidPlayerActionAttemptId,
  type PlayerActionActor,
  type PlayerUtilityActionRequest,
  type PlayerUtilityActionSource,
} from './PlayerActionRuntime';

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
    publishStinkCloudUtilityState?: (playerId: string, state: StinkCloudUtilityState | null) => void;
    publishTranslocatorUseState?: (playerId: string, state: import('../loadout/TranslocatorUseState').TranslocatorUseState | null) => void;
    publishTimeBubbleUtilityState?: (playerId: string, state: TimeBubbleUtilityState | null) => void;
    publishUtilityChargeState?: (playerId: string, utilityId: string, state: UtilityChargeState | null) => void;
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
  readonly captureSmokeDamage: (playerId: string, now: number) => Pick<import('../types').SmokeGrenadeEffect, 'sourceDamageMultiplier' | 'sourceOutgoingDamage'>;
  readonly projectileSpawn: ProjectileSpawnPort;
  /** Immediate attacks use the same normalized capability as regular weapon execution. */
  readonly combatSystem: CombatImmediateAttackPort;
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

const MAX_RECENT_ATTEMPTS_PER_PLAYER = 64;

interface UtilityChargeStock {
  config: UtilityConfig;
  stock: RechargeableCharges;
  lockoutUntil: number;
  revision: number;
  lastCommittedAttemptId?: string;
  published?: UtilityChargeState;
}

/**
 * World-owned semantic utility action boundary.
 *
 * Equipment resolution stays behind the loadout read port. This owner is the single writer for
 * equipped utility cooldowns, temporary utility identity/charges and utility commit ordering.
 * Ability-specific systems only receive their narrow execution call.
 */
export class PlayerUtilityActionRuntime implements TemporaryUtilityPort {
  private readonly stinkCloudUses = new Map<string, StinkCloudUtilityState>();

  getStinkCloudState(playerId: string): StinkCloudUtilityState | null { return this.stinkCloudUses.get(playerId) ?? null; }

  getStinkMoveSpeedBonus(playerId: string, now: number): number {
    const s = this.stinkCloudUses.get(playerId);
    return s?.phase === 'active' && now < s.activeUntil ? s.moveSpeedBonus : 0;
  }

  getStinkDamageReduction(playerId: string, now: number): number {
    const s = this.stinkCloudUses.get(playerId);
    return s?.phase === 'active' && now < s.activeUntil ? s.damageReduction : 0;
  }

  private stinkCloudBlocked(playerId: string, now: number): 'blocked' | 'cooldown' | null {
    const s = this.stinkCloudUses.get(playerId);
    return !s ? null : s.phase === 'active' ? 'blocked' : s.cooldownUntil > now ? 'cooldown' : null;
  }

  private publishStinkCloudState(playerId: string): void {
    this.options.network.loadout.publishStinkCloudUtilityState?.(playerId, this.getStinkCloudState(playerId));
  }

  private onStinkCloudEnded(cloudId: number, playerId: string, endedAt: number): void {
    const s = this.stinkCloudUses.get(playerId);
    if (this.destroyed || s?.phase !== 'active' || s.cloudId !== cloudId) return;
    const cooldownUntil = endedAt + s.cooldownDurationMs;
    this.stinkCloudUses.set(playerId, { utilityId: 'STINK_CLOUD', phase: 'cooldown',
      cooldownDurationMs: s.cooldownDurationMs, cooldownUntil, temporaryUtilityInstanceId: s.temporaryUtilityInstanceId });
    this.options.network.loadout.publishUtilityCooldownUntil(playerId, cooldownUntil, 'STINK_CLOUD');
    this.publishStinkCloudState(playerId);
  }

  private readonly timeBubbleUses = new Map<string, TimeBubbleUtilityState>();
  private timeBubblePort: TimeBubbleUtilityPort | null = null;

  setTimeBubblePort(port: TimeBubbleUtilityPort | null): void {
    if (!port) for (const [playerId, state] of this.timeBubbleUses) {
      if (state.phase !== 'cooldown') this.clearTimeBubbleUse(playerId);
    }
    this.timeBubblePort = port;
  }

  getTimeBubbleState(playerId: string): TimeBubbleUtilityState | null {
    return this.timeBubbleUses.get(playerId) ?? null;
  }

  createTimeBubbleFromGrenade(request: ProjectileGrenadePayloadRequest, now: number): void {
    const playerId = request.provenance.gameplaySourceId;
    const state = this.timeBubbleUses.get(playerId);
    if (this.destroyed || !this.timeBubblePort || request.effect.type !== 'time_bubble'
      || state?.phase !== 'flying' || state.projectileId !== request.projectileId) return;
    const bubbleId = this.timeBubblePort.create(request.provenance.allegiance.ownerId, request.x, request.y,
      request.effect, now, request.provenance);
    this.timeBubbleUses.set(playerId, { utilityId: state.utilityId, cooldownDurationMs: state.cooldownDurationMs,
      focusEnabled: state.focusEnabled, temporaryUtilityInstanceId: state.temporaryUtilityInstanceId, phase: 'active', bubbleId });
    this.publishTimeBubbleState(playerId);
  }

  onTimeBubbleEnded(bubbleId: number, endedAt: number): void {
    for (const [playerId, state] of this.timeBubbleUses) {
      if (state.phase === 'active' && state.bubbleId === bubbleId) this.finishTimeBubbleUse(playerId, state, endedAt);
    }
  }

  onUtilityProjectileResolved(projectileId: number, now: number, grenadePayloadPending = false): void {
    if (grenadePayloadPending) return;
    for (const [playerId, state] of this.timeBubbleUses) {
      if (state.phase === 'flying' && state.projectileId === projectileId) this.finishTimeBubbleUse(playerId, state, now);
    }
  }

  private finishTimeBubbleUse(playerId: string, state: TimeBubbleUtilityState, now: number): void {
    if (this.destroyed) return;
    const cooldownUntil = now + state.cooldownDurationMs;
    this.timeBubbleUses.set(playerId, { utilityId: state.utilityId, cooldownDurationMs: state.cooldownDurationMs,
      focusEnabled: state.focusEnabled, phase: 'cooldown', cooldownUntil });
    this.options.network.loadout.publishUtilityCooldownUntil(playerId, cooldownUntil, state.utilityId);
    this.publishTimeBubbleState(playerId);
  }

  private publishTimeBubbleState(playerId: string): void {
    this.options.network.loadout.publishTimeBubbleUtilityState?.(playerId, this.getTimeBubbleState(playerId));
  }

  private timeBubbleBlocked(playerId: string, now: number): 'blocked' | 'cooldown' | null {
    const state = this.timeBubbleUses.get(playerId);
    if (!state) return null;
    return state.phase === 'cooldown' ? (state.cooldownUntil > now ? 'cooldown' : null) : 'blocked';
  }

  private collapseTimeBubble(request: PlayerUtilityActionRequest): LoadoutUseResult {
    const state = this.timeBubbleUses.get(request.playerId);
    const player = this.options.actor.getPlayer(request.playerId);
    if (!player || !Number.isSafeInteger(request.params?.timeBubbleCollapseId)
      || !Number.isFinite(request.targetX) || !Number.isFinite(request.targetY)) return { ok: false, reason: 'invalid' };
    if (!this.options.actor.canInteract(request.playerId) || !this.options.actor.isAlive(request.playerId)
      || this.options.actor.isUtilityBlocked(request.playerId) || state?.phase !== 'active'
      || state.bubbleId !== request.params?.timeBubbleCollapseId) return { ok: false, reason: 'blocked' };
    const ok = this.timeBubblePort?.collapse(state.bubbleId, { targetX: request.targetX, targetY: request.targetY,
      ownerId: request.playerId, ownerColor: player.color, nowMs: request.hostNowMs, redirectProjectiles: state.focusEnabled }) ?? false;
    if (!ok) return { ok: false, reason: 'blocked' };
    this.options.heldAction.clearPlayer(request.playerId);
    this.options.decoy?.breakStealth(request.playerId, request.hostNowMs);
    const result = { ok: true };
    if (request.attemptId) this.rememberCommittedAttempt(request.playerId, request.attemptId, result);
    return result;
  }

  private clearTimeBubbleUse(playerId: string): void {
    const state = this.timeBubbleUses.get(playerId);
    this.timeBubbleUses.delete(playerId);
    if (state?.phase === 'active') this.timeBubblePort?.remove(state.bubbleId);
    if (state?.phase === 'flying') this.timeBubblePort?.discardProjectile(state.projectileId);
    this.publishTimeBubbleState(playerId);
  }
  private readonly decoyCooldowns = new Map<string, { utilityId: string; until: number }>();
  private readonly chargeStocks = new Map<string, Map<string, UtilityChargeStock>>();
  private hostFrameNowMs = 0;
  private readonly temporaryUtilities = new TemporaryUtilityCollection();
  private readonly equippedUtilities = new Map<string, GenericUtility>();
  private readonly inspectorUtilities = new Map<string, Map<string, GenericUtility>>();
  private readonly committedAttempts = new Map<string, Map<string, LoadoutUseResult>>();
  private placeableCapability: PlayerUtilityActionRuntimeOptions['placeable'];
  private destroyed = false;

  constructor(private readonly options: PlayerUtilityActionRuntimeOptions) {
    this.placeableCapability = options.placeable;
    options.stinkCloud?.setPrimaryCloudEndHandler((cloudId, playerId, endedAt) => this.onStinkCloudEnded(cloudId, playerId, endedAt));
  }

  setPlacementCapability(
    capability: NonNullable<PlayerUtilityActionRuntimeOptions['placeable']>['use'] | null,
  ): void {
    this.placeableCapability = capability ? { use: capability } : null;
  }

  syncEquippedUtility(playerId: string): void {
    const config = this.options.loadout.getEquippedUtilityConfig(playerId);
    if (config?.charges) this.getChargeStock(playerId, config, this.hostFrameNowMs);
    for (const toolConfig of Object.values(UTILITY_CONFIGS)) {
      if (!toolConfig.charges || toolConfig.id === config?.id
        || !this.options.isToolAuthorized?.(playerId, { kind: 'utility', id: toolConfig.id })) continue;
      this.getChargeStock(playerId, this.options.loadout.resolveUtilityConfig(playerId, toolConfig), this.hostFrameNowMs);
    }
    if (!config) {
      this.equippedUtilities.delete(playerId);
      this.publishTemporaryUtilities(playerId);
      return;
    }
    const current = this.equippedUtilities.get(playerId);
    if (current?.config.id === config.id && current.config === config) {
      return;
    }
    const next = new GenericUtility(config);
    this.equippedUtilities.set(playerId, next);
    this.options.network.loadout.publishUtilityCooldownUntil(playerId, 0, '__clear__');
    const stinkCloud = this.stinkCloudUses.get(playerId);
    if (stinkCloud?.phase === 'cooldown') this.options.network.loadout.publishUtilityCooldownUntil(playerId, stinkCloud.cooldownUntil, 'STINK_CLOUD');
    const timeBubble = this.timeBubbleUses.get(playerId);
    if (timeBubble?.phase === 'cooldown')
      this.options.network.loadout.publishUtilityCooldownUntil(playerId, timeBubble.cooldownUntil, timeBubble.utilityId);
    const decoyCooldown = this.decoyCooldowns.get(playerId);
    if (config.type === 'decoy' && decoyCooldown?.utilityId === config.id) {
      next.setLastUsedAt(decoyCooldown.until - config.cooldown);
      this.options.network.loadout.publishUtilityCooldownUntil(playerId, decoyCooldown.until, config.id);
    }
    this.options.network.loadout.publishHeldUtilityId(playerId, '');
    this.publishTemporaryUtilities(playerId);
  }

  removePlayer(playerId: string): void {
    this.stinkCloudUses.delete(playerId);
    this.options.stinkCloud?.hostDeactivateForPlayer(playerId, this.hostFrameNowMs);
    this.publishStinkCloudState(playerId);
    this.clearTimeBubbleUse(playerId);
    for (const id of this.chargeStocks.get(playerId)?.keys() ?? []) {
      this.options.network.loadout.publishUtilityChargeState?.(playerId, id, null);
    }
    this.chargeStocks.delete(playerId);
    this.equippedUtilities.delete(playerId);
    this.inspectorUtilities.delete(playerId);
    this.decoyCooldowns.delete(playerId);
    this.temporaryUtilities.clearPlayer(playerId);
    this.committedAttempts.delete(playerId);
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

  refundUtilityCooldown(playerId: string, utilityId: string, amountMs: number, now: number): void {
    const cooldown = this.decoyCooldowns.get(playerId);
    if (this.destroyed || !cooldown || cooldown.utilityId !== utilityId || !Number.isFinite(amountMs) || amountMs <= 0) return;
    cooldown.until = Math.max(now, cooldown.until - amountMs);
    const utilities = [this.equippedUtilities.get(playerId), this.inspectorUtilities.get(playerId)?.get(utilityId)];
    for (const utility of utilities) if (utility?.config.id === utilityId)
      utility.setLastUsedAt(cooldown.until - utility.config.cooldown);
    for (const descriptor of this.temporaryUtilities.getDescriptors(playerId)) {
      if (descriptor.utilityId !== utilityId) continue;
      const instance = this.temporaryUtilities.get(playerId, descriptor.instanceId)!;
      instance.cooldownUntil = cooldown.until;
    }
    this.publishTemporaryUtilities(playerId);
    this.options.network.loadout.publishUtilityCooldownUntil(playerId, cooldown.until, utilityId);
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

    this.hostFrameNowMs = hostNowMs;
    const source = this.resolveSource(playerId, toolRef, temporaryUtilityInstanceId);
    if (!source || source.utility.config.activation.type !== kind) return false;
    if (source.utility.config.type === 'time_bubble' && this.timeBubbleBlocked(playerId, hostNowMs)) return false;
    if (!source.temporary && source.utility.config.charges) {
      const state = this.getChargeStock(playerId, source.utility.config, hostNowMs);
      if (!state.stock.canConsume(hostNowMs) || state.lockoutUntil > hostNowMs) return false;
    }
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
      attemptId: params?.attemptId,
    }, true);
  }

  execute(request: PlayerUtilityActionRequest, inspector = false): LoadoutUseResult {
    this.hostFrameNowMs = request.hostNowMs;
    if (this.destroyed) return { ok: false, reason: 'invalid' };
    if (!isValidPlayerActionAttemptId(request.attemptId)) {
      return { ok: false, reason: 'invalid' };
    }
    const attemptKey = request.attemptId === undefined ? null : request.attemptId;
    if (attemptKey) {
      const previous = this.committedAttempts.get(request.playerId)?.get(attemptKey);
      if (previous) return previous;
    }

    if (request.params?.translocatorUseId !== undefined) return this.followupTranslocator(request);
    if (request.params?.timeBubbleCollapseId !== undefined) return this.collapseTimeBubble(request);
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
    if (cfg.type === 'translocator') {
      const state = this.options.translocator?.getUseState(request.playerId);
      if (state?.phase === 'cooldown' && state.cooldownUntil > request.hostNowMs) return { ok: false, reason: 'cooldown' };
      if (state?.phase === 'puck' || state?.phase === 'portals') return this.followupTranslocator({ ...request,
        params: { ...request.params, translocatorUseId: state.useId } });
    }
    if (cfg.id === 'STINK_CLOUD') {
      const reason = this.stinkCloudBlocked(request.playerId, request.hostNowMs);
      if (reason) return { ok: false, reason };
    }
    if (cfg.type === 'time_bubble') {
      const reason = this.timeBubbleBlocked(request.playerId, request.hostNowMs);
      if (reason) return { ok: false, reason };
      if (!this.timeBubblePort) return { ok: false, reason: 'blocked' };
    }
    if (cfg.type === 'decoy') {
      if ((this.decoyCooldowns.get(request.playerId)?.until ?? 0) > request.hostNowMs)
        return { ok: false, reason: 'cooldown' };
      if (this.options.decoy?.hasActiveDecoy(request.playerId)) return { ok: false, reason: 'blocked' };
    }
    if (source.temporary && (source.temporary.charges <= 0 || source.temporary.cooldownUntil > request.hostNowMs)) {
      return { ok: false, reason: source.temporary.cooldownUntil > request.hostNowMs ? 'cooldown' : 'invalid' };
    }
    const charges = !source.temporary && cfg.charges
      ? this.getChargeStock(request.playerId, cfg, request.hostNowMs) : null;
    if (charges ? !charges.stock.canConsume(request.hostNowMs) || charges.lockoutUntil > request.hostNowMs
      : cfg.id !== 'STINK_CLOUD' && cfg.type !== 'decoy' && cfg.type !== 'time_bubble' && cfg.type !== 'translocator' && !source.temporary && utility.isOnCooldown(request.hostNowMs)) {
      return { ok: false, reason: 'cooldown', ...(charges ? {
        utilityChargeState: this.publishChargeStock(request.playerId, charges, request.hostNowMs),
      } : {}) };
    }

    let authoritativeParams = source.temporary
      ? { ...request.params, temporaryUtilityInstanceId: source.temporary.instanceId }
      : request.params;
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
        ...authoritativeParams,
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
      PLAYER_SIZE,
      authoritativeParams,
    );
    if (!didUse) return { ok: false, reason: 'blocked' };
    if (cfg.id === 'STINK_CLOUD') {
      const state = this.stinkCloudUses.get(request.playerId)!;
      this.stinkCloudUses.set(request.playerId, { ...state, temporaryUtilityInstanceId: source.temporary?.instanceId });
      this.publishStinkCloudState(request.playerId);
    }
    if (cfg.type === 'time_bubble') {
      const state = this.timeBubbleUses.get(request.playerId)!;
      this.timeBubbleUses.set(request.playerId, { ...state, temporaryUtilityInstanceId: source.temporary?.instanceId });
      this.publishTimeBubbleState(request.playerId);
    }

    if (cfg.type !== 'decoy') this.options.decoy?.breakStealth(request.playerId, request.hostNowMs);
    else this.decoyCooldowns.set(request.playerId, { utilityId: cfg.id, until: request.hostNowMs + cfg.cooldown });

    if (source.temporary) {
      this.temporaryUtilities.recordSuccessfulUse(request.playerId, source.temporary.instanceId, request.hostNowMs,
        cfg.id !== 'STINK_CLOUD' && cfg.type !== 'time_bubble' && cfg.type !== 'translocator');
      this.publishTemporaryUtilities(request.playerId);
    } else if (charges) {
      charges.stock.consume(request.hostNowMs);
      charges.lockoutUntil = request.hostNowMs + cfg.charges!.burstLockoutMs;
      charges.lastCommittedAttemptId = request.attemptId;
      this.publishChargeStock(request.playerId, charges, request.hostNowMs);
    } else if (!cfg.skipCooldownPublish && cfg.id !== 'STINK_CLOUD' && cfg.type !== 'time_bubble' && cfg.type !== 'translocator') {
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
    const result: LoadoutUseResult = { ok: true, ...(charges ? {
      utilityChargeState: this.publishChargeStock(request.playerId, charges, request.hostNowMs),
    } : {}) };
    if (attemptKey) this.rememberCommittedAttempt(request.playerId, attemptKey, result);
    return result;
  }

  private rememberCommittedAttempt(playerId: string, attemptId: string, result: LoadoutUseResult): void {
    const history = this.committedAttempts.get(playerId) ?? new Map<string, LoadoutUseResult>();
    history.delete(attemptId);
    history.set(attemptId, result);
    while (history.size > MAX_RECENT_ATTEMPTS_PER_PLAYER) {
      const oldest = history.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      history.delete(oldest);
    }
    this.committedAttempts.set(playerId, history);
  }

  getTranslocatorMoveSpeedBonus(playerId: string, nowMs: number): number { return this.options.translocator?.getMoveSpeedBonus(playerId, nowMs) ?? 0; }
  getTranslocatorHpRegen(playerId: string, nowMs: number): number { return this.options.translocator?.getHpRegen(playerId, nowMs) ?? 0; }

  private followupTranslocator(request: PlayerUtilityActionRequest): LoadoutUseResult {
    const useId = request.params?.translocatorUseId;
    if (typeof useId !== 'string' || !useId.length || useId.length > 160) return { ok: false, reason: 'invalid' };
    if (!this.options.actor.canInteract(request.playerId) || !this.options.actor.isAlive(request.playerId)
      || this.options.actor.isUtilityBlocked(request.playerId)) return { ok: false, reason: 'blocked' };
    const outcome = this.options.translocator?.followup(request.playerId, useId, request.hostNowMs);
    if (!outcome || outcome === 'blocked') return { ok: false, reason: 'blocked' };
    this.options.heldAction.clearPlayer(request.playerId);
    this.options.decoy?.breakStealth(request.playerId, request.hostNowMs);
    const result: LoadoutUseResult = { ok: true };
    if (request.attemptId) this.rememberCommittedAttempt(request.playerId, request.attemptId, result);
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
      const baseConfig = explicit?.kind === 'tool'
        ? explicit.config
        : this.options.resolveToolUtilityConfig?.(toolRef);
      if (!baseConfig) return null;
      const config = explicit?.kind === 'tool' ? baseConfig : this.options.loadout.resolveUtilityConfig(playerId, baseConfig);
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
          const outcome = this.options.translocator?.handleUse(playerId, angle, targetX, targetY, now, params, cfg as TranslocatorUtilityConfig);
          return outcome !== undefined && outcome !== 'blocked';
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
    const effect = structuredClone(this.buildGrenadeEffect(cfg, playerColor));
    if (effect.type === 'smoke') Object.assign(effect, this.options.captureSmokeDamage(playerId, this.hostFrameNowMs));
    const clampedCharge = Math.max(0, Math.min(1, chargeFraction));
    const speed = cfg.activation.minThrowSpeed + (cfg.projectileSpeed - cfg.activation.minThrowSpeed) * clampedCharge;
    const projectileId = this.options.projectileSpawn.spawnProjectile({
      origin: { x, y, angle, gameplayMuzzleOrigin: muzzle },
      flight: {
        speed,
        size: cfg.projectileSize,
        lifetimeMs: cfg.fuseTime,
        maxBounces: cfg.maxBounces,
        isGrenade: true,
        collisionMode: cfg.type === 'explosive' ? 'sweep' : undefined,
        fuseTimeMs: cfg.fuseTime,
        drag: {
          frictionDelayMs: cfg.frictionDelayMs,
          airFrictionDecayPerSec: cfg.airFrictionDecayPerSec,
          bounceFrictionMultiplier: cfg.bounceFrictionMultiplier,
          stopSpeedThreshold: cfg.stopSpeedThreshold,
        },
      },
      provenance: createSingleOwnerProvenance(playerId, {
        weaponSourceId: cfg.id,
        sourceSlot: 'utility',
        allowTeamDamage: cfg.allowTeamDamage,
      }),
      interaction: {
        grenadeEffect: effect,
      },
      presentation: {
        color: cfg.projectileColor ?? playerColor,
        style: cfg.projectileStyle,
        grenadePreset: cfg.grenadeVisualPreset,
        shotAudioKey: cfg.shotAudio?.successKey,
      },
    });
    if (projectileId !== null && cfg.type === 'time_bubble') {
      this.timeBubbleUses.set(playerId, { phase: 'flying', projectileId, utilityId: cfg.id,
        cooldownDurationMs: cfg.cooldown, focusEnabled: (cfg.focusEnabled ?? 0) > 0 });
      this.options.network.loadout.publishUtilityCooldownUntil(playerId, 0, cfg.id);
    }
    return projectileId !== null;
  }

  private fireBfg(cfg: BfgUtilityConfig, x: number, y: number, angle: number, playerId: string, muzzle?: MuzzleOrigin): boolean {
    return this.options.projectileSpawn.spawnProjectile({
      origin: { x, y, angle, gameplayMuzzleOrigin: muzzle },
      flight: {
        speed: cfg.projectileSpeed,
        size: cfg.projectileSize,
        lifetimeMs: (cfg.range / cfg.projectileSpeed) * 1000,
        maxBounces: 0,
        isGrenade: false,
        collisionMode: 'overlap',
        remainingRangePx: cfg.range,
        isBfg: true,
      },
      provenance: createSingleOwnerProvenance(playerId, {
        weaponSourceId: cfg.id,
        allowTeamDamage: cfg.allowTeamDamage,
      }),
      interaction: {
        directHit: { damage: cfg.directDamage },
        proximityPulse: cfg.proximityPulse,
      },
      presentation: {
        color: COLORS.GREEN_2,
        style: 'bfg',
        shotAudioKey: cfg.shotAudio?.successKey,
      },
    }) !== null;
  }

  private activateStinkCloud(cfg: StinkCloudUtilityConfig, playerId: string, now: number): boolean {
    if (!this.options.stinkCloud) return false;
    const capture = cfg.plague ? this.options.captureSmokeDamage(playerId, now) : null;
    const cloudId = this.options.stinkCloud.hostActivate(
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
      cfg.plague ? { ownerId: playerId, config: { ...cfg.plague },
        damageMultiplier: (capture?.sourceDamageMultiplier ?? 1) * (capture?.sourceOutgoingDamage?.damageMultiplier ?? 1) } : undefined,
      cfg.id === 'STINK_CLOUD' ? 'player-primary' : 'enemy-aura',
    );
    if (cfg.id === 'STINK_CLOUD') {
      this.stinkCloudUses.set(playerId, { utilityId: 'STINK_CLOUD', phase: 'active', cloudId,
        activeUntil: now + cfg.cloudDuration, cooldownDurationMs: cfg.cooldown,
        moveSpeedBonus: cfg.plague?.combatMoveSpeedBonus ?? 0, damageReduction: cfg.plague?.combatDamageReduction ?? 0 });
    }
    return true;
  }

  private activateTaser(cfg: TaserUtilityConfig, playerId: string, x: number, y: number, angle: number, playerColor: number): boolean {
    const request: MeleeSwingRequest = {
      shooterId: playerId,
      x,
      y,
      angle,
      range: cfg.range,
      arcDegrees: cfg.hitArcDegrees,
      damage: cfg.damage,
      adrenalinGain: 0,
      sourceId: cfg.id,
      color: playerColor,
      rockDamageMult: cfg.rockDamageMult ?? 1,
      trainDamageMult: cfg.trainDamageMult ?? 1,
      baseDamageMult: cfg.baseDamageMult ?? 1,
      visualPreset: cfg.visualPreset,
      shotAudioKey: cfg.shotAudio?.successKey,
      hitHeal: 0,
      hitAdrenaline: 0,
      bloodEffectMultiplier: 1,
      damageTargets: undefined,
      chain: (cfg.chainCount ?? 0) > 0
        ? { count: cfg.chainCount ?? 0, radius: cfg.chainRadius ?? 0, damageFactor: cfg.chainDamageFactor ?? 0 }
        : undefined,
    };
    return this.options.combatSystem.resolveImmediateAttack({
      kind: 'melee',
      payload: request,
      origin: { x, y },
      aim: { x: Math.cos(angle), y: Math.sin(angle) },
      range: cfg.range,
    }).accepted;
  }

  private buildGrenadeEffect(cfg: UtilityConfig, playerColor?: number) {
    if (cfg.type === 'explosive') {
      return { type: 'damage' as const, role: 'primary' as const, radius: cfg.aoeRadius, damage: cfg.aoeDamage,
        damageFalloff: cfg.damageFalloff, allowTeamDamage: cfg.allowTeamDamage, rockDamageMult: cfg.rockDamageMult,
        trainDamageMult: cfg.trainDamageMult, baseDamageMult: cfg.baseDamageMult, visualStyle: cfg.explosionVisualStyle,
        clusterCount: cfg.clusterCount, clusterRadiusFactor: cfg.clusterRadiusFactor, clusterDamageFactor: cfg.clusterDamageFactor,
        impactFuse: (cfg.impactFuseEnabled ?? 0) > 0, demolitionLevel: cfg.demolitionLevel,
        fragmentation: cfg.fragmentation, throwSpeed: cfg.projectileSpeed };
    }
    if (cfg.type === 'molotov') {
      return resolveMolotovFireEffect(cfg);
    }
    if (cfg.type === 'smoke') {
      return { type: 'smoke' as const, behavior: cfg.smokeBehavior, radius: cfg.smokeRadius, spreadDuration: cfg.smokeExpandDuration, lingerDuration: cfg.smokeLingerDuration, dissipateDuration: cfg.smokeDissipateDuration, maxAlpha: cfg.smokeMaxAlpha, dotDamagePerTick: cfg.smokeDotDamagePerTick, dotTickIntervalMs: cfg.smokeDotTickIntervalMs };
    }
    if (cfg.type === 'time_bubble') {
      return { type: 'time_bubble' as const, radius: cfg.bubbleRadius, duration: cfg.bubbleDuration, projectileSlowFactor: cfg.projectileSlowFactor, playerSlowFactor: cfg.playerSlowFactor, trainSlowFactor: cfg.trainSlowFactor, color: cfg.bubbleColor ?? cfg.projectileColor ?? playerColor, distortion: cfg.bubbleDistortion, resonanceRegenPerDamage: cfg.resonanceRegenPerDamage,
        prismEmitter: resolveTimeBubblePrismEmitter(cfg.prismEmitter), chargeCapacity: cfg.chargeCapacity };
    }
    return { type: 'damage' as const, radius: 0, damage: 0 };
  }

  private publishTemporaryUtilities(playerId: string): void {
    this.options.network.loadout.publishTemporaryUtilityInstances(
      playerId,
      this.temporaryUtilities.getDescriptors(playerId),
    );
  }

  /** Called from the world player tick, including when the utility is not currently selected. */
  update(now: number): void {
    this.hostFrameNowMs = now;
    for (const [playerId, state] of this.stinkCloudUses) {
      if (state.phase === 'active' && !this.options.actor.isAlive(playerId)) this.options.stinkCloud?.hostDeactivateForPlayer(playerId, now);
      if (state.phase === 'cooldown' && state.cooldownUntil <= now) { this.stinkCloudUses.delete(playerId); this.publishStinkCloudState(playerId); }
    }
    for (const [playerId, state] of this.timeBubbleUses) {
      if (state.phase === 'cooldown' && state.cooldownUntil <= now) {
        this.timeBubbleUses.delete(playerId);
        this.publishTimeBubbleState(playerId);
      }
    }
    for (const [playerId, stocks] of this.chargeStocks) {
      for (const entry of stocks.values()) {
        const base = UTILITY_CONFIGS[entry.config.id];
        const config = base ? this.options.loadout.resolveUtilityConfig(playerId, base) : entry.config;
        this.getChargeStock(playerId, config, now);
      }
    }
  }

  private getChargeStock(playerId: string, config: UtilityConfig, now: number): UtilityChargeStock {
    const stocks = this.chargeStocks.get(playerId) ?? new Map<string, UtilityChargeStock>();
    this.chargeStocks.set(playerId, stocks);
    const chargeConfig = { maxCharges: config.charges!.maxCharges, rechargeIntervalMs: config.cooldown,
      rechargeMode: 'preserve-progress' as const };
    let entry = stocks.get(config.id);
    if (!entry) {
      entry = { config, stock: new RechargeableCharges(chargeConfig, now), lockoutUntil: 0, revision: 0 };
      stocks.set(config.id, entry);
    } else if (entry.config !== config) {
      entry.stock.reconfigure(chargeConfig, now);
      entry.config = config;
    }
    this.publishChargeStock(playerId, entry, now);
    return entry;
  }

  private publishChargeStock(playerId: string, entry: UtilityChargeStock, now: number): UtilityChargeState {
    const snapshot = entry.stock.getSnapshot(now);
    const old = entry.published;
    if (old && old.availableCharges === snapshot.availableCharges && old.maxCharges === snapshot.maxCharges
      && old.nextChargeAt === snapshot.nextChargeAt && old.rechargeIntervalMs === snapshot.rechargeIntervalMs
      && old.lockoutUntil === entry.lockoutUntil && old.lastCommittedAttemptId === entry.lastCommittedAttemptId) return old;
    const state: UtilityChargeState = { ...snapshot, utilityId: entry.config.id, revision: ++entry.revision,
      lockoutUntil: entry.lockoutUntil, lastCommittedAttemptId: entry.lastCommittedAttemptId };
    entry.published = state;
    this.options.network.loadout.publishUtilityChargeState?.(playerId, entry.config.id, state);
    this.options.network.loadout.publishUtilityCooldownUntil(playerId, getUtilityChargeReadyAt(state), entry.config.id);
    return state;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.options.stinkCloud?.setPrimaryCloudEndHandler(null);
    for (const playerId of this.stinkCloudUses.keys()) {
      this.options.stinkCloud?.hostDeactivateForPlayer(playerId, this.hostFrameNowMs);
      this.stinkCloudUses.delete(playerId); this.publishStinkCloudState(playerId);
    }
    for (const playerId of this.timeBubbleUses.keys()) this.clearTimeBubbleUse(playerId);
    this.timeBubblePort = null;
    for (const [playerId, stocks] of this.chargeStocks) {
      for (const id of stocks.keys()) this.options.network.loadout.publishUtilityChargeState?.(playerId, id, null);
    }
    this.chargeStocks.clear();
    for (const playerId of this.equippedUtilities.keys()) this.publishTemporaryUtilities(playerId);
    this.equippedUtilities.clear();
    this.inspectorUtilities.clear();
    this.decoyCooldowns.clear();
    this.committedAttempts.clear();
  }
}
