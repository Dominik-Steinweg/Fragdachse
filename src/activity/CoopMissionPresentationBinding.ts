import type {
  CoopDefenseEncounterPresentationState,
  CoopDefenseMapEventPresentationState,
  CoopDefenseMissionProgressPresentationState,
  CoopDefenseRespawnBudgetPlayerState,
  CoopDefenseSecondaryObjectivePresentationState,
} from '../types';
import type {
  CoopDefenseMapConfig,
  ResolvedCoopDefenseMapEventConfig,
  ResolvedCoopDefenseMapSecondaryObjectiveConfig,
  ResolvedCoopDefenseMapTutorialStepConfig,
} from '../config/coopDefenseMaps';
import {
  getMapTutorial,
  getMapTutorialStep,
} from '../i18n/contentPresentation';
import { getLocale } from '../i18n';
import {
  COOP_DEFENSE_TUTORIAL_DURATION_MS,
  type CoopDefenseTutorialAnchor,
} from '../config/coopDefenseTutorial';
import { getVisibleCoopDefenseTutorialStepId } from '../ui/coopDefenseTutorialStepModel';
import { buildCoopDefenseLifeStatusViewModel } from '../ui/coopDefenseLifeStatusModel';
import {
  buildMainObjectiveViewModel,
  type MainObjectiveBaseProgress,
  type MainObjectiveBossProgress,
} from '../ui/coopDefenseMainObjectiveModel';
import { resolveCoopDefenseMapMissionProgress, resolveCoopDefenseMapTutorialSteps } from '../config/coopDefenseMaps';
import type { CoopMissionRuntime, CoopMissionScopedBinding } from './CoopMissionRuntime';

export interface CoopMissionPresentationReadPort {
  readonly getEncounterPresentationState: () => CoopDefenseEncounterPresentationState | null;
  readonly getMapEventPresentationState: () => CoopDefenseMapEventPresentationState | null;
  readonly getSecondaryObjectivePresentationState: () => CoopDefenseSecondaryObjectivePresentationState | null;
  readonly getMissionProgressPresentationState: () => CoopDefenseMissionProgressPresentationState | null;
  readonly getLocalRespawnBudgetState: () => CoopDefenseRespawnBudgetPlayerState | null;
  readonly getSynchronizedNow: () => number;
  readonly getArenaStartTime: () => number;
  readonly getHostileBaseProgress: () => MainObjectiveBaseProgress | null;
  readonly getBossProgress: (enemyKind: string) => MainObjectiveBossProgress | null;
}

export interface CoopMissionPresentationUiPort {
  readonly centerHud: {
    readonly resetCoopMissionPresentation: () => void;
    readonly updateLifeStatus: (model: ReturnType<typeof buildCoopDefenseLifeStatusViewModel>) => void;
    readonly updateMainObjectivePresentation: (model: ReturnType<typeof buildMainObjectiveViewModel> | null) => void;
    readonly updateEncounterPresentation: (
      state: CoopDefenseEncounterPresentationState | null,
      elapsedMs: number,
    ) => void;
    readonly updateMissionStackOcclusion: (deltaMs: number) => void;
    readonly updateTutorial: (
      text: string | null,
      showControls: boolean,
      anchor?: CoopDefenseTutorialAnchor,
    ) => void;
    readonly updateTutorialStep: (text: string | null, anchor?: CoopDefenseTutorialAnchor) => void;
  };
  readonly mapEvents: {
    readonly setMapEvents: (events: readonly ResolvedCoopDefenseMapEventConfig[]) => void;
    readonly sync: (state: CoopDefenseMapEventPresentationState | null) => void;
    readonly reset: () => void;
  };
  readonly secondaryObjectives: {
    readonly sync: (
      snapshot: CoopDefenseSecondaryObjectivePresentationState | null,
      configs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
      elapsedMs: number,
    ) => void;
    readonly updateOcclusionFade: (deltaMs: number) => void;
    readonly reset: () => void;
  };
}

/**
 * Activity-scoped owner for the screen-space Coop mission presentation.
 *
 * The binding owns no simulation and has no network dependency. It reads the current replicated
 * state and World read models through the composition port, then forwards presentation models to
 * the scene-lifetime UI objects. A detached binding is deliberately inert.
 */
export class CoopMissionPresentationBinding implements CoopMissionScopedBinding {
  private runtime: CoopMissionRuntime | null = null;
  private presentationActive = false;

  constructor(
    private readonly mapConfig: CoopDefenseMapConfig,
    private readonly reads: CoopMissionPresentationReadPort,
    private readonly ui: CoopMissionPresentationUiPort,
  ) {}

  attach(runtime: CoopMissionRuntime): void {
    if (this.runtime === runtime) return;
    if (this.runtime) this.clearPresentation();
    this.runtime = runtime;
    this.presentationActive = false;
    this.ui.mapEvents.setMapEvents(this.mapConfig.mapEvents ?? []);
  }

