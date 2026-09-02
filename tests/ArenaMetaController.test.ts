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
  resultRead: ArenaMetaControllerInput['resultRead'];
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
    addCoopDefenseXp: vi.fn(),
    markCoopDefenseRoundProcessed: vi.fn(),
    markCoopDefenseBossMapCompleted: vi.fn(),
    unlockCoopDefenseClassesAfterVictory: vi.fn(),
    unlockCoopDefenseMapAfterVictory: vi.fn(),
    unlockPersistentBaseAfterVictory: vi.fn(),
    unlockPersistentBaseAreaStageAfterVictory: vi.fn(),
    setPersistentBaseUnlocked: vi.fn(),
    setPersistentBaseAreaStage: vi.fn(),
    grantPersistentBaseRewards: vi.fn(),
    setItemsUnlocked: vi.fn(),
    unlockItemsAfterVictory: vi.fn(),
    markItemsSeen: vi.fn(),
    equipItem: vi.fn(),
    unequipItem: vi.fn(),
    salvageItem: vi.fn(),
    setPendingItemReward: vi.fn(),
    claimPendingItemReward: vi.fn(),
  };
  const loadout: Record<string, string> = {};
  const session: ArenaMetaControllerInput['session'] = {
    getGamePhase: vi.fn(() => 'LOBBY'),
    getGameMode: vi.fn(() => 'coop_defense'),
    getLocalPlayerId: vi.fn(() => 'local'),
    isHost: vi.fn(() => true),
    getCoopDefenseMapId: vi.fn(() => '1'),
    setCoopDefenseMapId: vi.fn(),
    isLocalReady: vi.fn(() => false),
    isAuthoritativeLocalReady: vi.fn(() => false),
    getPlayerLoadoutSlot: vi.fn((_playerId, slot) => loadout[slot]),
    setLocalLoadoutSlot: vi.fn((slot, itemId) => { loadout[slot] = itemId; }),
    setLocalReady: vi.fn(),
    setLocalCoopDefenseTotalXp: vi.fn(),
  };
  const resultRead: ArenaMetaControllerInput['resultRead'] = {
    getRoundResults: vi.fn(() => null),
    getRoundState: vi.fn(() => null),
    isLocalRoundResultEligible: vi.fn(() => true),
    getCoopDefenseRoundXp: vi.fn(() => 0),
    getLocalCommittedLoadout: vi.fn(() => null),
  };
  const presentation: ArenaMetaControllerInput['presentation'] = {
    setCoopDefenseProgress: vi.fn(),
    refreshUpgradeOverlay: vi.fn(),
    scheduleUpgradeOverlayRefresh: vi.fn(),
    refreshColorIndicator: vi.fn(),
    hideDebugOverlay: vi.fn(),
    showUpgradeOverlay: vi.fn(),
    setCoopDefenseItemsState: vi.fn(),
    showItemsOverlay: vi.fn(),
    refreshItemsOverlay: vi.fn(),
    isItemsOverlayOpen: vi.fn(() => false),
    showItemRewardOverlay: vi.fn(),
    isItemRewardOverlayVisible: vi.fn(() => false),
    showMatchResultsSyncing: vi.fn(),
    hideMatchResults: vi.fn(),
    showMatchResults: vi.fn(),
    showMatchResultsReplay: vi.fn(),
    isMatchResultsVisible: vi.fn(() => false),
    setMatchResultsBalanceFeedbackVisible: vi.fn(),
    showMatchResultsTechnicalAbort: vi.fn(),
    setResultsReplayAvailable: vi.fn(),
  };
  return {
    controller: new ArenaMetaController({ progressStore: store, session, resultRead, presentation }),
    store,
    session,
    resultRead,
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

  it('besitzt Item-Use-Cases und aktualisiert die Lobby-Projektion ueber Ports', () => {
    const { controller, store, presentation } = makeInput();

    vi.mocked(store.equipItem).mockReturnValue(true);
    vi.mocked(store.unequipItem).mockReturnValue(true);
    vi.mocked(store.salvageItem).mockReturnValue(7);

    expect(controller.getItemsOverlayState().pendingRewardCount).toBe(0);
    expect(controller.equipItem('item-1')).toBe(true);
    expect(controller.unequipItem('armor')).toBe(true);
    expect(controller.salvageItem('item-1')).toBe(7);

    expect(store.equipItem).toHaveBeenCalledWith('item-1');
    expect(store.unequipItem).toHaveBeenCalledWith('armor');
    expect(store.salvageItem).toHaveBeenCalledWith('item-1');
    expect(presentation.setCoopDefenseItemsState).toHaveBeenCalled();
    expect(presentation.refreshUpgradeOverlay).toHaveBeenCalledTimes(3);
  });

  it('verarbeitet autoritative Match Results und dedupliziert persoenliche Verbuchung', () => {
    const { controller, store, resultRead, presentation } = makeInput();
    let current = getStoredCoopDefenseProgress();
    vi.mocked(store.getProgress).mockImplementation(() => current);
    vi.mocked(store.addCoopDefenseXp).mockImplementation((amount) => {
      current = { ...current, totalXp: current.totalXp + amount };
      return current.totalXp;
    });
    vi.mocked(store.markCoopDefenseRoundProcessed).mockImplementation((endedAt) => {
      current = { ...current, lastProcessedRoundEndedAt: endedAt };
    });
    vi.mocked(resultRead.getRoundResults).mockReturnValue([{
      id: 'local',
      name: 'Local',
      colorHex: 0xffffff,
      frags: 0,
      teamId: null,
      roundEndedAt: 42,
      gameMode: 'coop_defense',
      mapName: 'Map 1',
      sharedXp: 25,
    }]);
    vi.mocked(resultRead.getRoundState).mockReturnValue({
      status: 'defeat',
      roundStartTime: 1,
      coopDefenseMapId: '1',
      endedAt: 42,
    });

    controller.refresh();
    controller.beginMatchResults();
    controller.tryFinalizeMatchResults();
    controller.beginMatchResults();
    controller.tryFinalizeMatchResults();

    expect(store.addCoopDefenseXp).toHaveBeenCalledTimes(1);
    expect(store.markCoopDefenseRoundProcessed).toHaveBeenCalledTimes(1);
    expect(presentation.showMatchResults).toHaveBeenCalledTimes(2);
    expect(controller.getLastMatchResultsPresentation()?.progress?.xpGained).toBe(0);

    controller.replayMatchResults();
    expect(presentation.showMatchResultsReplay).toHaveBeenCalledTimes(1);
    expect(store.addCoopDefenseXp).toHaveBeenCalledTimes(1);
  });

  it('entkoppelt Phase-4A-Ownership von ArenaScene und Netzwerk-Substrat', () => {
    const scene = read('src/scenes/ArenaScene.ts');
    const controller = read('src/scenes/arena/ArenaMetaController.ts');

    expect(scene).not.toContain('getStoredCoopDefenseProgress');
    expect(scene).not.toContain('setStoredCoopDefenseUpgradeProfile');
    expect(scene).not.toContain('setStoredCoopDefenseLoadoutSlot');
    expect(scene).not.toContain('setStoredCoopDefenseItemsUnlocked');
    expect(scene).not.toContain('setStoredPendingCoopDefenseItemReward');
    expect(scene).not.toContain('claimStoredPendingCoopDefenseItemReward');
    expect(scene).not.toContain('equipStoredCoopDefenseItem');
    expect(scene).not.toContain('unequipStoredCoopDefenseItem');
    expect(scene).not.toContain('salvageStoredCoopDefenseItem');
    expect(scene).not.toContain('unlockStoredCoopDefenseItemsAfterVictory');
    expect(scene).not.toContain('addStoredCoopDefenseXp');
    expect(scene).not.toContain('markStoredCoopDefenseRoundProcessed');
    expect(scene).not.toContain('unlockStoredPersistentBaseAfterVictory');
    expect(scene).not.toContain('matchResultsPending');
    expect(scene).not.toContain('lastMatchResultsPresentation');
    expect(scene).not.toContain('processCoopDefenseRoundProgress');
    expect(scene).not.toContain('createMatchItemRewardPresentation');
    expect(scene).not.toContain('levelUpCoopDefenseUpgrade(');
    expect(scene).not.toContain('resyncLoadoutWithUnlocks');
    expect(controller).not.toContain("from '../../network/bridge'");
    expect(controller).not.toContain('ArenaScene');
    expect(controller).toContain('resultRead');
    expect(controller).toContain('destroy(): void');
  });
});
