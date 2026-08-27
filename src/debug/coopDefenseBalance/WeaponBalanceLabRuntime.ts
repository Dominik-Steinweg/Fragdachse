import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, GRID_ROWS } from '../../config';
import { DEFAULT_COOP_DEFENSE_CLASS_ID } from '../../config/coopDefenseClasses';
import { isWeaponBalanceLabMapId } from '../../config/coopDefenseMaps';
import type { ArenaContext } from '../../scenes/arena/ArenaContext';
import type { CombatDamageObservation } from '../../systems/CombatSystem';
import type { GamePhase, LoadoutCommitSnapshot, WeaponSlot } from '../../types';
import {
  COOP_DEFENSE_UPGRADE_DEFINITIONS,
  getCoopDefenseUpgradeLoadoutSelection,
  sanitizeCoopDefenseUpgradeProfile,
} from '../../utils/coopDefenseUpgrades';
import { DEFAULT_LOADOUT, ULTIMATE_CONFIGS, UTILITY_CONFIGS, WEAPON_CONFIGS } from '../../loadout/LoadoutConfig';
import { resolveLoadoutSelectionIds } from '../../loadout/LoadoutRules';
import { bridge } from '../../network/bridge';
import { toMapId } from '../../world/arenaDescriptorAdapter';
import type {
  RuntimeBenchmarkRequest,
  RuntimeBenchmarkResult,
} from './runtimeBenchmarkTypes';

const TARGET_HP = 1_000_000_000;
const PLAYER_GRID_X = 30;
const TARGET_Y_OFFSETS = [-120, -60, 0, 60, 120] as const;

export interface NeutralWeaponBenchmarkCommit {
  readonly commit: LoadoutCommitSnapshot;
  readonly weaponId: string;
  readonly upgradeLevels: Readonly<Record<string, number>>;
  readonly buildSignature: string;
}

/** Entfernt Klassen-, Item- und allgemeine Upgrades, behaelt aber den gewaehlten Waffenast. */
export function buildNeutralWeaponBenchmarkCommit(
  source: LoadoutCommitSnapshot,
  slot: WeaponSlot,
): NeutralWeaponBenchmarkCommit {
  const weaponId = slot === 'weapon1' ? source.weapon1 : source.weapon2;
  if (!weaponId || !WEAPON_CONFIGS[weaponId as keyof typeof WEAPON_CONFIGS]) {
    throw new Error(`Der Slot ${slot} enthält keine messbare Waffe.`);
  }

  const sourceUpgrades = source.coopDefenseProfile?.upgrades ?? {};
  const upgrades: Record<string, { unlocked: boolean; level: number }> = {};
  for (const definition of Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS)) {
    const target = getCoopDefenseUpgradeLoadoutSelection(definition.id);
    if (target?.slot !== slot || target.itemId !== weaponId) continue;
    const level = sourceUpgrades[definition.id]?.level ?? definition.startingLevel;
    if (level <= 0) continue;
    upgrades[definition.id] = { unlocked: true, level };
  }

  const profile = sanitizeCoopDefenseUpgradeProfile(
    { upgrades },
    DEFAULT_COOP_DEFENSE_CLASS_ID,
  );
  const commit = resolveLoadoutSelectionIds({
    weapon1: slot === 'weapon1'
      ? WEAPON_CONFIGS[weaponId as keyof typeof WEAPON_CONFIGS]
      : DEFAULT_LOADOUT.weapon1,
    weapon2: slot === 'weapon2'
      ? WEAPON_CONFIGS[weaponId as keyof typeof WEAPON_CONFIGS]
      : DEFAULT_LOADOUT.weapon2,
    utility: UTILITY_CONFIGS[DEFAULT_LOADOUT.utility.id as keyof typeof UTILITY_CONFIGS],
    ultimate: ULTIMATE_CONFIGS[DEFAULT_LOADOUT.ultimate.id as keyof typeof ULTIMATE_CONFIGS],
  }, 'coop_defense', profile, null);

  const committedWeaponId = slot === 'weapon1' ? commit.weapon1 : commit.weapon2;
  if (committedWeaponId !== weaponId) {
    throw new Error(`${weaponId} ist ohne Klassen- oder allgemeine Upgrades nicht erreichbar.`);
  }

  const upgradeLevels = Object.fromEntries(
    Object.entries(profile.upgrades)
      .filter(([upgradeId, state]) => {
        const target = getCoopDefenseUpgradeLoadoutSelection(upgradeId);
        return state.level > 0 && target?.slot === slot && target.itemId === weaponId;
      })
      .map(([upgradeId, state]) => [upgradeId, state.level]),
  );
  const buildSignature = Object.entries(upgradeLevels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([upgradeId, level]) => `${upgradeId}:${level}`)
    .join('|') || 'base';

  return {
    commit: { ...commit, coopDefenseClassId: null, equippedItems: [], tools: [] },
    weaponId,
    upgradeLevels,
    buildSignature,
  };
}

