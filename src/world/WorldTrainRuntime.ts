import * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import { TRAIN_DROP_COUNT } from '../powerups/PowerUpConfig';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import type { CombatSystem } from '../systems/CombatSystem';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { HostPhysicsSystem } from '../systems/HostPhysicsSystem';
import type { TimeBubbleSystem } from '../systems/TimeBubbleSystem';
import type { PowerUpSystem } from '../powerups/PowerUpSystem';
import type { CoopDefenseMapEventHandler } from '../systems/CoopDefenseMapEventDirector';
import type { WorldMetrics } from './WorldMetrics';
import type { WorldScopedBinding } from './WorldRuntime';
import { TrainManager, type TrainDestroyResult } from '../train/TrainManager';
import { TrainRenderer } from '../train/TrainRenderer';
import { TRAIN } from '../train/TrainConfig';
import { CoopDefenseTrainEventHandler, type TrainEventReplicationPort } from '../train/CoopDefenseTrainEventHandler';
import { getClassicTrainEventPlan, getNextClassicTrainArrivalAt, type TrainEventPlan } from '../train/TrainEvent';
import type { CoopTrainPort } from '../activity/CoopTrainPort';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { ExplosionVisualStyle, PlayerProfile, TrainEventConfig } from '../types';

export interface WorldTrainKillEvent {
  readonly killerId: string;
  readonly killerName: string;
  readonly killerColor: number;
  readonly sourceId: string;
  readonly victimId: string;
  readonly victimName: string;
  readonly victimColor: number;
}

/** Small fachliche network ports used by the World-owned train. */
export interface WorldTrainNetworkPort {
  readonly clock: {
    readonly getArenaStartTime: () => number;
    readonly now: () => number;
  };
  /** Derselbe Port versorgt den klassischen Zug und den authored Activity-Zug. */
  readonly trainEvents: TrainEventReplicationPort & {
    readonly isHost: () => boolean;
    readonly get: () => TrainEventConfig | undefined;
  };
  readonly matchEvents: {
    readonly addPlayerFrags: (playerId: string, amount: number) => void;
    readonly getConnectedPlayers: () => readonly PlayerProfile[];
    readonly broadcastKillEvent: (event: WorldTrainKillEvent) => void;
    readonly broadcastTrainDestroyed: () => void;
  };
  readonly effects: {
    readonly broadcastTrainBurrowSparks: (x: number, y: number) => void;
    readonly broadcastExplosionEffect: (
      x: number,
      y: number,
      radius: number,
      color?: number,
      visualStyle?: ExplosionVisualStyle,
    ) => void;
  };
}

export interface WorldTrainRuntimeOptions {
  readonly scene: Phaser.Scene;
  readonly playerManager: PlayerManager;
  readonly projectileManager: ProjectileManager;
  readonly combatSystem: CombatSystem;
  readonly hostPhysics: HostPhysicsSystem;
  readonly worldMetrics: WorldMetrics;
  readonly presentationRequired: boolean;
  readonly gameAudioSystem: GameAudioSystem;
  readonly network: WorldTrainNetworkPort;
  readonly getEnemyManager: () => EnemyManager | null;
  readonly isPlayerBurrowed: (playerId: string) => boolean;
  readonly getTimeBubbleSystem: () => TimeBubbleSystem | null;
  readonly setTranslocatorTrainManager: (train: TrainManager | null) => void;
  readonly getPowerUpSystem: () => PowerUpSystem | null;
  readonly setClassicTrainSpawned: (spawned: boolean) => void;
  readonly onRendererChanged: (renderer: TrainRenderer | null) => void;
}

/** World owner for the classic train and the Activity-owned authored train child. */
export class WorldTrainRuntime implements WorldScopedBinding, CoopTrainPort {
  private classicTrain: TrainManager | null = null;
  private activityTrain: TrainManager | null = null;
  private activityHandler: CoopDefenseTrainEventHandler | null = null;
  private pendingClassic: { readonly trackX: number; readonly direction: 1 | -1; readonly plan: TrainEventPlan } | null = null;
  private classicRoundStart = 0;
  private explosionTimers: Phaser.Time.TimerEvent[] = [];
  private renderer: TrainRenderer | null = null;
  private destroyed = false;

  constructor(private readonly options: WorldTrainRuntimeOptions) {
    if (options.presentationRequired) {
      this.renderer = new TrainRenderer(options.scene);
      this.renderer.setAudioSystem(options.gameAudioSystem);
      options.onRendererChanged(this.renderer);
    }
  }

