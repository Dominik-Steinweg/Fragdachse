import { CELL_SIZE } from '../../config';
import type { WorldPersistentBaseSite } from '../../world/WorldRuntimeContext';
import { WaterSurfaceModel } from '../../arena/WaterSurfaceModel';
import { DawnSitePropRenderer } from '../../arena/DawnSitePropRenderer';
import type { WorldDescriptor } from '../../world/WorldDescriptor';
import type { ActivityDescriptor } from '../../world/ActivityDescriptor';
import { resolveWorldDefinition } from '../../world/WorldDefinitionResolution';
import type { CoopDefenseSecondaryObjectivePresentationState } from '../../types';
import type { KrakenWaterSampler } from '../../effects/kraken/submersionShader';
import type { ArenaLayout } from '../../types';
import type { WorldMetrics } from '../../world/WorldMetrics';
import { KrakenPresentationResidency } from '../../effects/kraken/KrakenPresentationResidency';
import type { CameraFeedbackController } from '../../effects/camera/CameraFeedbackController';
import { KrakenEggFlightView, KrakenRenderer, KrakenSpineFlightView, type KrakenPresentationAssets } from '../../effects/kraken/KrakenRenderer';
import { KrakenIntroRenderer } from '../../effects/kraken/KrakenIntroRenderer';
import { KRAKEN_RISE_INTRO } from '../../config/bossIntros';
import { KRAKEN_BOSS_DEFAULTS } from '../../config/krakenBoss';
import * as Phaser from 'phaser';
import type { CenterHUD } from '../../ui/CenterHUD';
import type { DawnHUD } from '../../ui/DawnHUD';
import { CoopDefenseObjectiveAnnouncement } from '../../ui/CoopDefenseObjectiveAnnouncement';
import { CoopDefenseMapEventAnnouncementPresenter } from '../../ui/CoopDefenseMapEventAnnouncementPresenter';
import { CoopDefenseSecondaryObjectiveHud } from '../../ui/CoopDefenseSecondaryObjectiveHud';
import { getBaseWorldBounds } from '../../arena/BaseRegistry';
import { mainObjectiveMarkers, enemyMarkers, secondaryObjectiveMarkers, checkpointMarkers } from '../../effects/markers/sources/CoopMissionMarkerSource';
import type { BaseManager } from '../../entities/BaseManager';
import type { EnemyManager } from '../../entities/EnemyManager';
import type { PlayerManager } from '../../entities/PlayerManager';
import type { ClientUpdateCoordinator } from './ClientUpdateCoordinator';
import type { RendererBundle } from './RendererBundle';
import type { BossIntroState } from '../../config/bossIntros';
import { t } from '../../i18n';
import type {
  CoopMissionPresentationUiPort,
} from '../../activity/CoopMissionPresentationBinding';

export interface CoopMissionPresentationInfrastructureInput {
  readonly cameraFeedback?: CameraFeedbackController;
  readonly krakenAssets?: KrakenPresentationAssets | null;
  readonly getWorldLayout?: () => ArenaLayout | null;
  readonly getWorldMetrics?: () => WorldMetrics | null;
  readonly getPersistentBaseSite?: () => WorldPersistentBaseSite | null;
  readonly krakenWaterAt?: (x: number, y: number) => number;
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
  private dawnSiteProps: DawnSitePropRenderer | null = null;
  private dawnWorldRevision: number | null = null;
  private ui: CoopMissionPresentationUiPort | null = null;
  private uiInput: CoopMissionPresentationInfrastructureInput | null = null;
  private worldSpaceDestroyed = false;
  /** Zuletzt angekündigtes Boss-Intro; verhindert Doppelmeldungen pro Frame. */
  private announcedBossIntroKey: string | null = null;
  private destroyed = false;
  private kraken: KrakenRenderer | null = null;
  private releaseKrakenProjectiles: (() => void) | null = null;
  private krakenResidency: KrakenPresentationResidency | null = null;
  private krakenIntro: KrakenIntroRenderer | null = null;

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

  bindDawnHud(hud: DawnHUD): void {
    if (!this.destroyed) hud.setObjectiveAnnouncements(this.objectiveAnnouncements);
  }

