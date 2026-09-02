import { describe, expect, it, vi } from 'vitest';
import {
  ArenaAimPresentationController,
  type ArenaAimPresentationRendererPort,
} from '../src/scenes/arena/ArenaAimPresentationController';
import {
  ArenaCombatPresentationController,
  type ArenaCombatPresentationSourcePort,
} from '../src/scenes/arena/ArenaCombatPresentationController';

const scopeConfig = {
  scopeInMs: 500,
  fullScopeViewRadius: 80,
  edgeSoftnessPx: 24,
  unscopedSpreadDeg: 30,
  unscopeSpeedMs: 200,
};

function makeAimController() {
  const aimSystem = {
    setScopeProgress: vi.fn(),
    setScoping: vi.fn(),
    setWeaponChargeProgress: vi.fn(),
    update: vi.fn(),
    getGraphicsCommandCount: vi.fn(() => 17),
    destroy: vi.fn(),
  };
  const scopeOverlay = {
    update: vi.fn(),
    getPerformanceMetrics: vi.fn(() => ({ totalMs: 0, rasterMs: 0, uploadMs: 0, refreshed: false, texturePixels: 0 })),
    setPerformanceMetricsEnabled: vi.fn(),
    destroy: vi.fn(),
  };
  const utilityChargeIndicator = { update: vi.fn(), destroy: vi.fn() };
  const ultimateChargeIndicator = { update: vi.fn(), destroy: vi.fn() };
  const placementPreview = {
    syncUtilityTargetingHint: vi.fn(),
    syncAirstrikeTargetingHint: vi.fn(),
    syncPlaceableUtilityHint: vi.fn(),
    renderPlacementPreview: vi.fn(),
    renderRemotePlacementPreviews: vi.fn(),
    showPlacementError: vi.fn(),
    clearForTeardown: vi.fn(),
  };
  const tunnelRenderer = { sync: vi.fn(), update: vi.fn(), destroy: vi.fn() };
  const gaussWarning = { update: vi.fn(), destroy: vi.fn() };
  const renderers = {
    aimSystem,
    scopeOverlay,
    utilityChargeIndicator,
    ultimateChargeIndicator,
    placementPreview,
    tunnelRenderer,
    gaussWarning,
  } as unknown as ArenaAimPresentationRendererPort;
  const utilityTargeting = { angle: 0.2, targetX: 400, targetY: 300 };
  const ultimatePreview = {
    angle: 0.4,
    chargeFraction: 0.8,
    cooldownFrac: 0,
    isBlocked: false,
    minThrowSpeed: 0,
    maxThrowSpeed: 600,
    range: 900,
    reticleStyle: 'gauss' as const,
  };
  const placement = {
    angle: 0,
    targetX: 500,
    targetY: 350,
    gridX: 4,
    gridY: 3,
    isValid: true,
    frame: 0,
    range: 100,
    kind: 'rock' as const,
  };
  const input = {
    getUtilityTargetingPreviewState: vi.fn(() => utilityTargeting),
    getAirstrikeTargetingPreviewState: vi.fn(() => undefined),
    getConstructionPlacementPreviewState: vi.fn(() => undefined),
    getUltimateChargePreviewState: vi.fn(() => ultimatePreview),
    getUtilityChargePreviewState: vi.fn(() => undefined),
    getScopeProgress: vi.fn(() => 0.75),
    isScoping: vi.fn(() => true),
    getScopeChargeProgress: vi.fn(() => 0.4),
    getWeapon2ScopeConfig: vi.fn(() => scopeConfig),
  };
  const bindings = {
    getLocalPlacementPreview: vi.fn(() => placement),
    getLocalUltimatePlacementPreview: vi.fn(() => undefined),
    getAimPresentationState: vi.fn(() => ({ aimVisible: true, cursorVisible: true })),
  };
  const world = {
    syncPersistentBasePresentation: vi.fn(),
    getTunnelSnapshot: vi.fn(() => []),
  };
  const controller = new ArenaAimPresentationController(input, bindings, world, renderers);
  return { controller, aimSystem, scopeOverlay, placementPreview, tunnelRenderer, gaussWarning, world, utilityTargeting, ultimatePreview, placement };
}