  setupClassicTrain(trackGridX: number): void {
    this.releaseActivityTrain();
    this.classicTrain?.destroy();
    const plan = getClassicTrainEventPlan();
    const trackX = getClassicTrainTrackX(trackGridX, this.options.worldMetrics);
    const direction: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    this.pendingClassic = { trackX, direction, plan };
    this.classicTrain = this.createTrain(trackX, direction, plan);
    this.options.setClassicTrainSpawned(false);
    this.publishClassicEventIfReady(this.options.network.clock.getArenaStartTime());
  }

  bindRoundStart(arenaStartTime: number): void {
    this.publishClassicEventIfReady(arenaStartTime);
  }

  materializeAuthoredTrain(trackGridX: number, direction: 1 | -1): CoopDefenseMapEventHandler {
    this.releaseActivityTrain();
    const trackX = getClassicTrainTrackX(trackGridX, this.options.worldMetrics);
    const train = this.createTrain(trackX, direction, null);
    this.activityTrain = train;
    this.activityHandler = new CoopDefenseTrainEventHandler(
      train,
      this.options.combatSystem,
      direction,
      this.options.network.trainEvents,
    );
    return this.activityHandler;
  }

  getCurrentTrain(): TrainManager | null {
    return this.activityTrain ?? this.classicTrain;
  }

  applyDamage(amount: number, attackerId: string): void {
    this.getCurrentTrain()?.applyDamage(amount, attackerId);
  }

  getActiveSegmentPositions(): { x: number; y: number }[] {
    const train = this.getCurrentTrain();
    return train?.getNetSnapshot()?.alive ? train.getSegmentPositions() : [];
  }

  getCurrentTrainEvent() {
    return this.options.network.trainEvents.get();
  }

  releaseActivityTrain(): void {
    if (!this.activityTrain && !this.activityHandler) return;
    this.activityHandler?.reset();
    this.activityHandler = null;
    this.activityTrain?.destroy();
    this.activityTrain = null;
    if (this.classicTrain) {
      this.options.projectileManager.setTrainGroup(this.classicTrain.getGroup());
      this.options.projectileManager.setTrainHitCallback((damage, attackerId) => {
        this.classicTrain?.applyDamage(damage, attackerId);
      });
      this.options.setTranslocatorTrainManager(this.classicTrain);
    } else {
      this.options.combatSystem.setTrainSegments(null);
      this.options.projectileManager.setTrainHitCallback(null);
      this.options.projectileManager.setTrainGroup(null);
      this.options.setTranslocatorTrainManager(null);
    }
  }

  clearTrainEvent(): void {
    this.options.network.trainEvents.clear();
  }

  setEnemyManager(manager: EnemyManager | null): void {
    this.classicTrain?.setEnemyManager(manager);
    this.activityTrain?.setEnemyManager(manager);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.releaseActivityTrain();
    this.classicTrain?.destroy();
    this.classicTrain = null;
    this.pendingClassic = null;
    this.options.combatSystem.setTrainSegments(null);
    this.options.projectileManager.setTrainHitCallback(null);
    this.options.projectileManager.setTrainGroup(null);
    this.options.setTranslocatorTrainManager(null);
    this.cancelExplosionTimers();
    this.renderer?.destroy();
    this.renderer = null;
    this.options.onRendererChanged(null);
  }

  private createTrain(trackX: number, direction: 1 | -1, classicPlan: TrainEventPlan | null): TrainManager {
    const train = new TrainManager(
      this.options.scene,
      this.options.playerManager,
      trackX,
      direction,
      this.options.worldMetrics,
    );
    train.setTimeBubbleSystem(this.options.getTimeBubbleSystem());
    train.setEnemyManager(this.options.getEnemyManager());
    this.options.setTranslocatorTrainManager(train);
    this.options.projectileManager.setTrainGroup(train.getGroup());
    this.options.projectileManager.setTrainHitCallback((damage, attackerId) => {
      this.getCurrentTrain()?.applyDamage(damage, attackerId);
    });
    train.setCanHitPlayerCallback((playerId) => !this.options.isPlayerBurrowed(playerId));
    train.setPlayerHitCallback((playerId, sourceX, sourceY) => {
      const recentPusherId = this.options.hostPhysics.getRecentImpulseSource(playerId);
      this.options.combatSystem.applyDamage(
        playerId,
        9999,
        true,
        recentPusherId ?? TRAIN.TRAIN_KILLER_ID,
        recentPusherId ? 'environment.train_push' : 'environment.train',
        { sourceX, sourceY },
      );
    });
    train.setEnemyHitCallback((enemyId, sourceX, sourceY) => {
      const enemy = this.options.getEnemyManager()?.getEnemy(enemyId);
      const collision = enemy ? getCoopDefenseEnemyConfig(enemy.kind).trainCollision : undefined;
      const isRevivedAlly = enemy?.faction === 'allied';
      const recentPusherId = this.options.hostPhysics.getRecentImpulseSource(enemyId);
      this.options.combatSystem.applyDamage(
        enemyId,
        isRevivedAlly ? Math.max(9999, enemy?.getHp() ?? 0) : (collision?.damageToEnemy ?? 9999),
        true,
        recentPusherId ?? TRAIN.TRAIN_KILLER_ID,
        recentPusherId ? 'environment.train_push' : 'environment.train',
        { sourceX, sourceY },
        { allowTeamDamage: isRevivedAlly },
      );
      return collision ? { destroysTrain: !isRevivedAlly && collision.destroysTrain } : undefined;
    });
    train.setIsPlayerBurrowedCallback((playerId) => this.options.isPlayerBurrowed(playerId));
    train.setOnBurrowDamageDealtCallback((_playerId, x, y) => {
      this.options.network.effects.broadcastTrainBurrowSparks(x, y);
    });
    train.setDestroyCallback((result) => this.handleDestroyed(result, this.options.worldMetrics));
    if (classicPlan) {
      train.setExitedCallback(() => {
        const event = this.options.network.trainEvents.get();
        if (!event) return;
        const spawnAt = getNextClassicTrainArrivalAt(this.options.network.clock.now(), classicPlan);
        const nextDirection: 1 | -1 = event.direction === 1 ? -1 : 1;
        this.options.network.trainEvents.publish({ trackX: event.trackX, direction: nextDirection, spawnAt });
        train.prepareReentry(nextDirection);
        this.options.setClassicTrainSpawned(false);
      });
    }
    return train;
  }

