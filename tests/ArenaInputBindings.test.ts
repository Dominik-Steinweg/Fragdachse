import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

interface FakeKey {
  isDown: boolean;
  justDown: boolean;
}

type HotkeyHandler = (event: KeyboardEvent) => void;

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function makeInput(): {
  binding: ArenaInputBindings;
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
  const onFlowFieldDebugHotkey = vi.fn();
  const input: ArenaInputBindingsInput = {
    scene: { input: { keyboard } } as unknown as ArenaInputBindingsInput['scene'],
    inputSystem: inputSystem as unknown as ArenaInputBindingsInput['inputSystem'],
    audioSystem: {} as ArenaInputBindingsInput['audioSystem'],
    getLocalUtilityConfig: () => undefined,
    getLocalUtilityCooldownUntil: () => 0,
    getLocalUltimateConfig: () => undefined,
    getLocalRage: () => 0,
    getLocalWeapon2Config: () => undefined,
    onFlowFieldDebugHotkey,
    hotkeys,
  };

  return {
    binding: new ArenaInputBindings(input),
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
  it('besitzt Phase-3A-Keys und verdrahtet statische InputSystem-Provider', () => {
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

  it('trennt Phase-3A-Input von den bewusst verbleibenden Action-Callbacks', () => {
    const scene = read('src/scenes/ArenaScene.ts');
    const inputBindings = read('src/scenes/arena/ArenaInputBindings.ts');

    expect(scene).not.toContain('registerArenaPanelHotkeys');
    expect(scene).not.toContain('this.escapeHotkeyHandler');
    expect(scene).toContain('inputBindings.destroy();');
    expect(scene).toContain('this.lobbyOverlay?.destroy();');
    expect(scene).toContain('inputSystem.setupRadialActionProviders');
    expect(scene).toContain('inputSystem.setupLoadoutListener');
    expect(inputBindings).toContain('setupDebugHotkeys');
    expect(inputBindings).toContain('keyboard.removeKey(key, true, true)');
  });
});