  detach(): void {
    if (!this.runtime) return;
    this.runtime = null;
    this.clearPresentation();
  }

  /**
   * Updates all screen-space Coop presentation in one named Activity-owned step.
   * `active` is supplied by the outer presentation policy so previews and exit fades cannot keep
   * an Activity HUD visible when the world is not interactively presented.
   */
  sync(deltaMs: number, active: boolean): void {
    if (!this.runtime) return;
    if (!active) {
      if (this.presentationActive) this.clearPresentation();
      this.presentationActive = false;
      return;
    }
    this.presentationActive = true;

    const elapsedMs = this.reads.getSynchronizedNow() - this.reads.getArenaStartTime();
    const missionProgress = this.reads.getMissionProgressPresentationState();
    const encounter = this.reads.getEncounterPresentationState();

    this.ui.mapEvents.sync(this.reads.getMapEventPresentationState());

    this.ui.centerHud.updateLifeStatus(buildCoopDefenseLifeStatusViewModel({
      budget: this.reads.getLocalRespawnBudgetState(),
      missionRespawnActive: missionProgress?.respawnCheckpointId != null,
    }));
    this.syncTutorial(elapsedMs, missionProgress);

    const bossEnemyKind = this.mapConfig.boss?.enemyKind;
    const mainObjective = buildMainObjectiveViewModel({
      mapId: this.mapConfig.mapId,
      objective: this.mapConfig.objective,
      elapsedMs,
      surviveDurationSec: this.mapConfig.surviveDurationSec,
      encounterCount: this.mapConfig.encounters?.length ?? 0,
      encounter,
      boss: bossEnemyKind ? this.reads.getBossProgress(bossEnemyKind) : null,
      hostileBases: this.mapConfig.objective === 'destroy-hostile-bases'
        ? this.reads.getHostileBaseProgress()
        : null,
      advance: this.mapConfig.objective === 'advance'
        ? {
          activatedCheckpoints: missionProgress?.activatedCheckpoints.length ?? 0,
          totalCheckpoints: resolveCoopDefenseMapMissionProgress(this.mapConfig)?.checkpoints.length ?? 0,
          routeComplete: missionProgress?.routeComplete === true,
        }
        : null,
    });

    this.ui.centerHud.updateMainObjectivePresentation(mainObjective);
    this.ui.centerHud.updateEncounterPresentation(encounter, elapsedMs);
    this.ui.centerHud.updateMissionStackOcclusion(deltaMs);

    const secondaryObjectivePresentation = this.reads.getSecondaryObjectivePresentationState();
    this.ui.secondaryObjectives.sync(
      secondaryObjectivePresentation,
      this.runtime.secondaryObjectiveConfigs,
      elapsedMs,
    );
    this.ui.secondaryObjectives.updateOcclusionFade(deltaMs);
  }

  private syncTutorial(
    elapsedMs: number,
    missionProgress: CoopDefenseMissionProgressPresentationState | null,
  ): void {
    const roundElapsedMs = Math.max(0, elapsedMs);
    const tutorialDurationMs = this.mapConfig.tutorialDurationMs ?? COOP_DEFENSE_TUTORIAL_DURATION_MS;
    const tutorialText = getMapTutorial(this.mapConfig.mapId, getLocale());
    const tutorialVisible = tutorialText !== undefined
      && roundElapsedMs >= 0
      && (this.mapConfig.tutorialPersistent === true || roundElapsedMs < tutorialDurationMs);
    this.ui.centerHud.updateTutorial(
      tutorialVisible ? tutorialText : null,
      this.mapConfig.tutorialShowControls === true,
      this.mapConfig.tutorialAnchor,
    );

    const steps = resolveCoopDefenseMapTutorialSteps(this.mapConfig);
    if (steps.length === 0 || missionProgress === null) {
      this.ui.centerHud.updateTutorialStep(null);
      return;
    }

    const visibleStepId = getVisibleCoopDefenseTutorialStepId(
      steps,
      missionProgress.activatedCheckpoints,
      roundElapsedMs,
    );
    const visibleStep = visibleStepId === null
      ? null
      : steps.find((step: ResolvedCoopDefenseMapTutorialStepConfig) => step.id === visibleStepId) ?? null;
    this.ui.centerHud.updateTutorialStep(
      visibleStep === null ? null : getMapTutorialStep(visibleStep.id, getLocale()) ?? null,
      visibleStep?.anchor,
    );
  }

  private clearPresentation(): void {
    this.presentationActive = false;
    this.ui.centerHud.resetCoopMissionPresentation();
    this.ui.mapEvents.reset();
    this.ui.secondaryObjectives.reset();
  }
}