  private publishClassicEventIfReady(arenaStartTime: number): void {
    if (!this.pendingClassic || !this.options.network.trainEvents.isHost()
      || arenaStartTime <= 0 || this.classicRoundStart === arenaStartTime) return;
    this.classicRoundStart = arenaStartTime;
    const { trackX, direction, plan } = this.pendingClassic;
    this.options.network.trainEvents.publish({ trackX, direction, spawnAt: arenaStartTime + plan.firstArrivalDelayMs });
  }

  private handleDestroyed(result: TrainDestroyResult, worldMetrics: WorldMetrics): void {
    if (result.lastHitterId) {
      this.options.network.matchEvents.addPlayerFrags(result.lastHitterId, TRAIN.KILL_FRAGS);
      const hitter = this.options.network.matchEvents.getConnectedPlayers()
        .find((player) => player.id === result.lastHitterId);
      if (hitter) this.options.network.matchEvents.broadcastKillEvent({
        killerId: hitter.id,
        killerName: hitter.name,
        killerColor: hitter.colorHex,
        sourceId: 'environment.train',
        victimId: '__train__',
        victimName: 'RB 54',
        victimColor: 0xcf573c,
      });
    }
    let latestWagonDelay = 0;
    for (const segment of result.segmentPositions) {
      const delay = Math.round(Math.random() * TRAIN.EXPLOSION_WAGON_DELAY_MAX_MS);
      latestWagonDelay = Math.max(latestWagonDelay, delay);
      this.scheduleExplosion(segment.x, segment.y, 80, delay);
    }
    this.scheduleExplosion(
      result.centerX,
      result.centerY,
      160,
      latestWagonDelay + TRAIN.EXPLOSION_CENTER_DELAY_MS,
    );
    const validSegments = result.segmentPositions.filter((segment) => (
      segment.y >= worldMetrics.offsetY && segment.y <= worldMetrics.maxY
    ));
    const dropSegments = validSegments.length > 0 ? validSegments : result.segmentPositions;
    const powerUps = this.options.getPowerUpSystem();
    for (let index = 0; index < TRAIN_DROP_COUNT; index += 1) {
      const segment = dropSegments[Math.floor(index * dropSegments.length / TRAIN_DROP_COUNT)];
      if (!segment) continue;
      powerUps?.spawnFromTable('TRAIN_DESTROY', segment.x + (Math.random() - 0.5) * 28, segment.y + (Math.random() - 0.5) * 28);
    }
    this.options.network.matchEvents.broadcastTrainDestroyed();
  }

  private scheduleExplosion(x: number, y: number, radius: number, delayMs: number): void {
    let timer: Phaser.Time.TimerEvent;
    timer = this.options.scene.time.delayedCall(delayMs, () => {
      this.explosionTimers = this.explosionTimers.filter((candidate) => candidate !== timer);
      this.options.network.effects.broadcastExplosionEffect(x, y, radius, undefined, 'train');
    });
    this.explosionTimers.push(timer);
  }

  private cancelExplosionTimers(): void {
    for (const timer of this.explosionTimers) timer.remove();
    this.explosionTimers.length = 0;
  }
}

export function getClassicTrainTrackX(trackGridX: number, metrics: WorldMetrics): number {
  return metrics.offsetX + trackGridX * CELL_SIZE + CELL_SIZE;
}
