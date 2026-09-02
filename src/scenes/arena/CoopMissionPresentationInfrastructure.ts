import * as Phaser from 'phaser';
import type { CenterHUD } from '../../ui/CenterHUD';
import { CoopDefenseObjectiveAnnouncement } from '../../ui/CoopDefenseObjectiveAnnouncement';
import { CoopDefenseMapEventAnnouncementPresenter } from '../../ui/CoopDefenseMapEventAnnouncementPresenter';
import { CoopDefenseSecondaryObjectiveHud } from '../../ui/CoopDefenseSecondaryObjectiveHud';
import { HostileBaseIndicator } from '../../ui/HostileBaseIndicator';
import type { BaseManager } from '../../entities/BaseManager';
import type { EnemyManager } from '../../entities/EnemyManager';
import type { PlayerManager } from '../../entities/PlayerManager';
import type { ClientUpdateCoordinator } from './ClientUpdateCoordinator';
import type { RendererBundle } from './RendererBundle';
import type {
  CoopMissionPresentationUiPort,
} from '../../activity/CoopMissionPresentationBinding';

export interface CoopMissionPresentationInfrastructureInput {
  readonly centerHUD: CenterHUD;
  readonly playerManager: PlayerManager;
  readonly clientUpdate: ClientUpdateCoordinator;
  readonly renderers: RendererBundle;
  readonly getBaseManager: () => BaseManager | null;
  readonly getEnemyManager: () => EnemyManager | null;
}

/**
 * Scene-lifetime Phaser infrastructure for the Coop presentation port.
 *
 * The activity-scoped binding owns the presentation state and its lifetime. This owner only keeps
 * the reusable scene objects and their narrow UI port in one place, so the Scene does not know the
 * concrete Coop objective, map-event or world-space renderer list.
 */
