import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Input: {
    Keyboard: {
      KeyCodes: { A: 65, D: 68, W: 87, S: 83, TAB: 9, K: 75 },
      JustDown: (key: FakeKey) => key.justDown,
    },
  },
}));

import {
  ArenaInputBindings,
  type ArenaInputBindingsInput,
} from '../src/scenes/arena/ArenaInputBindings';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { planFireControlCopies, type FireControlConstructionFacts } from '../src/systems/fireControl/FireControlCopyPlan';
import { t } from '../src/i18n';

interface FakeKey {
  isDown: boolean;
  justDown: boolean;
}

type HotkeyHandler = (event: KeyboardEvent) => void;

function makeInput(): {
  binding: ArenaInputBindings;
  actions: ArenaInputBindingsInput['actions'];
  inputSystem: Record<string, ReturnType<typeof vi.fn>>;
  keyboard: {
    addKey: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    removeKey: ReturnType<typeof vi.fn>;
  };
  keys: FakeKey[];
  handlers: Map<string, HotkeyHandler>;
  debugCallback: { current: ((type: 'flowfield_bases' | 'flowfield_players') => void) | null };
  hotkeys: ArenaInputBindingsInput['hotkeys'];
  onFlowFieldDebugHotkey: ReturnType<typeof vi.fn>;
} {
  const keys: FakeKey[] = [];
  const handlers = new Map<string, HotkeyHandler>();
  const debugCallback = { current: null as ((type: 'flowfield_bases' | 'flowfield_players') => void) | null };
  const keyboard = {
    addKey: vi.fn(() => {
      const key: FakeKey = { isDown: false, justDown: false };
      keys.push(key);
      return key;
    }),
    on: vi.fn((event: string, handler: HotkeyHandler) => handlers.set(event, handler)),
    off: vi.fn(),
    removeKey: vi.fn(),
  };
  const inputSystem = {
    setup: vi.fn(),
    setAudioSystem: vi.fn(),
    setupUtilityConfigProvider: vi.fn(),
    setupUtilityCooldownProvider: vi.fn(),
    setupUltimateConfigProvider: vi.fn(),
    setupLocalRageProvider: vi.fn(),
    setupWeapon2ConfigProvider: vi.fn(),
    setupRadialActionProviders: vi.fn(),
    setupTemporaryUtilityProvider: vi.fn(),
    setupPersistentRewardActionProvider: vi.fn(),
    setupRepositionActionProvider: vi.fn(),
    setupCanStartScopeCheck: vi.fn(),
    setupUtilityPlacementPreviewProvider: vi.fn(),
    setupUltimatePlacementPreviewProvider: vi.fn(),
    setupConstructionPlacementPreviewProvider: vi.fn(),
    setupTranslocatorRecallCheck: vi.fn(),
    setupLoadoutListener: vi.fn(),
    handleUtilityChargeResult: vi.fn(),
    handleTunnelActionResult: vi.fn(),
    getSelectedRadialActionForHud: vi.fn(() => null),
    getSelectedUtilityCooldownUntil: vi.fn(() => 0),
    isUtilityPlacementActive: vi.fn(() => false),
    isUltimatePlacementActive: vi.fn(() => false),
    getUltimatePlacementAnchor: vi.fn(() => null),
    cancelLocalUltimateChargePreview: vi.fn(),
    onUtilityPressedDuringCooldown: null,
    onUltimatePressedWithoutRage: null,
    setupDebugHotkeys: vi.fn((callback: (type: 'flowfield_bases' | 'flowfield_players') => void) => {
      debugCallback.current = callback;
    }),
  };
  const hotkeys = {
    getGamePhase: vi.fn(() => 'LOBBY'),
    isMatchTerminated: vi.fn(() => false),
    isCoopDefenseMode: vi.fn(() => false),
    canLeaveLocalLobbyWorld: vi.fn(() => true),
    requestLocalLobbyWorldLeave: vi.fn(),
    isHotkeyInputBlocked: vi.fn(() => false),
    isHelpOverlayOpen: vi.fn(() => false),
    hideHelpOverlay: vi.fn(),
    isOptionsOverlayOpen: vi.fn(() => false),
    hideOptionsOverlay: vi.fn(),
    toggleOptionsOverlay: vi.fn(),
    isCoopDefenseUpgradesOpen: vi.fn(() => false),
    hideCoopDefenseUpgrades: vi.fn(),
    isCoopDefenseDebugOpen: vi.fn(() => false),
    hideCoopDefenseDebug: vi.fn(),
    toggleCoopDefenseDebug: vi.fn(),
    isItemsOpen: vi.fn(() => false),
    hideItems: vi.fn(),
    isItemRewardVisible: vi.fn(() => false),
    hideItemReward: vi.fn(),
    isMatchResultsVisible: vi.fn(() => false),
    hideMatchResults: vi.fn(),
    isRoomStatisticsVisible: vi.fn(() => false),
    hideRoomStatistics: vi.fn(),
    isWeaponBalanceLabOpen: vi.fn(() => false),
    hideWeaponBalanceLab: vi.fn(),
    toggleWeaponBalanceLab: vi.fn(),
    isNetDebugOpen: vi.fn(() => false),
    hideNetDebug: vi.fn(),
    toggleNetDebug: vi.fn(),
    isPerformanceOverlayOpen: vi.fn(() => false),
    hidePerformanceOverlay: vi.fn(),
    togglePerformanceOverlay: vi.fn(),
    isTimeOfDayDebugOpen: vi.fn(() => false),
    hideTimeOfDayDebug: vi.fn(),
    toggleTimeOfDayDebug: vi.fn(),
  } as ArenaInputBindingsInput['hotkeys'];
  const actions = {
    getLocalUtilityConfig: vi.fn(() => undefined),
    getLocalUtilityCooldownUntil: vi.fn(() => 0),
    getLocalUltimateConfig: vi.fn(() => undefined),
    getLocalRage: vi.fn(() => 0),
    getLocalWeaponConfig: vi.fn(() => undefined),
    getLocalWeaponAdrenalineCost: vi.fn(() => 0),
    getLocalAdrenaline: vi.fn(() => 0),
    getLocalInspectorTools: vi.fn(() => []),
    getLocalConstructionCapacity: vi.fn(() => 0),
    getWeaponLastFired: vi.fn(() => 0),
    notifyLoadoutFired: vi.fn(() => ({ fired: false })),
    rollbackRejectedLoadoutFire: vi.fn(),
    notifyUtilityFired: vi.fn(),
    beginPredictedWeapon2Use: vi.fn(),
    getLocalPlayerId: vi.fn(() => 'local'),
    getActiveGameMode: vi.fn(() => 'deathmatch'),
    isHost: vi.fn(() => false),
    getSynchronizedNow: vi.fn(() => 0),
    getPlayerCurrentLoadoutSnapshot: vi.fn(() => null),
    getPlayerUtilityCooldownUntil: vi.fn(() => 0),
    getPlayerTemporaryUtilityInstances: vi.fn(() => []),
    sendLoadoutUse: vi.fn(async () => null),
    getPlayerCapabilities: vi.fn(() => ({
      canInteract: false,
      canUseCombat: false,
      canPlace: false,
      canDismantle: false,
    })),
    isLocalPlayerAlive: vi.fn(() => false),
    isLocalPlayerBurrowed: vi.fn(() => false),
    getLocalPlayerPosition: vi.fn(() => undefined),
    getPointerWorldPoint: vi.fn(() => ({ x: 0, y: 0 })),
    getConstructionCapacityForPlayer: vi.fn(() => undefined),
    getTranslocatorActivePuckId: vi.fn(() => undefined),
    placement: {
      getFireControlConstructions: vi.fn(() => []),
      isFireControlPointFree: vi.fn(() => true),
      getUsedCapacity: vi.fn(() => 0),
      getDismantlePreview: vi.fn(() => undefined),
      getPlacementPreview: vi.fn(() => undefined),
      getTunnelPlacementPreview: vi.fn(() => undefined),
      getConstructionPlacementPreview: vi.fn(() => undefined),
    },
    persistentBase: {
      getRewardIdsForPlayer: vi.fn(() => []),
      getRewardPlacementPreview: vi.fn(() => undefined),
      requestRewardPlacement: vi.fn(async () => ({ ok: false as const, reason: 'blocked' as const })),
      getMoveSourcePreview: vi.fn(() => undefined),
      getMoveTargetPreview: vi.fn(() => undefined),
      requestMove: vi.fn(async () => ({ ok: false as const, reason: 'blocked' as const })),
    },
    feedback: {
      notifyAdrenalineInsufficientShot: vi.fn(),
      flashUltimateInsufficientRage: vi.fn(),
      flashUtilityCooldown: vi.fn(),
      showPlacementError: vi.fn(),
    },
  } as unknown as ArenaInputBindingsInput['actions'];
  const onFlowFieldDebugHotkey = vi.fn();
  const input: ArenaInputBindingsInput = {
    scene: { input: { keyboard } } as unknown as ArenaInputBindingsInput['scene'],
    inputSystem: inputSystem as unknown as ArenaInputBindingsInput['inputSystem'],
    audioSystem: {} as ArenaInputBindingsInput['audioSystem'],
    actions,
    onFlowFieldDebugHotkey,
    hotkeys,
  };

  return {
    binding: new ArenaInputBindings(input),
    actions,
    inputSystem,
    keyboard,
    keys,
    handlers,
    debugCallback,
    hotkeys,
    onFlowFieldDebugHotkey,
  };
}

