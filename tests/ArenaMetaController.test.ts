import { describe, expect, it, vi } from 'vitest';
import {
  ArenaMetaController,
  type ArenaMetaControllerInput,
} from '../src/scenes/arena/ArenaMetaController';
import { getStoredCoopDefenseProgress } from '../src/utils/localPreferences';
import { levelUpCoopDefenseUpgrade } from '../src/utils/coopDefenseUpgrades';
import { getCoopDefenseXpThresholdForLevel } from '../src/utils/coopDefenseProgression';

function makeInput(): {
  controller: ArenaMetaController;
  store: ArenaMetaControllerInput['progressStore'];
  session: ArenaMetaControllerInput['session'];
  resultRead: ArenaMetaControllerInput['resultRead'];
  presentation: ArenaMetaControllerInput['presentation'];
  playSound: ReturnType<typeof vi.fn>;
} {
  const stored = getStoredCoopDefenseProgress();
  const playSound = vi.fn();
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
    unlockPersistentBaseHealthAfterVictory: vi.fn(),
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
    controller: new ArenaMetaController({ progressStore: store, session, resultRead, presentation, playSound }),
    playSound,
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

  it('keeps the single tool selection authoritative across refresh and respec', () => {
    const { controller, store, session } = makeInput();
    const stored = getStoredCoopDefenseProgress();
    stored.defaultProfile = levelUpCoopDefenseUpgrade(stored.defaultProfile, 'unlock_rock_barrier', 100, 0, 'dachs_nukem')!;
    vi.mocked(store.getProgress).mockReturnValue(stored);
    controller.refresh();
    expect(controller.getProgress().toolLoadout).toEqual([{ kind: 'construction', id: 'rock_barrier' }]);
    expect(session.getPlayerLoadoutSlot('local', 'utility')).toBe('ROCK_BARRIER');
    expect(store.setSharedLoadoutSlot).not.toHaveBeenCalledWith('utility', expect.anything());
    expect(controller.setLoadoutTools([{ kind: 'construction', id: 'machine_gun_turret' }])).toBe(false);
    expect(controller.setLoadoutTools([{ kind: 'utility', id: 'HE_GRENADE' }])).toBe(true);
    expect(controller.getProgress().toolLoadout).toEqual([{ kind: 'utility', id: 'HE_GRENADE' }]);
    expect(controller.categoryRespec('utility')).toBe(true);
    expect(controller.getProgress().toolLoadout).not.toContainEqual({ kind: 'construction', id: 'rock_barrier' });
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
    const { controller, store, resultRead, presentation, playSound } = makeInput();
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
      sharedXp: getCoopDefenseXpThresholdForLevel(5),
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
    expect(playSound.mock.calls).toEqual([['sfx_round_defeat'], ['sfx_level_up']]);
  });

  it.each(['victory', 'defeat', 'aborted'] as const)('waits for matching final results and keeps technical outcomes silent (%s)', status => {
    const { controller, resultRead, playSound } = makeInput();
    const result = { id: 'local', name: 'Local', colorHex: 0xffffff, frags: 0, teamId: null,
      roundEndedAt: 42, gameMode: 'coop_defense' as const, mapName: 'Map', sharedXp: 0 };
    vi.mocked(resultRead.getRoundResults).mockReturnValue([result]);
    vi.mocked(resultRead.getRoundState).mockReturnValue({ status, roundStartTime: 1, endedAt: 41, coopDefenseMapId: '1' });
    controller.beginMatchResults(); controller.tryFinalizeMatchResults();
    expect(playSound).not.toHaveBeenCalled();
    vi.mocked(resultRead.getRoundState).mockReturnValue({ status, roundStartTime: 1, endedAt: 42, coopDefenseMapId: '1' });
    controller.tryFinalizeMatchResults(); controller.tryFinalizeMatchResults(); controller.replayMatchResults();
    expect(playSound.mock.calls).toEqual(status === 'aborted' ? [] : [[`sfx_round_${status}`]]);
  });

  it.each([
    { status: 'victory' as const, eligible: true, host: true },
    { status: 'victory' as const, eligible: true, host: false },
    { status: 'defeat' as const, eligible: true, host: true },
    { status: 'victory' as const, eligible: false, host: false },
  ])('grants HP only to eligible winners ($status, eligible=$eligible, host=$host)', ({ status, eligible, host }) => {
    const { controller, store, resultRead, session } = makeInput();
    vi.mocked(resultRead.isLocalRoundResultEligible).mockReturnValue(eligible);
    vi.mocked(session.isHost).mockReturnValue(host);
    const progress = { ...getStoredCoopDefenseProgress(), persistentBaseHealthRewards: [] as ('map-2' | 'map-3')[] };
    vi.mocked(store.getProgress).mockReturnValue(progress);
    vi.mocked(store.unlockPersistentBaseHealthAfterVictory).mockImplementation(() => {
      if (progress.persistentBaseHealthRewards.length) return false;
      progress.persistentBaseHealthRewards.push('map-2');
      return true;
    });
    vi.mocked(resultRead.getRoundResults).mockReturnValue([{
      id: 'local', name: 'Local', colorHex: 0xffffff, frags: 0, teamId: null,
      roundEndedAt: 42, gameMode: 'coop_defense', mapName: 'Map 2', sharedXp: 0,
    }]);
    vi.mocked(resultRead.getRoundState).mockReturnValue({ status, roundStartTime: 1, endedAt: 42, coopDefenseMapId: '2' });
    controller.refresh();
    controller.beginMatchResults();
    controller.tryFinalizeMatchResults();
    expect(controller.getLastMatchResultsPresentation()?.progress?.persistentBaseHealthReward)
      .toEqual(status === 'victory' && eligible ? { bonusHp: 500, maxHp: 3000 } : undefined);
    expect(store.unlockPersistentBaseHealthAfterVictory).toHaveBeenCalledTimes(status === 'victory' && eligible ? 1 : 0);
    controller.beginMatchResults();
    controller.tryFinalizeMatchResults();
    expect(controller.getLastMatchResultsPresentation()?.progress?.persistentBaseHealthReward).toBeUndefined();
  });

  it('announces committed upgrades and reward claims, and XP level increases only after a real credit', () => {
    const { controller, store, playSound } = makeInput();
    const stored = getStoredCoopDefenseProgress();
    vi.mocked(store.getProgress).mockReturnValue(stored);
    stored.totalXp = getCoopDefenseXpThresholdForLevel(20);
    controller.refresh();
    expect(playSound).not.toHaveBeenCalled();
    expect(controller.levelUpUpgrade('does-not-exist')).toBe(false);
    expect(controller.levelUpUpgrade('unlock_rock_barrier')).toBe(true);
    expect(playSound.mock.calls).toEqual([['sfx_upgrade_purchased']]);
    vi.mocked(store.claimPendingItemReward).mockReturnValueOnce({ acquired: null, salvagedXp: 0 }).mockReturnValue(null);
    controller.claimItemReward(42, 'offer'); controller.claimItemReward(42, 'offer');
    expect(playSound.mock.calls).toEqual([['sfx_upgrade_purchased'], ['sfx_item_selected']]);
    vi.mocked(store.salvageItem).mockImplementationOnce(() => {
      stored.totalXp = getCoopDefenseXpThresholdForLevel(25); return 1000;
    }).mockReturnValue(0);
    controller.salvageItem('item'); controller.salvageItem('item');
    controller.setDebugProgress(999999, 0, '1'); controller.refresh();
    expect(playSound.mock.calls).toEqual([['sfx_upgrade_purchased'], ['sfx_item_selected'], ['sfx_level_up']]);
  });

});
