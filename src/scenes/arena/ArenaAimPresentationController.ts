import type {
  UltimateChargePreviewState,
  UtilityChargePreviewState,
  UtilityPlacementPreviewState,
  UtilityTargetingPreviewState,
  SyncedTunnel,
} from '../../types';
import type { ScopeModeConfig } from '../../loadout/LoadoutConfig';
import type { ScopePerformanceMetrics } from '../../ui/ScopeOverlay';
import type { ArenaDiagnosticsFrame } from './ArenaDiagnosticsController';
import type { PlacementPreviewRenderer } from './PlacementPreviewRenderer';

export interface ArenaAimPresentationInputPort {
  readonly getUtilityTargetingPreviewState: () => UtilityTargetingPreviewState | undefined;
  readonly getAirstrikeTargetingPreviewState: () => UtilityTargetingPreviewState | undefined;
  readonly getConstructionPlacementPreviewState: () => UtilityPlacementPreviewState | undefined;
  readonly getUltimateChargePreviewState: () => UltimateChargePreviewState | undefined;
  readonly getUtilityChargePreviewState: () => UtilityChargePreviewState | undefined;
  readonly getScopeProgress: () => number;
  readonly isScoping: () => boolean;
  readonly getScopeChargeProgress: () => number;
  readonly getWeapon2ScopeConfig: () => ScopeModeConfig | undefined;
}

export interface ArenaAimPresentationBindingPort {
  readonly getLocalPlacementPreview: () => UtilityPlacementPreviewState | undefined;
  readonly getLocalUltimatePlacementPreview: () => UtilityPlacementPreviewState | undefined;
  readonly getAimPresentationState: (
    worldInteractive: boolean,
    spectator: boolean,
    optionsOpen: boolean,
  ) => { aimVisible: boolean; cursorVisible: boolean };
}

export interface ArenaAimPresentationWorldPort {
  readonly syncPersistentBasePresentation: (showWorld: boolean, spectator: boolean) => void;
  readonly getTunnelSnapshot: () => readonly SyncedTunnel[];
}

export interface ArenaAimPresentationRendererPort {
  readonly aimSystem: {
    setScopeProgress: (progress: number) => void;
    setScoping: (scoping: boolean) => void;
    setWeaponChargeProgress: (progress: number) => void;
    update: (
      showAim: boolean,
      hideSystemCursor: boolean,
      delta: number,
      utilityTargeting?: UtilityTargetingPreviewState,
      ultimatePreview?: UltimateChargePreviewState,
    ) => void;
    getGraphicsCommandCount: () => number;
    destroy: () => void;
  };
  readonly scopeOverlay: {
    update: (
      targetProgress: number,
      cursorScreenX: number,
      cursorScreenY: number,
      delta: number,
      config: ScopeModeConfig,
    ) => void;
    getPerformanceMetrics: () => ScopePerformanceMetrics;
    setPerformanceMetricsEnabled: (enabled: boolean) => void;
    destroy: () => void;
  };
  readonly utilityChargeIndicator: {
    update: (preview: UtilityChargePreviewState | undefined) => void;
    destroy: () => void;
  };
  readonly ultimateChargeIndicator: {
    update: (preview: UltimateChargePreviewState | undefined) => void;
    destroy: () => void;
  };
  readonly placementPreview: PlacementPreviewRenderer;
  readonly tunnelRenderer: {
    sync: (snapshot: readonly SyncedTunnel[]) => void;
    update: (now: number) => void;
    destroy: () => void;
  };
  readonly gaussWarning: {
    update: (inArena: boolean) => void;
    destroy: () => void;
  };
}

export interface ArenaAimPresentationFrame {
  readonly inArena: boolean;
  readonly worldInteractive: boolean;
  readonly spectator: boolean;
  readonly optionsOpen: boolean;
  readonly delta: number;
  readonly now: number;
  readonly localPlayerAlive: boolean;
  readonly localPlayerBurrowed: boolean;
  readonly scopeCursorX: number;
  readonly scopeCursorY: number;
}

export interface ArenaAimPresentationResult {
  readonly showAim: boolean;
  readonly scopeProgress: number;
  readonly utilityPlacementActive: boolean;
  readonly ultimatePlacementActive: boolean;
}

const NO_SCOPE_CONFIG: ScopeModeConfig = {
  scopeInMs: 1,
  fullScopeViewRadius: 0,
  edgeSoftnessPx: 0,
  unscopedSpreadDeg: 0,
  unscopeSpeedMs: 200,
};

/**
 * Scene-lifetime owner for local aim, scope and placement presentation.
 * It only consumes immutable frame signals and narrow presentation ports; it has no gameplay
 * authority and does not own World- or Activity-lifetime state.
 */
export class ArenaAimPresentationController {
  private destroyed = false;

  constructor(
    private readonly input: ArenaAimPresentationInputPort,
    private readonly bindings: ArenaAimPresentationBindingPort,
    private readonly world: ArenaAimPresentationWorldPort,
    private readonly renderers: ArenaAimPresentationRendererPort,
  ) {}