interface ArmedRun {
  readonly request: RuntimeBenchmarkRequest;
  readonly build: NeutralWeaponBenchmarkCommit;
}

export class WeaponBalanceLabRuntime {
  private armed: ArmedRun | null = null;
  private running = false;
  private elapsedMs = 0;
  private shotsFired = 0;
  private hitEvents = 0;
  private criticalEvents = 0;
  private totalDamage = 0;
  private tailDamage = 0;
  private adrenalineGenerated = 0;
  private adrenalineConsumed = 0;
  private readonly damageByKind: Record<string, number> = {};
  private readonly damagedTargetIds = new Set<string>();
  private readonly targetPositions = new Map<string, { x: number; y: number }>();
  private removeDamageObserver: (() => void) | null = null;
  private removeAdrenalineObserver: (() => void) | null = null;
  private removeAdrenalineGainObserver: (() => void) | null = null;
  private shotSequence = 1;
  private hasFired = false;

  constructor(
    private readonly getContext: () => ArenaContext,
    private readonly onResult: (result: RuntimeBenchmarkResult) => void,
    private readonly onFinished: () => void,
  ) {}

  arm(request: RuntimeBenchmarkRequest, build: NeutralWeaponBenchmarkCommit): void {
    this.cancel();
    this.armed = { request, build };
  }

  isActive(): boolean {
    return this.armed !== null || this.running;
  }

  isRunning(): boolean {
    return this.running;
  }

  cancel(): void {
    this.removeDamageObserver?.();
    this.removeAdrenalineObserver?.();
    this.removeAdrenalineGainObserver?.();
    this.removeDamageObserver = null;
    this.removeAdrenalineObserver = null;
    this.removeAdrenalineGainObserver = null;
    this.armed = null;
    this.running = false;
    this.targetPositions.clear();
    this.elapsedMs = 0;
    this.shotsFired = 0;
    this.hitEvents = 0;
    this.criticalEvents = 0;
    this.totalDamage = 0;
    this.tailDamage = 0;
    this.adrenalineGenerated = 0;
    this.adrenalineConsumed = 0;
    this.shotSequence = 1;
    this.hasFired = false;
    this.damagedTargetIds.clear();
    for (const key of Object.keys(this.damageByKind)) delete this.damageByKind[key];
  }

  update(phase: GamePhase, gameplayActive: boolean, deltaMs: number): void {
    if (!this.armed) return;
    const mapId = toMapId(bridge.getWorldDescriptor()?.definitionId ?? '') ?? bridge.getCoopDefenseMapId();
    if (phase !== 'ARENA' || !isWeaponBalanceLabMapId(mapId)) return;
    if (!gameplayActive) return;
    if (!this.running && !this.beginRun()) return;

    const active = this.armed;
    if (!active) return;
    this.elapsedMs += Math.max(0, deltaMs);
    this.pinParticipants();

    const measurementEndMs = active.request.warmupMs + active.request.measurementMs;
    if (this.elapsedMs < measurementEndMs) this.tryFire();
    if (this.elapsedMs >= measurementEndMs + active.request.settleMs) this.finishRun();
  }