export class CoopMissionPresentationInfrastructure {
  private readonly objectiveAnnouncements: CoopDefenseObjectiveAnnouncement;
  private readonly mapEventAnnouncementPresenter: CoopDefenseMapEventAnnouncementPresenter;
  private secondaryObjectiveHud: CoopDefenseSecondaryObjectiveHud | null = null;
  private hostileBaseIndicator: HostileBaseIndicator | null = null;
  private ui: CoopMissionPresentationUiPort | null = null;
  private uiInput: CoopMissionPresentationInfrastructureInput | null = null;
  private worldSpaceDestroyed = false;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.objectiveAnnouncements = new CoopDefenseObjectiveAnnouncement(scene);
    this.objectiveAnnouncements.build();
    this.mapEventAnnouncementPresenter = new CoopDefenseMapEventAnnouncementPresenter(
      this.objectiveAnnouncements,
    );
  }

  bindCenterHud(centerHUD: CenterHUD): void {
    if (this.destroyed) return;
    centerHUD.setObjectiveAnnouncements(this.objectiveAnnouncements);
  }

  createUiPort(input: CoopMissionPresentationInfrastructureInput): CoopMissionPresentationUiPort {
    if (this.ui) return this.ui;
    if (this.destroyed) throw new Error('Coop presentation infrastructure is destroyed');
    this.uiInput = input;

    this.secondaryObjectiveHud = new CoopDefenseSecondaryObjectiveHud(
      this.scene,
      this.objectiveAnnouncements,
    );
    this.secondaryObjectiveHud.build();
    this.hostileBaseIndicator = new HostileBaseIndicator(this.scene);

    this.ui = {
      centerHud: {
        resetCoopMissionPresentation: () => {
          if (!this.destroyed) input.centerHUD.resetCoopMissionPresentation();
        },
        updateLifeStatus: (model) => {
          if (!this.destroyed) input.centerHUD.updateLifeStatus(model);
        },
        updateMainObjectivePresentation: (model) => {
          if (!this.destroyed) input.centerHUD.updateMainObjectivePresentation(model);
        },
        updateEncounterPresentation: (state, elapsedMs) => {
          if (!this.destroyed) input.centerHUD.updateEncounterPresentation(state, elapsedMs);
        },
        updateMissionStackOcclusion: (deltaMs) => {
          if (!this.destroyed) {
            input.centerHUD.updateMissionStackOcclusion(
              deltaMs,
              input.playerManager,
              input.getEnemyManager(),
            );
          }
        },
        updateTutorial: (text, showControls, anchor) => {
          if (!this.destroyed) input.centerHUD.updateTutorial(text, showControls, anchor);
        },
        updateTutorialStep: (text, anchor) => {
          if (!this.destroyed) input.centerHUD.updateTutorialStep(text, anchor);
        },
      },
      mapEvents: {
        setMapEvents: (events) => {
          if (!this.destroyed) this.mapEventAnnouncementPresenter.setMapEvents(events);
        },
        sync: (state) => {
          if (!this.destroyed) this.mapEventAnnouncementPresenter.sync(state);
        },
        reset: () => {
          if (!this.destroyed) this.mapEventAnnouncementPresenter.reset();
        },
      },
      secondaryObjectives: {
        sync: (snapshot, configs, elapsedMs) => {
          if (!this.destroyed) this.secondaryObjectiveHud?.sync(snapshot, configs, elapsedMs, true);
        },
        updateOcclusionFade: (deltaMs) => {
          if (!this.destroyed) {
            this.secondaryObjectiveHud?.updateOcclusionFade(
              deltaMs,
              input.playerManager,
              input.getEnemyManager(),
            );
          }
        },
        reset: () => {
          if (!this.destroyed) this.secondaryObjectiveHud?.reset();
        },
      },
      worldSpace: {
        syncEncounterTelegraph: (state, elapsedMs) => {
          if (!this.destroyed) input.renderers.encounterTelegraph.sync(state, elapsedMs, true);
        },
        syncSecondaryObjectiveMarkers: (snapshot, configs, carryItems) => {
          if (!this.destroyed) {
            input.renderers.secondaryObjectiveMarkers.sync(
              snapshot,
              configs,
              input.getBaseManager(),
              carryItems,
              true,
            );
          }
        },
        syncCoopDefenseCarry: (items) => {
          if (!this.destroyed) input.renderers.beer.syncCoopDefenseCarry(items);
        },
        syncEnemyDashVisual: (enemy) => {
          if (!this.destroyed) input.clientUpdate.syncEnemyDashVisual(enemy);
        },
        resetEnemyDashVisuals: () => {
          if (!this.destroyed) input.clientUpdate.resetEnemyDashVisuals();
        },
        syncMissionProgress: (config, state) => {
          if (!this.destroyed) input.renderers.missionProgress.sync(config, state, true);
        },
        syncCarryZones: (snapshot, configs) => {
          if (!this.destroyed) input.renderers.carryZones.sync(snapshot, configs, true);
        },
        syncObjectiveRepairDrones: (snapshot, configs, elapsedMs) => {
          if (!this.destroyed) {
            input.renderers.objectiveRepairDrones.sync(
              snapshot,
              configs,
              input.getBaseManager(),
              elapsedMs,
              true,
            );
          }
        },
        syncHostileBaseIndicator: (mapConfig) => {
          if (!this.destroyed) {
            this.hostileBaseIndicator?.sync(
              input.getBaseManager(),
              input.getEnemyManager(),
              mapConfig,
              true,
            );
          }
        },
        destroy: () => {
          if (!this.destroyed) this.destroyWorldSpace(input);
        },
        reset: () => {
          if (!this.destroyed) this.resetWorldSpace(input);
        },
      },
    };
    return this.ui;
  }

  resetMapEventsForHydration(): void {
    if (!this.destroyed) this.mapEventAnnouncementPresenter.resetForHydration();
  }

  getReservedHudRects(): ReturnType<CoopDefenseSecondaryObjectiveHud['getReservedHudRects']> {
    return this.destroyed ? [] : this.secondaryObjectiveHud?.getReservedHudRects() ?? [];
  }

  destroy(): void {
    if (this.destroyed) return;
    this.secondaryObjectiveHud?.destroy();
    this.secondaryObjectiveHud = null;
    this.mapEventAnnouncementPresenter.reset();
    this.objectiveAnnouncements.destroy();
    if (this.ui && this.uiInput) {
      // The world-space reset is part of the scene-lifetime teardown and therefore runs after
      // the HUD objects, matching the previous shutdown order.
      this.destroyWorldSpace(this.uiInput);
    }
    this.destroyed = true;
    this.ui = null;
    this.uiInput = null;
  }

  private destroyWorldSpace(input: CoopMissionPresentationInfrastructureInput): void {
    if (this.worldSpaceDestroyed) return;
    this.worldSpaceDestroyed = true;
    input.renderers.beer.syncCoopDefenseCarry([]);
    input.clientUpdate.resetEnemyDashVisuals();
    this.hostileBaseIndicator?.destroy();
    this.hostileBaseIndicator = null;
    input.renderers.encounterTelegraph.destroy();
    input.renderers.secondaryObjectiveMarkers.destroy();
    input.renderers.missionProgress.destroy();
    input.renderers.carryZones.clear();
    input.renderers.objectiveRepairDrones.destroy();
  }

  private resetWorldSpace(input: CoopMissionPresentationInfrastructureInput): void {
    if (this.worldSpaceDestroyed) return;
    input.renderers.beer.syncCoopDefenseCarry([]);
    input.clientUpdate.resetEnemyDashVisuals();
    input.renderers.encounterTelegraph.clear();
    input.renderers.secondaryObjectiveMarkers.clear();
    input.renderers.missionProgress.clear();
    input.renderers.carryZones.clear();
    input.renderers.objectiveRepairDrones.clear();
    this.hostileBaseIndicator?.clear();
  }
}