  sync(frame: ArenaAimPresentationFrame, diagnosticsFrame: ArenaDiagnosticsFrame | null): ArenaAimPresentationResult {
    if (this.destroyed) {
      return { showAim: false, scopeProgress: 0, utilityPlacementActive: false, ultimatePlacementActive: false };
    }

    diagnosticsFrame?.begin('aimPreview');
    const utilityTargeting = frame.inArena && !frame.spectator ? this.input.getUtilityTargetingPreviewState() : undefined;
    const airstrikeTargeting = frame.inArena && !frame.spectator ? this.input.getAirstrikeTargetingPreviewState() : undefined;
    const utilityPlacement = frame.inArena && !frame.spectator ? this.bindings.getLocalPlacementPreview() : undefined;
    const ultimatePlacement = frame.inArena && !frame.spectator ? this.bindings.getLocalUltimatePlacementPreview() : undefined;
    const constructionPlacement = frame.inArena && !frame.spectator
      ? this.input.getConstructionPlacementPreviewState()
      : undefined;
    const activePlacement = ultimatePlacement ?? utilityPlacement ?? constructionPlacement;
    this.world.syncPersistentBasePresentation(frame.inArena, frame.spectator);
    const ultimatePreview = frame.inArena && !frame.spectator ? this.input.getUltimateChargePreviewState() : undefined;
    const aimPresentation = this.bindings.getAimPresentationState(frame.worldInteractive, frame.spectator, frame.optionsOpen);
    const showAim = aimPresentation.aimVisible;
    const scopeProgress = this.input.getScopeProgress();
    diagnosticsFrame?.end('aimPreview');

    diagnosticsFrame?.begin('aimGraphics');
    this.renderers.aimSystem.setScopeProgress(scopeProgress);
    this.renderers.aimSystem.setScoping(this.input.isScoping());
    this.renderers.aimSystem.setWeaponChargeProgress(this.input.getScopeChargeProgress());
    const targetingForReticle = utilityTargeting ?? airstrikeTargeting;
    this.renderers.aimSystem.update(
      (showAim || targetingForReticle !== undefined) && aimPresentation.cursorVisible,
      aimPresentation.cursorVisible,
      frame.delta,
      frame.optionsOpen ? undefined : targetingForReticle,
      frame.optionsOpen ? undefined : ultimatePreview,
    );
    diagnosticsFrame?.end('aimGraphics');

    diagnosticsFrame?.begin('scope');
    const scopeConfig = frame.inArena && !frame.spectator ? this.input.getWeapon2ScopeConfig() : undefined;
    this.renderers.scopeOverlay.update(
      scopeConfig ? scopeProgress : 0,
      scopeConfig ? frame.scopeCursorX : 0,
      scopeConfig ? frame.scopeCursorY : 0,
      frame.delta,
      scopeConfig ?? NO_SCOPE_CONFIG,
    );
    diagnosticsFrame?.end('scope');

    diagnosticsFrame?.begin('aimIndicators');
    this.renderers.utilityChargeIndicator.update(
      frame.inArena && !frame.spectator ? this.input.getUtilityChargePreviewState() : undefined,
    );
    this.renderers.ultimateChargeIndicator.update(ultimatePreview);
    diagnosticsFrame?.end('aimIndicators');
    diagnosticsFrame?.mark('visualAimEnd');

    this.renderers.gaussWarning.update(frame.inArena);
    this.renderers.placementPreview.syncUtilityTargetingHint(
      frame.inArena,
      utilityTargeting !== undefined,
      frame.localPlayerAlive,
      frame.localPlayerBurrowed,
    );
    this.renderers.placementPreview.syncAirstrikeTargetingHint(
      frame.inArena,
      airstrikeTargeting !== undefined,
      frame.localPlayerAlive,
      frame.localPlayerBurrowed,
    );
    this.renderers.placementPreview.syncPlaceableUtilityHint(
      frame.inArena,
      activePlacement,
      frame.localPlayerAlive,
      frame.localPlayerBurrowed,
    );
    this.renderers.placementPreview.renderPlacementPreview(
      frame.inArena,
      activePlacement,
      frame.localPlayerAlive,
      frame.localPlayerBurrowed,
    );
    this.renderers.placementPreview.renderRemotePlacementPreviews(frame.inArena);
    this.renderers.tunnelRenderer.sync(frame.inArena ? this.world.getTunnelSnapshot() : []);
    this.renderers.tunnelRenderer.update(frame.now);
    diagnosticsFrame?.mark('visualEnd');

    return {
      showAim,
      scopeProgress,
      utilityPlacementActive: utilityPlacement !== undefined,
      ultimatePlacementActive: ultimatePlacement !== undefined,
    };
  }

  getPlacementPreviewRenderer(): ArenaAimPresentationRendererPort['placementPreview'] {
    return this.renderers.placementPreview;
  }

  getScopePerformanceMetrics(): ScopePerformanceMetrics {
    return this.renderers.scopeOverlay.getPerformanceMetrics();
  }

  getAimGraphicsCommandCount(): number {
    return this.renderers.aimSystem.getGraphicsCommandCount();
  }

  setScopePerformanceMetricsEnabled(enabled: boolean): void {
    if (this.destroyed) return;
    this.renderers.scopeOverlay.setPerformanceMetricsEnabled(enabled);
  }

  showPlacementError(message: string): void {
    if (this.destroyed) return;
    this.renderers.placementPreview.showPlacementError(message);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderers.aimSystem.destroy();
    this.renderers.scopeOverlay.destroy();
    this.renderers.utilityChargeIndicator.destroy();
    this.renderers.ultimateChargeIndicator.destroy();
    this.renderers.gaussWarning.destroy();
    this.renderers.tunnelRenderer.destroy();
    this.renderers.placementPreview.clearForTeardown();
  }
}