  private beginRun(): boolean {
    const active = this.armed;
    if (!active || !bridge.isHost()) return false;
    const ctx = this.getContext();
    const playerId = bridge.getLocalPlayerId();
    const player = ctx.playerManager.getPlayer(playerId);
    if (!player || !ctx.loadoutManager || !ctx.resourceSystem || !ctx.enemyManager) return false;

    const playerX = ARENA_OFFSET_X + PLAYER_GRID_X * CELL_SIZE + CELL_SIZE * 0.5;
    const playerY = ARENA_OFFSET_Y + Math.floor(GRID_ROWS / 2) * CELL_SIZE + CELL_SIZE * 0.5;
    player.setPosition(playerX, playerY);
    player.body.setVelocity(0, 0);

    const offsets = active.request.scenario === 'five_target' ? TARGET_Y_OFFSETS : [0];
    for (const yOffset of offsets) {
      const x = playerX + active.request.distance;
      const y = playerY + yOffset;
      const enemy = ctx.enemyManager.hostSpawnAtWorld(x, y, 'zombie-badger', {
        originId: 'weapon-balance-lab',
      });
      enemy.setHp(TARGET_HP, TARGET_HP);
      enemy.setPosition(x, y);
      enemy.body.setVelocity(0, 0);
      this.targetPositions.set(enemy.id, { x, y });
    }

    this.removeDamageObserver = ctx.combatSystem.addDamageDealtObserver((event) => {
      this.recordDamage(event);
    });
    this.removeAdrenalineObserver = ctx.resourceSystem.addAdrenalineDrainObserver(
      (observedPlayerId, _requested, drained) => {
        if (observedPlayerId !== playerId || !this.isInMeasurementWindow()) return;
        this.adrenalineConsumed += Math.max(0, drained);
      },
    );
    this.removeAdrenalineGainObserver = ctx.resourceSystem.addAdrenalineGainObserver(
      (observedPlayerId, _requested, gained) => {
        if (observedPlayerId !== playerId || !this.isInMeasurementWindow()) return;
        this.adrenalineGenerated += Math.max(0, gained);
      },
    );
    this.running = true;
    return true;
  }

  private pinParticipants(): void {
    const ctx = this.getContext();
    const active = this.armed;
    if (!active) return;
    const player = ctx.playerManager.getPlayer(bridge.getLocalPlayerId());
    const playerX = ARENA_OFFSET_X + PLAYER_GRID_X * CELL_SIZE + CELL_SIZE * 0.5;
    const playerY = ARENA_OFFSET_Y + Math.floor(GRID_ROWS / 2) * CELL_SIZE + CELL_SIZE * 0.5;
    player?.setPosition(playerX, playerY);
    player?.body.setVelocity(0, 0);
    for (const [enemyId, position] of this.targetPositions) {
      const enemy = ctx.enemyManager?.getEnemy(enemyId);
      if (!enemy) continue;
      enemy.setPosition(position.x, position.y);
      enemy.body.setVelocity(0, 0);
    }
    // W2 bleibt praktisch unbegrenzt; der echte Drain wird vor dem Auffuellen beobachtet.
    // W1 startet jeden Frame leer, damit echte Treffer-Gutschriften nicht am Maximum verpuffen.
    // setAdrenaline selbst ist kein Gain-Event und landet daher nicht in der Telemetrie.
    const resources = ctx.resourceSystem;
    if (resources) {
      const playerId = bridge.getLocalPlayerId();
      resources.setAdrenaline(
        playerId,
        active.request.slot === 'weapon2' ? resources.getMaxAdrenaline(playerId) : 0,
      );
    }
  }

  private tryFire(): void {
    const active = this.armed;
    const ctx = this.getContext();
    const playerId = bridge.getLocalPlayerId();
    const player = ctx.playerManager.getPlayer(playerId);
    const target = [...this.targetPositions.values()][Math.floor(this.targetPositions.size / 2)];
    if (!active || !player || !target || !ctx.loadoutManager) return;
    const angle = Math.atan2(target.y - player.y, target.x - player.x);
    const result = ctx.loadoutManager.use(
      active.request.slot,
      playerId,
      angle,
      target.x,
      target.y,
      Date.now(),
      this.shotSequence++,
      { inputStarted: !this.hasFired },
      player.x,
      player.y,
    );
    if (result.ok) {
      this.hasFired = true;
      if (this.isInMeasurementWindow()) this.shotsFired += 1;
    }
  }

