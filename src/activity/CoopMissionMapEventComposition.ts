import type { ArenaLayout } from '../types';
import type { BaseSpec } from '../arena/BaseRegistry';
import { getBaseWorldBounds } from '../arena/BaseRegistry';
import type { CoopMissionActivityConfiguration } from './CoopMissionActivityConfig';
import type { CoopMissionRuntime } from './CoopMissionRuntime';
import { CoopDefenseMapEventDirector, type CoopDefenseMapEventHandler } from '../systems/CoopDefenseMapEventDirector';
import {
  COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID,
  CoopDefenseAirstrikeEventHandler,
  isPointNearBaseRegion,
} from '../systems/CoopDefenseAirstrikeEventHandler';
import { CoopDefenseGroundHazardEventHandler } from '../systems/CoopDefenseGroundHazardEventHandler';
import type { AirstrikeSystem, AirstrikeStrikeResolution } from '../systems/AirstrikeSystem';
import type { BaseManager } from '../entities/BaseManager';
import type { CombatSystem } from '../systems/CombatSystem';
import type { PlayerManager } from '../entities/PlayerManager';
import type { FireSystem } from '../effects/FireSystem';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { CoopTrainPort } from './CoopTrainPort';

export interface CoopMissionMapEventCompositionOptions {
  readonly activity: CoopMissionActivityConfiguration;
  readonly layout: ArenaLayout;
  readonly worldMetrics: WorldMetrics;
  readonly worldBases: readonly BaseSpec[];
  readonly playerManager: PlayerManager;
  readonly combatSystem: CombatSystem;
  readonly baseManager: BaseManager | null;
  readonly fireSystem: FireSystem;
  readonly airstrikeSystem: AirstrikeSystem;
  readonly gameAudioSystem: GameAudioSystem;
  readonly train: CoopTrainPort;
  readonly getNowMs: () => number;
}

/** Owns authored train, airstrike and ground-hazard handlers for one Coop Activity. */
export class CoopMissionMapEventComposition {
  constructor(private readonly options: CoopMissionMapEventCompositionOptions) {}

  materialize(runtime: CoopMissionRuntime): void {
    const events = this.options.activity.mapConfig.mapEvents ?? [];
    if (events.length === 0) {
      this.options.train.releaseActivityTrain();
      this.options.train.clearTrainEvent();
      return;
    }

    const authoredAirstrikeEventIds = new Set(
      events.filter((event) => event.type === 'airstrike').map((event) => event.id),
    );

    const handlers: CoopDefenseMapEventHandler[] = [];
    const trackCell = this.options.layout.tracks?.[0];
    if (trackCell !== undefined && events.some((event) => event.type === 'train')) {
      const direction: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      handlers.push(this.options.train.materializeAuthoredTrain(trackCell.gridX, direction));
    }

    let airstrikeHandler: CoopDefenseAirstrikeEventHandler | null = null;
    if (events.some((event) => event.type === 'airstrike')) {
      airstrikeHandler = new CoopDefenseAirstrikeEventHandler({
        scheduleStrike: (x, y, cfg, metadata, armedAt) => this.options.airstrikeSystem.scheduleStrike(
          COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID,
          x,
          y,
          cfg,
          armedAt,
          metadata,
        ),
        getAlivePlayerPositions: () => this.options.playerManager.getAllPlayers()
          .filter((player) => this.options.combatSystem.isAlive(player.id))
          .map((player) => ({ x: player.x, y: player.y })),
        isProtectedBasePoint: (x, y) => isPointNearBaseRegion(
          x,
          y,
          this.options.worldBases.map((base) => getBaseWorldBounds(base.region, this.options.worldMetrics)),
        ),
        playStrikeAudio: (x, y) => {
          this.options.gameAudioSystem.playSound('sfx_airstrike_countdown', x, y);
        },
        arenaWidthCells: this.options.worldMetrics.gridCols,
        arenaHeightCells: this.options.worldMetrics.gridRows,
        worldMetrics: this.options.worldMetrics,
        tutorialShowControls: this.options.activity.mapConfig.tutorialShowControls,
        getNowMs: this.options.getNowMs,
      });
      handlers.push(airstrikeHandler);
    }

    if (events.some((event) => event.type === 'ground-hazard')) {
      handlers.push(new CoopDefenseGroundHazardEventHandler({
        fireSystem: this.options.fireSystem,
        prebuiltZones: this.options.layout.groundHazardZones ?? [],
        getNowMs: this.options.getNowMs,
        worldMetrics: this.options.worldMetrics,
      }));
    }

    const director = new CoopDefenseMapEventDirector(events, handlers, {
      isTriggerSatisfied: (start) => start.type === 'after-checkpoint'
        ? (runtime.coopDefenseMissionProgressSystem?.isCheckpointActivated(start.checkpointId) ?? false)
        : start.type === 'after-encounter'
          ? (runtime.coopDefenseMapDirector?.isEncounterCleared(start.encounterId) ?? false)
          : start.type === 'after-event'
            ? (runtime.coopDefenseMapEventDirector?.isEventCompleted(start.eventId) ?? false)
            : start.type === 'boss-phase'
              ? (runtime.coopDefenseVoidHunterSystem?.hasReachedPhase(start.phase) ?? false)
              : start.type === 'base-destroyed'
                ? (this.options.baseManager?.getBase(start.baseId)?.isDestroyed() ?? false)
                : false,
    });
    runtime.setMapEventDirector(director);
    runtime.bind({
      attach: () => {
        this.options.airstrikeSystem.setResolvedCallback((resolution: AirstrikeStrikeResolution) => {
          airstrikeHandler?.handleStrikeResolved(resolution);
        });
      },
      detach: () => {
        this.options.airstrikeSystem.setResolvedCallback(null);
        this.options.airstrikeSystem.clearAuthoredActivityStrikes(authoredAirstrikeEventIds);
        this.options.train.releaseActivityTrain();
      },
    });
  }
}
