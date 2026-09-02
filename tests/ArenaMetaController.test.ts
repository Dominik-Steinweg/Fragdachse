import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ArenaMetaController,
  type ArenaMetaControllerInput,
} from '../src/scenes/arena/ArenaMetaController';
import { getStoredCoopDefenseProgress } from '../src/utils/localPreferences';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function makeInput(): {
  controller: ArenaMetaController;
  store: ArenaMetaControllerInput['progressStore'];
  session: ArenaMetaControllerInput['session'];
  presentation: ArenaMetaControllerInput['presentation'];
} {
  const stored = getStoredCoopDefenseProgress();
  const store: ArenaMetaControllerInput['progressStore'] = {
    getProgress: vi.fn(() => stored),
    restoreProgress: vi.fn(),
    getClassLoadout: vi.fn(() => ({})),
    setClassLoadoutSlot: vi.fn(),
    setSharedLoadoutSlot: vi.fn(),
    switchClassLoadout: vi.fn(),
    setUpgradeProfile: vi.fn(),
    resetUpgradeProfiles: vi.fn(),
    setDebugProgress: vi.fn(),
    resetCharacter: vi.fn(),
  };
  const loadout: Record<string, string> = {};
  const session: ArenaMetaControllerInput['session'] = {
    getGamePhase: vi.fn(() => 'LOBBY'),
    getGameMode: vi.fn(() => 'coop_defense'),
    getLocalPlayerId: vi.fn(() => 'local'),
    isLocalReady: vi.fn(() => false),
    isAuthoritativeLocalReady: vi.fn(() => false),
    getPlayerLoadoutSlot: vi.fn((_playerId, slot) => loadout[slot]),
    setLocalLoadoutSlot: vi.fn((slot, itemId) => { loadout[slot] = itemId; }),
    setLocalReady: vi.fn(),
    setLocalCoopDefenseTotalXp: vi.fn(),
  };
  const presentation: ArenaMetaControllerInput['presentation'] = {
    setCoopDefenseProgress: vi.fn(),
    refreshUpgradeOverlay: vi.fn(),
    scheduleUpgradeOverlayRefresh: vi.fn(),
    refreshColorIndicator: vi.fn(),
    hideDebugOverlay: vi.fn(),
    showUpgradeOverlay: vi.fn(),
  };
  return {
    controller: new ArenaMetaController({ progressStore: store, session, presentation }),
    store,
    session,
    presentation,
  };
}

describe('ArenaMetaController', () => {
  it('leitet Progress-Readstand und Loadout-Reconciliation ueber kleine Ports', () => {
    const { controller, session, presentation } = makeInput();

    controller.refresh();

    expect(session.setLocalCoopDefenseTotalXp).toHaveBeenCalledWith(0);
    expect(session.setLocalLoadoutSlot).toHaveBeenCalled();
    expect(presentation.setCoopDefenseProgress).toHaveBeenCalledWith(controller.getProgress());
    expect(presentation.refreshUpgradeOverlay).toHaveBeenCalledTimes(1);
  });

  it('ist nach idempotentem Teardown inert', () => {
    const { controller, store, presentation } = makeInput();

    controller.destroy();
    controller.destroy();
    controller.setDebugProgress(100, 2, 'coop_defense_01');
    controller.resetCharacter();
    controller.refresh();

    expect(store.setDebugProgress).not.toHaveBeenCalled();
    expect(store.resetCharacter).not.toHaveBeenCalled();
    expect(presentation.refreshUpgradeOverlay).not.toHaveBeenCalled();
  });

  it('entkoppelt Phase-4A-Ownership von ArenaScene und Netzwerk-Substrat', () => {
    const scene = read('src/scenes/ArenaScene.ts');
    const controller = read('src/scenes/arena/ArenaMetaController.ts');

    expect(scene).not.toContain('getStoredCoopDefenseProgress');
    expect(scene).not.toContain('setStoredCoopDefenseUpgradeProfile');
    expect(scene).not.toContain('setStoredCoopDefenseLoadoutSlot');
    expect(scene).not.toContain('levelUpCoopDefenseUpgrade(');
    expect(scene).not.toContain('resyncLoadoutWithUnlocks');
    expect(controller).not.toContain("from '../../network/bridge'");
    expect(controller).not.toContain('ArenaScene');
    expect(controller).toContain('destroy(): void');
  });
});