  private recordDamage(event: CombatDamageObservation): void {
    const active = this.armed;
    if (!active || event.attackerId !== bridge.getLocalPlayerId()) return;
    if (!this.targetPositions.has(event.targetId)) return;
    const measurementStartMs = active.request.warmupMs;
    const measurementEndMs = measurementStartMs + active.request.measurementMs;
    if (this.elapsedMs >= measurementStartMs && this.elapsedMs < measurementEndMs) {
      this.totalDamage += event.damage;
      this.hitEvents += 1;
      if (event.isCritical) this.criticalEvents += 1;
      this.damageByKind[event.damageKind] = (this.damageByKind[event.damageKind] ?? 0) + event.damage;
      this.damagedTargetIds.add(event.targetId);
    } else if (this.elapsedMs >= measurementEndMs
      && this.elapsedMs < measurementEndMs + active.request.settleMs) {
      this.tailDamage += event.damage;
    }
  }

  private isInMeasurementWindow(): boolean {
    const request = this.armed?.request;
    return !!request
      && this.elapsedMs >= request.warmupMs
      && this.elapsedMs < request.warmupMs + request.measurementMs;
  }

  private finishRun(): void {
    const active = this.armed;
    if (!active) return;
    const ctx = this.getContext();
    const playerId = bridge.getLocalPlayerId();
    const activeOwnedProjectilesAtEnd = [...ctx.projectileManager.getActiveProjectiles()]
      .filter((projectile) => projectile.ownerId === playerId)
      .length;
    let activeBurnSourcesAtEnd = 0;
    for (const targetId of this.targetPositions.keys()) {
      activeBurnSourcesAtEnd += ctx.combatSystem.getActiveBurnSources(targetId)
        .filter((source) => source.attackerId === playerId)
        .length;
    }
    const result: RuntimeBenchmarkResult = {
      schemaVersion: 1,
      runId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date().toISOString(),
      weaponId: active.build.weaponId,
      slot: active.request.slot,
      scenario: active.request.scenario,
      targetCount: this.targetPositions.size,
      distance: active.request.distance,
      warmupMs: active.request.warmupMs,
      measurementMs: active.request.measurementMs,
      settleMs: active.request.settleMs,
      upgradeLevels: active.build.upgradeLevels,
      buildSignature: active.build.buildSignature,
      shotsFired: this.shotsFired,
      damagingHitEvents: this.hitEvents,
      criticalDamageEvents: this.criticalEvents,
      targetsDamaged: this.damagedTargetIds.size,
      totalDamage: this.totalDamage,
      dps: this.totalDamage / Math.max(0.001, active.request.measurementMs / 1000),
      damageByKind: { ...this.damageByKind },
      tailDamage: this.tailDamage,
      adrenalineGenerated: this.adrenalineGenerated,
      adrenalineGeneratedPerSecond: this.adrenalineGenerated / Math.max(0.001, active.request.measurementMs / 1000),
      adrenalineConsumed: this.adrenalineConsumed,
      adrenalinePerSecond: this.adrenalineConsumed / Math.max(0.001, active.request.measurementMs / 1000),
      tailStatus: activeOwnedProjectilesAtEnd > 0 || activeBurnSourcesAtEnd > 0
        ? 'truncated'
        : 'complete',
      activeOwnedProjectilesAtEnd,
      activeBurnSourcesAtEnd,
    };
    this.removeDamageObserver?.();
    this.removeAdrenalineObserver?.();
    this.removeAdrenalineGainObserver?.();
    this.removeDamageObserver = null;
    this.removeAdrenalineObserver = null;
    this.removeAdrenalineGainObserver = null;
    this.running = false;
    this.armed = null;
    this.onResult(result);
    this.onFinished();
  }
}