describe('ArenaInputBindings', () => {
  function fireControlFixture() {
    const f = makeInput();
    const config = applyCoopDefenseModifiersToUtilityConfig(UTILITY_CONFIGS.FIRE_CONTROL_RELAY, {
      additive: { 'utility.FIRE_CONTROL_RELAY.maxCopies': 2, 'utility.FIRE_CONTROL_RELAY.durationMs': 1000,
        'utility.FIRE_CONTROL_RELAY.parallelEnabled': 1 }, percentage: {},
    });
    if (config.type !== 'fire_control_relay') throw new Error('Expected relay fixture');
    const source = (id: number, overrides: Partial<FireControlConstructionFacts> = {}): FireControlConstructionFacts => ({
      id, ownerId: 'local', baseOwned: false, constructionId: 'machine_gun_turret', weaponId: 'TURRET_MG',
      weaponFireType: 'projectile', combatReady: true, manned: false, x: id * 10, y: 80, ...overrides,
    });
    const constructions = [source(8), source(7), source(6, { constructionId: 'rocket_turret', weaponId: 'TURRET_ROCKET' }),
      source(1, { ownerId: 'other' }), source(2, { baseOwned: true }), source(3, { manned: true }),
      source(4, { combatReady: false }), source(5, { constructionId: 'tesla_turret' })];
    vi.mocked(f.actions.getLocalUtilityConfig).mockReturnValue(config);
    vi.mocked(f.actions.getLocalPlayerPosition).mockReturnValue({ x: 0, y: 0 });
    vi.mocked(f.actions.getPointerWorldPoint).mockReturnValue({ x: 100, y: 0 });
    vi.mocked(f.actions.getLocalInspectorTools).mockReturnValue([
      { kind: 'construction', id: 'rocket_turret' }, { kind: 'utility', id: config.id },
      { kind: 'construction', id: 'machine_gun_turret' },
    ]);
    vi.mocked(f.actions.placement.getFireControlConstructions).mockReturnValue(constructions);
    f.inputSystem.isUtilityPlacementActive.mockReturnValue(true);
    return { ...f, config, constructions };
  }

  it.each(['valid', 'range', 'invalid', 'no_fire_sources', 'placement'] as const)(
    'projects the shared copy plan and its %s result without placeable casts', outcome => {
      const f = fireControlFixture();
      if (outcome === 'range') vi.mocked(f.actions.getPointerWorldPoint).mockReturnValue({ x: f.config.placementRangePx + 1, y: 0 });
      if (outcome === 'invalid') vi.mocked(f.actions.getPointerWorldPoint).mockReturnValue({ x: NaN, y: 0 });
      if (outcome === 'no_fire_sources') vi.mocked(f.actions.placement.getFireControlConstructions).mockReturnValue(f.constructions.slice(3));
      if (outcome === 'placement') vi.mocked(f.actions.placement.isFireControlPointFree).mockReturnValue(false);
      const point = f.actions.getPointerWorldPoint();
      const plan = planFireControlCopies({ ownerId: 'local', playerX: 0, playerY: 0, pointX: point.x, pointY: point.y,
        constructions: f.actions.placement.getFireControlConstructions(), slotOrder: ['rocket_turret', 'machine_gun_turret'],
        pausedOriginalIds: new Set(), config: { ...f.config, parallel: f.config.parallelEnabled > 0 },
        isPointFree: f.actions.placement.isFireControlPointFree });
      const preview = f.binding.getLocalPlacementPreview();
      expect(preview?.kind).toBe('fire_control_relay');
      if (preview?.kind !== 'fire_control_relay') throw new Error('Expected copy preview');
      expect(preview.valid).toBe(plan.ok);
      expect(preview.reason).toBe(outcome === 'valid' ? undefined : outcome);
      const ids = plan.ok ? plan.copies.map(copy => copy.originalId) : plan.candidates;
      expect(preview.originals).toEqual(ids.map(id => {
        const source = f.constructions.find(source => source.id === id)!;
        return { id, x: source.x, y: source.y };
      }));
      expect(preview.ghosts).toEqual(plan.ok ? plan.copies.map(copy => {
        const source = f.constructions.find(source => source.id === copy.originalId)!;
        return { x: copy.x, y: copy.y, constructionId: source.constructionId, weaponId: source.weaponId };
      }) : []);
      expect(preview.originals.every(source => [6, 7, 8].includes(source.id))).toBe(true);
      if (plan.ok) expect(preview.originals.map(source => source.id)).toEqual([6, 8, 7]);
      expect(f.actions.placement.getPlacementPreview).not.toHaveBeenCalled();
    },
  );

  it.each(['range', 'placement', 'invalid', 'no_fire_sources'] as const)(
    'uses the host failure text for local %s rejection', async reason => {
      const f = fireControlFixture();
      vi.mocked(f.actions.getPlayerCapabilities).mockReturnValue({ canInteract: true, canUseCombat: true } as never);
      vi.mocked(f.actions.isLocalPlayerAlive).mockReturnValue(true);
      const hostReason = reason === 'range' ? 'placement' : reason;
      vi.mocked(f.actions.sendLoadoutUse).mockResolvedValue({ ok: false, reason: hostReason });
      f.binding.setup();
      (f.inputSystem.onInvalidFireControlPlacement as unknown as (reason: string) => void)(reason);
      expect(f.actions.sendLoadoutUse).not.toHaveBeenCalled();
      const showError = vi.mocked(f.actions.feedback.showPlacementError);
      const localText = showError.mock.calls[0][0];
      const use = f.inputSystem.setupLoadoutListener.mock.calls[0][0];
      use('utility', 0, 100, 0, { toolRef: { kind: 'utility', id: 'FIRE_CONTROL_RELAY' } });
      await Promise.resolve();
      expect(showError).toHaveBeenCalledTimes(2);
      expect(showError).toHaveBeenLastCalledWith(localText);
      if (reason === 'no_fire_sources') expect(localText).toBe(t('ui.errors.no_fire_sources'));
    },
  );

  it('awaits first tunnel selection approval and forwards cleanup across input gates', async () => {
    const { binding, actions, inputSystem } = makeInput();
    vi.mocked(actions.getPlayerCapabilities).mockReturnValue({ canInteract: true, canUseCombat: true } as never);
    vi.mocked(actions.isLocalPlayerAlive).mockReturnValue(true);
    vi.mocked(actions.sendLoadoutUse).mockResolvedValue({ ok: false, reason: 'placement' });
    binding.setup();
    const use = inputSystem.setupLoadoutListener.mock.calls[0][0];
    const params = { tunnelAction: 'begin', tunnelPlacementId: 'selected', tunnelStartGridX: 1, tunnelStartGridY: 2 };
    use('ultimate', 0, 100, 0, params);
    await Promise.resolve();
    expect(actions.sendLoadoutUse).toHaveBeenCalledWith('ultimate', 0, 100, 0, undefined, params,
      undefined, undefined, true, undefined);
    expect(inputSystem.handleTunnelActionResult).toHaveBeenCalledWith(params, { ok: false, reason: 'placement' });
    vi.mocked(actions.getPlayerCapabilities).mockReturnValue({ canInteract: false } as never);
    const cancel = { tunnelAction: 'cancel', tunnelPlacementId: 'selected' };
    use('ultimate', 0, 0, 0, cancel);
    expect(actions.sendLoadoutUse).toHaveBeenLastCalledWith('ultimate', 0, 0, 0, undefined, cancel);
  });

  it('verdrahtet statische InputSystem-Provider und Arena-Tasten', () => {
    const { binding, inputSystem, keyboard, keys, debugCallback, onFlowFieldDebugHotkey } = makeInput();

    binding.setup();

    expect(inputSystem.setup).toHaveBeenCalledTimes(1);
    expect(inputSystem.setAudioSystem).toHaveBeenCalledTimes(1);
    expect(inputSystem.setupUtilityConfigProvider).toHaveBeenCalledTimes(1);
    expect(inputSystem.setupUtilityCooldownProvider).toHaveBeenCalledTimes(1);
    expect(inputSystem.setupUltimateConfigProvider).toHaveBeenCalledTimes(1);
    expect(inputSystem.setupLocalRageProvider).toHaveBeenCalledTimes(1);
    expect(inputSystem.setupWeapon2ConfigProvider).toHaveBeenCalledTimes(1);
    expect(inputSystem.setupDebugHotkeys).toHaveBeenCalledTimes(1);
    expect(keyboard.addKey).toHaveBeenCalledTimes(6);
    expect(keyboard.on).toHaveBeenCalledTimes(7);

    debugCallback.current?.('flowfield_players');
    expect(onFlowFieldDebugHotkey).toHaveBeenCalledWith('flowfield_players');
  });

  it('routes Escape on results to the normal continuation without leaving the lobby World', () => {
    const { binding, handlers, hotkeys } = makeInput();
    binding.setup();
    vi.mocked(hotkeys.isMatchResultsVisible).mockReturnValue(true);
    const event = { repeat: false, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    handlers.get('keydown-ESC')?.(event);
    expect(hotkeys.hideMatchResults).toHaveBeenCalledOnce();
    expect(hotkeys.requestLocalLobbyWorldLeave).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    binding.destroy();
  });

  it('respektiert ESC-Blockierung und entfernt eigene Listener/Keys idempotent', () => {
    const { binding, keyboard, keys, handlers, hotkeys, debugCallback, onFlowFieldDebugHotkey } = makeInput();
    binding.setup();

    const event = { repeat: false, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    hotkeys.isOptionsOverlayOpen = vi.fn(() => true);
    handlers.get('keydown-ESC')?.(event);
    expect(hotkeys.hideOptionsOverlay).toHaveBeenCalledTimes(1);
    expect(hotkeys.requestLocalLobbyWorldLeave).not.toHaveBeenCalled();

    hotkeys.isOptionsOverlayOpen = vi.fn(() => false);
    handlers.get('keydown-ESC')?.(event);
    expect(hotkeys.requestLocalLobbyWorldLeave).toHaveBeenCalledTimes(1);

    binding.destroy();
    binding.destroy();
    expect(keyboard.off).toHaveBeenCalledTimes(7);
    expect(keyboard.removeKey).toHaveBeenCalledTimes(keys.length);
    debugCallback.current?.('flowfield_bases');
    expect(onFlowFieldDebugHotkey).not.toHaveBeenCalled();
    expect(binding.isArenaPanelHeld()).toBe(false);
  });

});

it('awaits and reconciles rechargeable HE uses in the normal utility slot', async () => {
  const { binding, inputSystem, actions } = makeInput();
  const { UTILITY_CONFIGS } = await import('../src/loadout/LoadoutConfig');
  vi.mocked(actions.getLocalUtilityConfig).mockReturnValue(UTILITY_CONFIGS.HE_GRENADE);
  vi.mocked(actions.getPlayerCapabilities).mockReturnValue({ canInteract: true, canUseCombat: true } as never);
  vi.mocked(actions.isLocalPlayerAlive).mockReturnValue(true);
  const reply = { ok: true };
  vi.mocked(actions.sendLoadoutUse).mockResolvedValue(reply);
  binding.setup();
  inputSystem.setupLoadoutListener.mock.calls[0][0]('utility', 0, 100, 0, { attemptId: 'he-attempt', heldActionId: 'he-hold' });
  await Promise.resolve();
  expect(actions.sendLoadoutUse).toHaveBeenCalledWith('utility', 0, 100, 0, undefined,
    { attemptId: 'he-attempt', heldActionId: 'he-hold' }, undefined, undefined, true, undefined);
  expect(inputSystem.handleUtilityChargeResult).toHaveBeenCalledWith('he-attempt', reply);
});