  syncDawnSites(
    world: WorldDescriptor | null,
    activity: ActivityDescriptor | null,
    objectives: CoopDefenseSecondaryObjectivePresentationState | null,
  ): void {
    if (this.destroyed) return;
    const plan = world?.parameters?.dawn;
    if (!plan || !world || !activity?.parameters?.dawn || activity.worldRevision !== world.worldRevision) {
      this.clearDawnSites();
      return;
    }
    if (this.dawnWorldRevision !== world.worldRevision) {
      this.clearDawnSites();
      const definition = resolveWorldDefinition(world, activity);
      if (!definition) return;
      this.dawnSiteProps = new DawnSitePropRenderer(this.scene, plan, definition,
        baseId => this.uiInput?.getBaseManager()?.getBase(baseId)?.isDestroyed() ?? false,
        baseId => this.uiInput?.getBaseManager()?.getStructureHp(baseId) ?? null,
        this.uiInput?.renderers.lighting ?? null);
      this.dawnWorldRevision = world.worldRevision;
    }
    this.dawnSiteProps?.sync(objectives);
  }

  private clearDawnSites(): void {
    this.dawnSiteProps?.destroy();
    this.dawnSiteProps = null;
    this.dawnWorldRevision = null;
  }

  createUiPort(input: CoopMissionPresentationInfrastructureInput): CoopMissionPresentationUiPort {
    if (this.ui) return this.ui;
    if (this.destroyed) throw new Error('Coop presentation infrastructure is destroyed');
    this.uiInput = input;
    let waterLayout: ArenaLayout | null = null, waterModel: WaterSurfaceModel | null = null;
    const waterAt: KrakenWaterSampler = input.krakenWaterAt ?? ((x: number, y: number) => {
      const layout = input.getWorldLayout?.() ?? null, metrics = input.getWorldMetrics?.();
      if (!layout || !metrics) { waterLayout = null; waterModel = null; return -64; }
      if (layout !== waterLayout) {
        waterLayout = layout;
        waterModel = new WaterSurfaceModel(layout.water ?? [], { width: metrics.widthPx, height: metrics.heightPx });
      }
      return waterModel!.sample(x - metrics.offsetX, y - metrics.offsetY);
    });
    if (!input.krakenWaterAt) waterAt.uniformMask = s => {
      // Refresh the World-bound topology before proving constant coverage. An
      // enclosed island or a shore anywhere inside the rectangle forces sampling.
      waterAt(s.x, s.y);
      const metrics = input.getWorldMetrics?.();
      if (!waterModel || !metrics) return null;
      const c = Math.cos(s.rotation), sn = Math.sin(s.rotation);
      const dx = (.5 - s.originX) * s.displayWidth, dy = (.5 - s.originY) * s.displayHeight;
      const cx = s.x + dx * c - dy * sn - metrics.offsetX, cy = s.y + dx * sn + dy * c - metrics.offsetY;
      const rx = (Math.abs(s.displayWidth * c) + Math.abs(s.displayHeight * sn)) / 2;
      const ry = (Math.abs(s.displayWidth * sn) + Math.abs(s.displayHeight * c)) / 2;
      return waterModel.uniformCoverage(cx - rx, cy - ry, cx + rx, cy + ry);
    };
    const diagnostic = (message: string) => console.warn('[Kraken presentation]', message);
    this.krakenResidency = new KrakenPresentationResidency(this.scene, message => {
      diagnostic(message);
      this.objectiveAnnouncements.enqueue({ id: 'kraken-assets:' + message, topic: 'kraken-assets',
        kicker: 'Abgrundkrake', title: 'Darstellung konnte nicht geladen werden', detail: message,
        tone: 'negative', priority: 100, holdMs: 6000 });
    }, () => (this.kraken?.gpuBytes ?? 0) + (this.krakenIntro?.gpuBytes ?? 0));
    const assets = input.krakenAssets ?? this.krakenResidency.assets;
    this.kraken = new KrakenRenderer(this.scene, { assets, waterAt, diagnostic, shadows: input.renderers.shadow,
      feedback: input.cameraFeedback,
      announceExit: () => this.objectiveAnnouncements.enqueue({
        id: 'kraken-ashore:' + this.scene.time.now, topic: 'boss-intro', priority: 100, tone: 'main', holdMs: 2200,
        kicker: t('ui.bossIntro.kraken.kicker'),
        title: t('ui.bossIntro.kraken.ashore'),
      }),
      readEggPose: egg => {
        const manager = input.getEnemyManager(), target = manager?.getCombatTargetRef(egg.eggId);
        const e = target?.instance.entityGeneration === egg.entityGeneration ? manager?.getEnemy(egg.eggId) : null;
        return e ? { x: e.sprite.x, y: e.sprite.y, angle: e.getAimAngle() } : null;
      },
    });
    // Eggs and spines in flight use the kraken's own art instead of the generic grenade/bullet renderers.
    // Date.now is the presentation timebase the dev scenario steps deterministically; a wall clock would
    // expire the flight window between stepped frames.
    const clock = () => Date.now();
    this.releaseKrakenProjectiles = input.renderers.projectileVisualOverrides.register(projectile => {
      if (!assets) return null;
      if (projectile.weaponSourceId === 'kraken-eggs') {
        const releasedAt = clock();
        return new KrakenEggFlightView(this.scene, assets.egg, diagnostic, { releasedAt, landsAt: releasedAt + KRAKEN_BOSS_DEFAULTS.eggs.flightMs }, clock,
          input.renderers.shadow);
      }
      if (projectile.weaponSourceId === 'kraken_spine' && assets.spine) return new KrakenSpineFlightView(this.scene, assets.spine, diagnostic, clock,
        input.renderers.shadow, projectile.id % 97);
      return null;
    });
    this.krakenIntro = new KrakenIntroRenderer(this.scene, assets?.water ?? null, waterAt, diagnostic, 0, input.renderers.shadow, assets?.spine);
    this.krakenIntro.setCameraFeedback(input.cameraFeedback ?? null);

    this.secondaryObjectiveHud = new CoopDefenseSecondaryObjectiveHud(
      this.scene,
      this.objectiveAnnouncements,
    );
    this.secondaryObjectiveHud.build();

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
        syncKraken: (state, body, now) => {
          if (this.destroyed) return;
          if (state) this.krakenResidency?.setPhase(state.phase.kind === 'ashore' ? 'ashore'
            : state.phase.kind === 'land' || (state.phase.kind === 'dying' && state.phase.asset === 'land') ? 'land'
            : state.phase.kind === 'removed' ? 'dead' : state.phase.kind === 'intro' ? 'intro' : 'water', {
              prefetchLand: body?.hpRatio !== undefined && body.hpRatio <= KRAKEN_BOSS_DEFAULTS.residency.landPrefetchHpRatio,
              waterMove: state.movement === 'water-approach',
              waterBody: state.phase.kind !== 'ashore' || now < state.phase.gripAt,
            });
          this.kraken?.sync(state, body, now);
        },
        applyKrakenClaw: (event, now) => { if (!this.destroyed) this.kraken?.applyAreaClaw(event, now); },
        confirmKrakenHit: (receipt, now) => { if (!this.destroyed) this.kraken?.confirmContact(receipt, now); },
        syncEncounterTelegraph: (state, elapsedMs) => {
          if (!this.destroyed) input.renderers.encounterTelegraph.sync(state, elapsedMs, true);
        },
        syncSecondaryObjectiveMarkers: (snapshot, configs, carryItems, elapsedMs) => {
          if (!this.destroyed) {
            const metrics = input.getWorldMetrics?.();
            if (metrics) input.renderers.markers.coop?.setSecondary(secondaryObjectiveMarkers(
              snapshot, configs, carryItems, metrics, id => {
                const base = input.getBaseManager()?.getBase(id);
                return base ? { ...getBaseWorldBounds(base.spec.region, metrics),
                  dormant: base.isDormant(), destroyed: base.isDestroyed() } : null;
              }), snapshot, this.scene.time.now, elapsedMs);
          }
        },
        syncMortarStrikes: (strikes, nowMs) => {
          if (!this.destroyed) input.renderers.mortarStrike.sync(strikes, nowMs);
        },
        syncCoopDefenseCarry: (items) => {
          if (this.destroyed) return;
          // Dawn supply sites carry crates; every other carry objective keeps the campaign bottle.
          const props = this.dawnSiteProps;
          input.renderers.beer.syncCoopDefenseCarry(props ? items.filter(item => !props.ownsObjective(item.objectiveId)) : items);
          props?.syncCrates(items.filter(item => props.ownsObjective(item.objectiveId)));
        },
        syncEnemyDashVisual: (enemy) => {
          if (!this.destroyed) input.clientUpdate.syncEnemyDashVisual(enemy);
        },
        resetEnemyDashVisuals: () => {
          if (!this.destroyed) input.clientUpdate.resetEnemyDashVisuals();
        },
        syncMissionProgress: (config, state, elapsedMs) => {
          if (this.destroyed) return;
          input.renderers.missionProgress.sync(config, state, elapsedMs, true);
          const metrics = input.getWorldMetrics?.();
          if (metrics) input.renderers.markers.coop?.set('checkpoints', checkpointMarkers(config, state, metrics, { nowMs: this.scene.time.now, elapsedMs }), this.scene.time.now);
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
        syncMainObjectiveMarkers: (mapConfig) => {
          if (this.destroyed) return;
          const source = input.renderers.markers.coop, metrics = input.getWorldMetrics?.();
          if (!source || !metrics) return;
          const base = mapConfig.mapId.startsWith('dawn:') ? null : input.getBaseManager()?.getActiveMainBase(
            mapConfig.objective === 'destroy-hostile-bases' ? 'hostile' : 'friendly');
          const site = input.getPersistentBaseSite?.();
          const area = site?.baseId === base?.spec.id && base && base.getHp() < base.getMaxHp() ? site?.buildArea : undefined;
          const dangerRadiusPx = area ? (area.kind === 'radius' ? area.radiusCells : area.sizeCells / 2) * CELL_SIZE : undefined;
          source.set('main', mainObjectiveMarkers(base?.spec.id ?? '', base
            ? getBaseWorldBounds(base.spec.region, metrics) : null, dangerRadiusPx), this.scene.time.now);
          const manager = input.getEnemyManager();
          source.set('enemies', enemyMarkers((manager?.getAllEnemies() ?? [])
            .filter(e => e.faction === 'hostile' && e.sprite.active && e.getHp() > 0 && !e.isBurrowed())
            .map(e => ({ id: e.id, generation: manager?.getCombatTargetRef(e.id)?.instance.entityGeneration ?? 0,
              x: e.sprite.x, y: e.sprite.y, size: e.getSize(), vulnerable: e.isVulnerable(),
              boss: e.kind === mapConfig.boss?.enemyKind || !!e.getBossPresence(),
              timebomb: e.getSpecialAction() === 'timebomb-fuse' || e.getSpecialAction() === 'timebomb-chase',
              fuseProgress: e.getSpecialAction() === 'timebomb-fuse' ? e.getTimebombFuseProgress() : undefined,
            }))), this.scene.time.now);
        },
        syncBossIntro: (state, now) => {
          if (this.destroyed) return;
          if (state?.preset === 'kraken-rise' && now >= state.startedAtMs
            && now < state.startedAtMs + KRAKEN_RISE_INTRO.emergeAtMs) this.krakenResidency?.setPhase('intro');
          input.renderers.bossIntro.sync(state, now, true);
          input.renderers.voidHunterSparks.syncIntro(state, now);
          input.renderers.voidRift.sync(state, now);
          this.krakenIntro?.sync(state?.preset === 'kraken-rise' && state.habitatId && state.waterAnchorId
            ? { ...state, preset: 'kraken-rise', habitatId: state.habitatId, waterAnchorId: state.waterAnchorId } : null, now);
          input.renderers.voidMeteorIntro.sync(state, now);
          this.announceBossIntro(state, now);
        },
        syncBossPresence: (sources, now) => {
          if (this.destroyed) return;
          input.renderers.bossPresence.sync(sources, now);
          input.renderers.voidHunterSparks.syncBosses(sources);
        },
        bossIntroOwnsSpawn: (state, now) => !this.destroyed && (
          input.renderers.bossIntro.ownsSpawnAt(state, now)
          || input.renderers.voidHunterSparks.ownsSpawnAt(state, now)
          || (state?.preset === 'kraken-rise' && now >= state.startedAtMs && now < state.startedAtMs + KRAKEN_RISE_INTRO.durationMs)
          || input.renderers.voidMeteorIntro.ownsSpawnAt(state, now)
        ),
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

  inspectKrakenResidency() { return this.krakenResidency?.inspect() ?? null; }
  resetMapEventsForHydration(): void {
    if (!this.destroyed) this.mapEventAnnouncementPresenter.resetForHydration();
  }

  getReservedHudRects(): ReturnType<CoopDefenseSecondaryObjectiveHud['getReservedHudRects']> {
    return this.destroyed ? [] : this.secondaryObjectiveHud?.getReservedHudRects() ?? [];
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clearDawnSites();
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

  /** Das Banner gehört zum live miterlebten Intro-Start; Late-Joiner bekommen es nicht nachgereicht. */
  private announceBossIntro(state: BossIntroState | null, now: number): void {
    if (!state) return;
    const key = `${state.startedAtMs}:${state.seed}`;
    if (this.announcedBossIntroKey === key) return;
    this.announcedBossIntroKey = key;
    if (now - state.startedAtMs > 2_500) return;
    const announcement = {
      'graveyard-rise': 'ui.bossIntro.graveyard',
      'void-sparks': 'ui.bossIntro.void',
      'kraken-rise': 'ui.bossIntro.kraken',
      'void-meteor': 'ui.bossIntro.meteor',
    } as const;
    const prefix = announcement[state.preset];
    this.objectiveAnnouncements.enqueue({
      id: `boss-intro:${key}`,
      kicker: t(`${prefix}.kicker`),
      title: t(`${prefix}.title`),
      detail: t(`${prefix}.detail`),
      tone: 'main',
      topic: 'boss-intro',
      priority: 100,
      holdMs: 3_200,
    });
  }

  private destroyWorldSpace(input: CoopMissionPresentationInfrastructureInput): void {
    this.clearDawnSites();
    if (this.worldSpaceDestroyed) return;
    this.worldSpaceDestroyed = true;
    this.releaseKrakenProjectiles?.(); this.releaseKrakenProjectiles = null;
    this.kraken?.destroy(); this.kraken = null; this.krakenIntro?.destroy(); this.krakenIntro = null;
    this.krakenResidency?.destroy(); this.krakenResidency = null;
    input.renderers.beer.syncCoopDefenseCarry([]);
    input.clientUpdate.resetEnemyDashVisuals();
    input.renderers.encounterTelegraph.destroy();
    input.renderers.bossIntro.clear();
    input.renderers.bossPresence.clear();
    input.renderers.voidHunterSparks.clear();
    input.renderers.voidRift.clear();
    input.renderers.voidMeteorIntro.clear();
    input.renderers.missionProgress.destroy();
    input.renderers.objectiveRepairDrones.destroy();
  }

  private resetWorldSpace(input: CoopMissionPresentationInfrastructureInput): void {
    this.clearDawnSites();
    if (this.worldSpaceDestroyed) return;
    input.renderers.beer.syncCoopDefenseCarry([]);
    input.clientUpdate.resetEnemyDashVisuals();
    input.renderers.encounterTelegraph.clear();
    input.renderers.bossIntro.clear();
    input.renderers.bossPresence.clear();
    input.renderers.voidHunterSparks.clear();
    input.renderers.voidRift.clear();
    this.kraken?.clear(); this.krakenIntro?.clear(); this.krakenResidency?.setPhase('dead');
    input.renderers.voidMeteorIntro.clear();
    this.announcedBossIntroKey = null;
    input.renderers.markers.releaseRound();
    input.renderers.missionProgress.clear();
    input.renderers.objectiveRepairDrones.clear();
  }
}