describe('ArenaAimPresentationController', () => {
  it('führt Aim, Scope, Hinweise und Tunnel als einen reinen Präsentationsschritt aus', () => {
    const harness = makeAimController();
    const result = harness.controller.sync({
      inArena: true,
      worldInteractive: true,
      spectator: false,
      optionsOpen: false,
      delta: 16,
      now: 1234,
      localPlayerAlive: true,
      localPlayerBurrowed: false,
      scopeCursorX: 640,
      scopeCursorY: 360,
    }, null);

    expect(result).toEqual({ showAim: true, scopeProgress: 0.75, utilityPlacementActive: true, ultimatePlacementActive: false });
    expect(harness.world.syncPersistentBasePresentation).toHaveBeenCalledWith(true, false);
    expect(harness.aimSystem.update).toHaveBeenCalledWith(true, true, 16, harness.utilityTargeting, harness.ultimatePreview);
    expect(harness.scopeOverlay.update).toHaveBeenCalledWith(0.75, 640, 360, 16, scopeConfig);
    expect(harness.placementPreview.renderPlacementPreview).toHaveBeenCalledWith(true, harness.placement, true, false);
    expect(harness.tunnelRenderer.sync).toHaveBeenCalledWith([]);
    expect(harness.tunnelRenderer.update).toHaveBeenCalledWith(1234);
  });

  it('macht seine scene-langlebigen Präsentationsressourcen nach Destroy inert', () => {
    const harness = makeAimController();
    harness.controller.destroy();
    harness.controller.destroy();
    const callsAfterDestroy = harness.aimSystem.update.mock.calls.length;
    harness.controller.sync({
      inArena: true,
      worldInteractive: true,
      spectator: false,
      optionsOpen: false,
      delta: 16,
      now: 1234,
      localPlayerAlive: true,
      localPlayerBurrowed: false,
      scopeCursorX: 0,
      scopeCursorY: 0,
    }, null);
    expect(harness.aimSystem.update.mock.calls.length).toBe(callsAfterDestroy);
    expect(harness.aimSystem.destroy).toHaveBeenCalledTimes(1);
    expect(harness.placementPreview.clearForTeardown).toHaveBeenCalledTimes(1);
  });
});

function makeCombatController() {
  const renderers = {
    beer: { update: vi.fn() },
    timeBubble: { update: vi.fn() },
    blackHole: { update: vi.fn() },
    bfg: { update: vi.fn() },
    plasmaBurner: { update: vi.fn() },
    reinforcementMatrix: { syncVisuals: vi.fn() },
    energyInjector: { syncVisuals: vi.fn() },
    remoteControl: { syncVisuals: vi.fn() },
    teslaDome: { update: vi.fn() },
    teslaNova: { update: vi.fn() },
    healingAura: { syncEnemies: vi.fn(), update: vi.fn() },
    miniTeslaDome: { syncEnemies: vi.fn(), update: vi.fn() },
    energyShield: { update: vi.fn() },
    guardianSpirit: { update: vi.fn() },
    repairDrone: { update: vi.fn() },
    slimeTrail: { update: vi.fn() },
    flamethrowerUpgrades: { update: vi.fn() },
    ak47StrategicTargets: { sync: vi.fn() },
  };
  const sources = {
    getSynchronizedNow: vi.fn(() => 1000),
    updateVisualFeedback: vi.fn(),
    getReinforcementMatrices: vi.fn(() => []),
    getEnergyInjectorEffects: vi.fn(() => []),
    getRemoteControlTargets: vi.fn(() => []),
    getEnemyVisuals: vi.fn(() => []),
    syncEnemyHostVisuals: vi.fn(),
    getEnemyCount: vi.fn(() => 4),
    getStrategicTargets: vi.fn(() => []),
    getStrategicTargetEnemy: vi.fn(() => null),
    getLocalPlayerId: vi.fn(() => 'local'),
  } as unknown as ArenaCombatPresentationSourcePort;
  const controller = new ArenaCombatPresentationController(renderers, sources);
  return { controller, renderers, sources };
}

describe('ArenaCombatPresentationController', () => {
  it('sequenziert allgemeine Kampf-/FX-Darstellung über Source-Ports', () => {
    const harness = makeCombatController();
    harness.controller.sync({ inArena: true, delta: 16 }, null);

    expect(harness.renderers.beer.update).toHaveBeenCalledWith(1000, 16);
    expect(harness.renderers.reinforcementMatrix.syncVisuals).toHaveBeenCalledWith([], 1000);
    expect(harness.renderers.remoteControl.syncVisuals).toHaveBeenCalledWith([], 1000);
    expect(harness.renderers.healingAura.syncEnemies).toHaveBeenCalledWith([]);
    expect(harness.renderers.energyShield.update).toHaveBeenCalledWith(16);
    expect(harness.sources.syncEnemyHostVisuals).toHaveBeenCalledTimes(1);
    expect(harness.controller.getEnemyCount()).toBe(4);
  });

  it('führt nach Destroy keinen weiteren Präsentationsschritt aus', () => {
    const harness = makeCombatController();
    harness.controller.destroy();
    harness.controller.sync({ inArena: true, delta: 16 }, null);
    expect(harness.renderers.beer.update).not.toHaveBeenCalled();
    expect(harness.sources.updateVisualFeedback).not.toHaveBeenCalled();
  });

  it('ordnet Strategic Targets dem Combat-Presentation-Controller zu', () => {
    const harness = makeCombatController();
    harness.controller.syncStrategicTargets(true);

    expect(harness.sources.getStrategicTargets).toHaveBeenCalledWith(1000);
    expect(harness.renderers.ak47StrategicTargets.sync).toHaveBeenCalledWith(
      [],
      null,
      'local',
      1000,
      true,
    );
  });
});
